import {centre,coordinate,heights,roles} from './model.js';

export async function createScene(onPick){
 const C=window.Cesium;if(!C)throw Error('3D 렌더러를 불러오지 못했습니다. 네트워크 연결을 확인하고 새로고침하세요.');
 const viewer=new C.Viewer('map',{animation:false,timeline:false,baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,skyBox:false,skyAtmosphere:false});
 viewer.scene.globe.show=false;viewer.scene.backgroundColor=C.Color.fromCssColorString('#172b2e');viewer.scene.requestRenderMode=true;viewer.scene.maximumRenderTimeChange=Infinity;
 const layer=new C.CustomDataSource('editor'),gridLayer=new C.CustomDataSource('grid');await viewer.dataSources.add(layer);await viewer.dataSources.add(gridLayer);
 let project,floor='3F',base=null,grid=true;const position=p=>C.Cartesian3.fromDegrees(...p),color=s=>C.Color.fromCssColorString(s),entityPick=new Map();
 const drawGrid=()=>{gridLayer.entities.removeAll();if(!grid)return;for(let x=-30;x<=30;x+=2)for(let y=-18;y<=18;y+=2)gridLayer.entities.add({position:position(coordinate(x,y,heights[floor]+.08)),point:{pixelSize:3,color:C.Color.WHITE.withAlpha(.55),disableDepthTestDistance:0}});};
 function baseStyle(){if(!base||!project)return;const safe=s=>JSON.stringify(String(s));const hidden=project.assets.filter(a=>a.hidden&&a.source_id).map(a=>'${TD_ID} !== '+safe(a.source_id));const f='(${FLOOR} === undefined || ${FLOOR} === '+safe(floor)+')';base.style=new C.Cesium3DTileStyle({show:[f,...hidden].join(' && ')});}
 function draw(){
  if(!project)return;layer.entities.removeAll();entityPick.clear();baseStyle();drawGrid();
  if(project.source==='sample')layer.entities.add({position:position(coordinate(0,0,heights[floor]-.15)),box:{dimensions:new C.Cartesian3(64,40,.3),material:color('#a0afac')}});
  for(const a of project.assets.filter(a=>a.floor===floor&&!a.hidden)){
   const [w,d,h]=a.size,p=a.position;if(!a.source_id){const e=layer.entities.add({position:position([p[0],p[1],p[2]+h/2]),orientation:C.Transforms.headingPitchRollQuaternion(position(p),new C.HeadingPitchRoll(C.Math.toRadians(a.heading),0,0)),box:{dimensions:new C.Cartesian3(w,d,h),material:color(a.color)},label:{text:a.name,font:'14px sans-serif',pixelOffset:new C.Cartesian2(0,-40),fillColor:C.Color.WHITE,showBackground:true,distanceDisplayCondition:new C.DistanceDisplayCondition(0,500)}});entityPick.set(e.id,{kind:'assets',id:a.id});}
   const sides={front:[[-w/2,-d/2-.02],[w/2,-d/2-.02]],right:[[w/2+.02,-d/2],[w/2+.02,d/2]],back:[[w/2,d/2+.02],[-w/2,d/2+.02]],left:[[-w/2-.02,d/2],[-w/2-.02,-d/2]]};
   for(const [s,url] of Object.entries(a.facades||{})){if(!sides[s]||!url)continue;const rad=-a.heading*Math.PI/180,pts=sides[s].map(([x,y])=>[p[0]+(x*Math.cos(rad)-y*Math.sin(rad))/(111320*Math.cos(p[1]*Math.PI/180)),p[1]+(x*Math.sin(rad)+y*Math.cos(rad))/111320,p[2]]);layer.entities.add({wall:{positions:pts.map(position),minimumHeights:pts.map(()=>p[2]),maximumHeights:pts.map(()=>p[2]+h),material:new C.ImageMaterialProperty({image:url,transparent:false})}});}
  }
  for(const p of project.points.filter(p=>p.floor===floor)){
   const e=layer.entities.add({position:position([p.position[0],p.position[1],p.position[2]+.18]),point:{pixelSize:p.role==='via'?7:12,color:color(roles[p.role][1]),outlineColor:color('#17302c'),outlineWidth:2},label:{text:p.role==='via'?'':p.name,font:'13px sans-serif',pixelOffset:new C.Cartesian2(0,-20),showBackground:true,fillColor:C.Color.WHITE,distanceDisplayCondition:new C.DistanceDisplayCondition(0,350)}});entityPick.set(e.id,{kind:'points',id:p.id});
   if(p.area)layer.entities.add({polygon:{hierarchy:p.area.map(position),perPositionHeight:true,material:color(roles[p.role][1]).withAlpha(.28),outline:true}});
  }
  const byId=new Map(project.points.map(p=>[p.id,p]));
  for(const c of project.connections){const pts=c.point_ids.map(id=>byId.get(id)).filter(Boolean);if(!pts.some(p=>p.floor===floor))continue;for(let i=1;i<pts.length;i++)layer.entities.add({polyline:{positions:[pts[0],pts[i]].map(p=>position(p.position)),width:4,material:color('#398bef')}});}
  for(const r of project.routes){const pts=r.point_ids.map(id=>byId.get(id)).filter(Boolean);for(let i=1;i<pts.length;i++){if(pts[i-1].floor!==floor&&pts[i].floor!==floor)continue;layer.entities.add({polyline:{positions:[pts[i-1],pts[i]].map(p=>position([p.position[0],p.position[1],p.position[2]+.15])),width:4,material:new C.PolylineArrowMaterialProperty(color('#f4b437'))}});}}
  viewer.scene.requestRender();
 }
 const fit=()=>{const p=project?.points.find(p=>p.floor===floor)?.position||[...centre.slice(0,2),heights[floor]];viewer.camera.lookAt(position(p),new C.HeadingPitchRange(C.Math.toRadians(0),C.Math.toRadians(-48),floor==='1F'?330:165));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);};
 const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(e=>{const picked=viewer.scene.pick(e.position),tag=picked?.id&&entityPick.get(picked.id.id);let p;try{p=viewer.scene.pickPosition(e.position);}catch{}if(!p){const planeOrigin=position([centre[0],centre[1],heights[floor]]),normal=C.Ellipsoid.WGS84.geodeticSurfaceNormal(planeOrigin);p=C.IntersectionTests.rayPlane(viewer.camera.getPickRay(e.position),C.Plane.fromPointNormal(planeOrigin,normal));}if(!p)return;const geo=C.Cartographic.fromCartesian(p),pos=[C.Math.toDegrees(geo.longitude),C.Math.toDegrees(geo.latitude),geo.height];const sourceId=typeof picked?.getProperty==='function'?picked.getProperty('TD_ID'):null;onPick({position:pos,tag,sourceId,floor});},C.ScreenSpaceEventType.LEFT_CLICK);
 async function connect(p){project=p;floor=p.source==='sample'?'2F':'3F';document.querySelector('#floor').value=floor;if(base){viewer.scene.primitives.remove(base);base=null;}document.querySelector('#sceneStatus').textContent=p.source==='sample'?'가상 샘플 공간 · 실제 서울역 시설 아님':'기본지도 연결 중…';draw();fit();if(p.source==='sample')return;
  const url=(location.hostname==='127.0.0.1'||new URL(location.href).searchParams.get('scene')==='local')?'/local-tiles/tileset.json':p.source==='vworld-daejeon'?'https://cdn.vworld.kr/TDServer/services/map4/7Iuk64K0/S201801/tileset.json':p.tileset_url;
  try{base=await C.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:12});viewer.scene.primitives.add(base);baseStyle();fit();document.querySelector('#sceneStatus').textContent='기본지도 연결됨 · 변경 레이어 별도 저장';}catch(error){console.error('Daejeon scene:',error);document.querySelector('#sceneStatus').textContent='기본지도 연결 실패: '+error.message+' · 변경 레이어는 유지됩니다.';}
 }
 return{connect,render(p){project=p;draw();},setFloor(v){floor=v;draw();fit();},setGrid(v){grid=v;drawGrid();viewer.scene.requestRender();},fit,focus(p){viewer.camera.flyTo({destination:position([p[0],p[1]-.00025,p[2]+25]),orientation:{heading:0,pitch:C.Math.toRadians(-42),roll:0},duration:.5});}};
}
