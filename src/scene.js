import {geometryParts,boxPlanes} from './draft-geometry.js';
import {roles} from './model.js';
import {stationOf,stations,seoulOrigin} from './stations.js';
import {stationTileSources,openTileset,firstRenderedTile} from './scene-loading.js';
import {createPreviewImages} from './scene-images.js';

// labels: status lines for the page using the map (editor, public reports, ambassador console).
export async function createScene(onPick,{labels={}}={}){
 const say={loading:'서울역 지도 화면을 연결하는 중…',ready:'서울역 첫 실내 모델 표시 완료 · 개인 초안 저장 / 공개 지도는 최종 승인 후 반영',...labels};
 const host=document.querySelector('#map'),status=document.querySelector('#sceneStatus');host.innerHTML='<div id="nativeMap" style="position:absolute;inset:0"></div>';
 const nativeHost=document.querySelector('#nativeMap'),base=seoulOrigin(),images=createPreviewImages({origin:location.origin});
 let native=null,nativePromise=null,project=null,selected=null,frame=null,ready=false,documentReady=false,isSeoul=false,disposed=false,connectedStation=null,renderedFloor=null,floor='2F',grid=true,epoch=0,renderVersion=0,renderQueued=false,renderAbort=null,documentTimer=null,readyTimer=null,sentFloor=null,sentGrid=null,controls=null;
 const pending=new Map(),recentView=new Map();
 const captures=new Map();
 let openingObserver=null,visibilityListener=null,openingVersion=0;
 function setStatus(phase,text,retry=false){
  if(disposed)return;status.textContent=text;status.dataset&&(status.dataset.mapState=phase);if(controls){controls.hidden=!retry;controls.style.display=retry?'flex':'none';const link=controls.querySelector('a');link.hidden=!isSeoul;link.href=frame?.src||base+'/app/?site=S202103';}
  if(retry&&!controls&&document.createElement){controls=document.createElement('div');controls.style.cssText='position:absolute;z-index:4;top:56px;left:12px;display:flex;gap:8px;align-items:center;background:#fff;padding:8px;border-radius:4px';
   const button=document.createElement('button');button.type='button';button.textContent='지도 다시 연결';button.onclick=()=>{if(project)connect(project,true).catch(error=>setStatus('failed',error.message,true));};controls.append(button);
   const link=document.createElement('a');link.textContent='지도 별도 열기';link.target='_blank';link.rel='noopener';link.href=frame?.src||base+'/app/?site=S202103';link.hidden=!isSeoul;controls.append(link);host.append(controls);
  }
 }
 const clearTimers=()=>{clearTimeout(documentTimer);clearTimeout(readyTimer);documentTimer=readyTimer=null;};
 function cancelOpening(){openingVersion++;openingObserver?.disconnect();openingObserver=null;if(visibilityListener)document.removeEventListener('visibilitychange',visibilityListener);visibilityListener=null;}
 function removeFrame(replay=false){cancelOpening();clearTimers();ready=documentReady=false;renderedFloor=null;sentFloor=sentGrid=null;renderAbort?.abort();renderAbort=null;renderVersion++;frame?.remove();frame=null;pending.clear();if(replay)for(const [key,message]of recentView)pending.set(key,message);for(const c of captures.values()){clearTimeout(c.timer);c.reject(Error('지도 연결이 바뀌었습니다. 배치를 확인한 뒤 다시 캡처하세요.'));}captures.clear();}
 function resetView(){pending.clear();recentView.clear();images.clear();if(isSeoul&&frame)pending.set('facade',{action:'facade-preview',data:{imageUrl:null}});}
 function clearFacade(){pending.set('facade',{action:'facade-preview',data:{imageUrl:null}});recentView.delete('facade');}
 const post=(action,data={})=>{if(ready&&frame)frame.contentWindow.postMessage({channel:'station-toolkit',action,...data},base);};
 function scheduleRender(){
  if(disposed||!isSeoul||!project||!ready||renderQueued)return;
  renderQueued=true;queueMicrotask(()=>{
   renderQueued=false;if(disposed||!isSeoul||!ready||!project)return;
   renderAbort?.abort();const controller=new AbortController();renderAbort=controller;const version=++renderVersion,p=project,f=floor;
   images.prepare(p,f,{signal:controller.signal}).then(preview=>{
    if(disposed||version!==renderVersion||project!==p||!isSeoul||!ready)return;
    post('render',{project:preview,selected});if(sentFloor!==f){post('floor',{floor:f});sentFloor=f;}if(sentGrid!==grid){post('grid',{value:grid});sentGrid=grid;}
    for(const [key,message]of pending){post(message.action,message.data);pending.delete(key);}
   }).catch(error=>{if(error.name!=='AbortError'&&version===renderVersion)setStatus('failed',error.message,true);});
  });
 }
 const queue=(key,action,data={})=>{const message={action,data:structuredClone(data)};pending.set(key,message);recentView.set(key,message);scheduleRender();};
 function openFrame(){
  nativeHost.hidden=true;
  const u=new URL('/app/',base);u.search=new URLSearchParams({site:'S202103',floor,embed:'catalog',toolkit:'1',toolkitOrigin:location.origin,...(base.startsWith('http:')?{scene:'local'}:{})});
  // Give the new frame its destination before insertion. Reusing an initially
  // hidden about:blank frame can leave Chrome's cross-origin navigation pending.
  const next=document.createElement('iframe');next.id='seoulMap';next.title='서울역 최신화 지도 · 편집 미리보기';next.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0';next.loading='eager';next.src=u.href;frame=next;
  next.addEventListener('load',()=>{if(disposed||frame!==next||ready)return;documentReady=true;clearTimeout(documentTimer);setStatus('rendering','서울역 지도 문서 연결됨 · 첫 실내 모델 표시를 기다리는 중…');});
  next.addEventListener('error',()=>{if(frame===next)setStatus('failed','서울역 지도 화면을 불러오지 못했습니다.',true);});
  documentTimer=setTimeout(()=>{if(frame===next&&!ready)setStatus('failed','서울역 지도 문서 응답이 지연됩니다. 다시 연결하거나 지도를 별도로 열어 주세요.',true);},15000);
  readyTimer=setTimeout(()=>{if(frame===next&&!ready)setStatus('failed',documentReady?'서울역 첫 실내 모델을 표시하지 못했습니다. 초안은 유지됩니다.':'서울역 지도 문서 응답이 지연됩니다. 다시 연결하거나 지도를 별도로 열어 주세요.',true);},45000);
  host.append(next);setStatus('loading',say.loading);
 }
 function requestFrame(replay=false){
  removeFrame(replay);nativeHost.hidden=true;
  if(typeof IntersectionObserver!=='function'){openFrame();return;}
  const version=openingVersion,p=project;let intersecting=false;
  const show=()=>{if(disposed||version!==openingVersion||p!==project||!isSeoul||frame||!intersecting||document.hidden||document.visibilityState==='hidden')return;cancelOpening();openFrame();};
  openingObserver=new IntersectionObserver(entries=>{if(version!==openingVersion)return;const entry=entries.find(e=>e.target===host);if(entry)intersecting=entry.isIntersecting&&entry.intersectionRatio>0;show();},{threshold:[0,.001]});
  visibilityListener=show;document.addEventListener('visibilitychange',visibilityListener);
  setStatus('waiting','배치 지도 영역으로 이동하면 지도를 연결합니다. 초안은 유지됩니다.');openingObserver.observe(host);
 }
 const onMessage=e=>{
  if(disposed||!isSeoul||!frame||e.origin!==base||e.source!==frame.contentWindow||e.data?.channel!=='station-toolkit')return;
  documentReady=true;clearTimeout(documentTimer);
  if(e.data.event==='ready'){ready=true;clearTimeout(documentTimer);setStatus(renderedFloor===floor?'ready':'rendering',renderedFloor===floor?say.ready:'서울역 편집 연결됨 · 첫 실내 모델 표시를 기다리는 중…');scheduleRender();}
  if(e.data.event==='loading'&&(!e.data.floor||e.data.floor===floor)){renderedFloor=null;setStatus(e.data.stage==='first-tile'?'rendering':'loading',e.data.stage==='first-tile'?'서울역 · '+floor+' 첫 실내 모델 표시를 기다리는 중…':'서울역 3D 지도 연결 중…');}
  if(e.data.event==='rendered'&&e.data.floor===floor){renderedFloor=floor;clearTimers();setStatus('ready',say.ready.replace('첫 실내 모델',floor+' 실내 모델'));}
  if(e.data.event==='error'&&(!e.data.floor||e.data.floor===floor)){clearTimers();setStatus('failed','서울역 지도 표시 실패: '+String(e.data.message||'지도 연결 오류').slice(0,220)+' · 초안은 유지됩니다.',true);}
  if(e.data.event==='pick')onPick(e.data.pick);
  if(e.data.event==='capture'&&captures.has(e.data.request_id)){
   const c=captures.get(e.data.request_id);captures.delete(e.data.request_id);clearTimeout(c.timer);
   if(typeof e.data.image==='string'&&e.data.image.length<=5_400_000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(e.data.image))c.resolve(e.data.image);else c.reject(Error(e.data.error||'지도 캡처를 만들지 못했습니다.'));
  }
 };
 addEventListener('message',onMessage);
 async function connect(p,force=false){
  if(disposed)throw Error('닫힌 지도입니다.');const replay=force&&p===project&&isSeoul;cancelOpening();if(!replay)resetView();const version=++epoch;project=p;const station=stationOf(p),same=connectedStation===station.id;connectedStation=station.id;
  if(!same||!station.floors.includes(floor))floor=p.source==='sample'?'2F':station.default_floor;document.querySelector('#floor').value=floor;
  isSeoul=p.site_id==='S202103';
  if(isSeoul){native?.dispose();native=null;nativePromise=null;if(!frame||force)requestFrame(replay);else scheduleRender();return;}
  if(frame)removeFrame();nativeHost.hidden=false;
  const promise=nativePromise||=createNativeScene(onPick,(...args)=>{if(!isSeoul&&!disposed)setStatus(...args);});let value;
  try{value=await promise;}catch(error){if(promise===nativePromise)nativePromise=null;if(!disposed&&!isSeoul&&version===epoch)setStatus('failed',error.message+' · 초안은 유지됩니다.',true);return;}
  if(disposed||isSeoul||promise!==nativePromise){value.dispose();return;}if(version!==epoch)return;
  native=value;await value.connect(p,{floor,force});if(!disposed&&!isSeoul&&version===epoch&&native===value)value.setGrid(grid);
 }
 return {connect,render(p){const changed=p!==project;if(changed){cancelOpening();resetView();}project=p;if(isSeoul){if(!frame&&changed)requestFrame();else scheduleRender();}else native?.render(p);},select(value){selected=value;if(isSeoul)scheduleRender();},
  async capture(){if(!isSeoul){if(!native?.capture)throw Error('지도 연결을 먼저 확인하세요.');return native.capture();}if(!ready||renderedFloor!==floor)throw Error('지도와 수정안이 표시된 뒤 캡처하세요.');if(captures.size)throw Error('캡처 처리 중입니다.');const request_id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{captures.delete(request_id);reject(Error('지도 캡처 응답이 지연됩니다. 다시 시도하세요.'));},10000);captures.set(request_id,{resolve,reject,timer});post('capture',{request_id});});},
  setFloor(value){if(!project||!stationOf(project).floors.includes(value))return;if(isSeoul&&value!==floor){pending.delete('camera');recentView.delete('camera');clearFacade();}floor=value;if(isSeoul)scheduleRender();else native?.setFloor(value);},
  setGrid(value){grid=!!value;if(isSeoul)scheduleRender();else native?.setGrid(grid);},focus(position){if(isSeoul){clearFacade();queue('camera','focus',{position});}else native?.focus(position);},fit(){if(isSeoul)queue('camera','fit');else native?.fit();},
  previewFacade(slotAlias,imageUrl){if(isSeoul){const focus=recentView.get('camera');if(focus?.action==='facade-focus'&&focus.data.focus.imageId!==slotAlias){pending.delete('camera');recentView.delete('camera');}queue('facade','facade-preview',{slotAlias,imageUrl});}},focusFacade(value){if(isSeoul){const previous=recentView.get('facade');if(previous&&previous.data.slotAlias!==value.imageId)clearFacade();if(stationOf(project).floors.includes(value.floor))floor=value.floor;queue('camera','facade-focus',{focus:value});}else native?.focusFacade(value);},get isSeoul(){return isSeoul;},
  dispose(){if(disposed)return;disposed=true;epoch++;removeFrame();recentView.clear();removeEventListener('message',onMessage);images.clear();native?.dispose();native=null;nativePromise=null;controls?.remove();controls=null;},
 };
}
async function createNativeScene(onPick,setStatus){
 let centre=stations[1].centre,heights=stations[1].heights;
 const coordinate=(x,y,z)=>[centre[0]+x/(111320*Math.cos(centre[1]*Math.PI/180)),centre[1]+y/111320,z];
 const C=window.Cesium;if(!C)throw Error('3D 렌더러를 불러오지 못했습니다. 네트워크 연결을 확인하고 새로고침하세요.');
 const viewer=new C.Viewer('nativeMap',{animation:false,timeline:false,baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,skyBox:false,skyAtmosphere:false});
 viewer.scene.globe.show=false;viewer.scene.backgroundColor=C.Color.fromCssColorString('#172b2e');viewer.scene.requestRenderMode=true;viewer.scene.maximumRenderTimeChange=Infinity;
 const surfaces=viewer.scene.primitives.add(new C.PrimitiveCollection());
 const layer=new C.CustomDataSource('editor'),gridLayer=new C.CustomDataSource('grid');await viewer.dataSources.add(layer);await viewer.dataSources.add(gridLayer);
 let project,floor='3F',base=null,grid=true,station=null,disposed=false,loading=null,visibleAbort=null,loadVersion=0,modelReady=false;const position=p=>C.Cartesian3.fromDegrees(...p),color=s=>C.Color.fromCssColorString(s),entityPick=new Map();
 const drawGrid=()=>{gridLayer.entities.removeAll();if(!grid)return;for(let x=-30;x<=30;x+=2)for(let y=-18;y<=18;y+=2)gridLayer.entities.add({position:position(coordinate(x,y,heights[floor]+.08)),point:{pixelSize:3,color:C.Color.WHITE.withAlpha(.55),disableDepthTestDistance:0}});};
 function baseStyle(){if(!base||!project)return;const safe=s=>JSON.stringify(String(s));const hidden=project.assets.filter(a=>a.hidden&&a.source_id).map(a=>'${TD_ID} !== '+safe(a.source_id));const f='(${FLOOR} === undefined || ${FLOOR} === '+safe(floor)+')';base.style=new C.Cesium3DTileStyle({show:[f,...hidden].join(' && ')});}
 function draw(){
  if(!project)return;layer.entities.removeAll();surfaces.removeAll();entityPick.clear();baseStyle();drawGrid();
  if(project.source==='sample')layer.entities.add({position:position(coordinate(0,0,heights[floor]-.15)),box:{dimensions:new C.Cartesian3(64,40,.3),material:color('#a0afac')}});
  for(const a of project.assets.filter(a=>a.floor===floor&&!a.hidden)){
   const p=a.position,rad=-a.heading*Math.PI/180,world=([x,y,z])=>position([p[0]+(x*Math.cos(rad)-y*Math.sin(rad))/(111320*Math.cos(p[1]*Math.PI/180)),p[1]+(x*Math.sin(rad)+y*Math.cos(rad))/111320,p[2]+z]);
   for(const part of geometryParts(a)){
    if(part.type==='box'&&!a.source_id){const [x,y,z]=part.offset,[w,d,h]=part.size,e=layer.entities.add({position:world([x,y,z+h/2]),orientation:C.Transforms.headingPitchRollQuaternion(position(p),new C.HeadingPitchRoll(C.Math.toRadians(a.heading),0,0)),box:{dimensions:new C.Cartesian3(w,d,h),material:color(part.color||a.color)}});entityPick.set(e.id,{kind:'assets',id:a.id});}
    for(const face of part.type==='plane'?[part]:boxPlanes(part)){
     const url=a.facades?.[face.texture];if(!url)continue;
     const values=new Float64Array(face.vertices.flatMap(v=>{const c=world(v);return [c.x,c.y,c.z];})),normal=C.Cartesian3.normalize(C.Cartesian3.cross(C.Cartesian3.subtract(world(face.vertices[1]),world(face.vertices[0]),new C.Cartesian3()),C.Cartesian3.subtract(world(face.vertices[2]),world(face.vertices[0]),new C.Cartesian3()),new C.Cartesian3()),new C.Cartesian3()),geometry=new C.Geometry({attributes:{normal:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:new Float32Array(Array(4).fill([normal.x,normal.y,normal.z]).flat())}),position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values}),st:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:2,values:new Float32Array(face.uv.flat())})},indices:new Uint16Array([0,1,2,0,2,3]),primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(values)});
     const pickId=a.id+':'+face.id;entityPick.set(pickId,{kind:'assets',id:a.id});
     surfaces.add(new C.Primitive({geometryInstances:new C.GeometryInstance({geometry,id:pickId}),appearance:new C.MaterialAppearance({material:C.Material.fromType('Image',{image:url,transparent:true}),flat:true,faceForward:true,translucent:true,closed:false,renderState:{depthTest:{enabled:true},cull:{enabled:false},polygonOffset:{enabled:true,factor:-1,units:-1}}}),asynchronous:false}));
    }
   }

  }
  // Approved facades (overlays): the image spans the slot surface, left edge on the viewer's left, 5 cm in front.
  for(const o of (project.overlays||[]).filter(o=>o.floor===floor)){const h=o.heading*Math.PI/180,[w,hh]=o.surface||[3,3],p=o.position,k=111320*Math.cos(p[1]*Math.PI/180),at=s=>[p[0]+(Math.cos(h)*s*w/2+Math.sin(h)*.05)/k,p[1]+(-Math.sin(h)*s*w/2+Math.cos(h)*.05)/111320],a=at(1),b=at(-1);
   layer.entities.add({wall:{positions:[position([a[0],a[1],p[2]]),position([b[0],b[1],p[2]])],minimumHeights:[p[2]-hh/2,p[2]-hh/2],maximumHeights:[p[2]+hh/2,p[2]+hh/2],material:new C.ImageMaterialProperty({image:o.image,transparent:false})}});}
  for(const p of project.points.filter(p=>p.floor===floor)){
   const e=layer.entities.add({position:position([p.position[0],p.position[1],p.position[2]+.18]),point:{pixelSize:p.role==='via'?7:12,color:color(roles[p.role][1]),outlineColor:color('#17302c'),outlineWidth:2},label:{text:p.role==='via'?'':p.name,font:'13px sans-serif',pixelOffset:new C.Cartesian2(0,-20),showBackground:true,fillColor:C.Color.WHITE,distanceDisplayCondition:new C.DistanceDisplayCondition(0,350)}});entityPick.set(e.id,{kind:'points',id:p.id});
   if(p.area)layer.entities.add({polygon:{hierarchy:p.area.map(position),perPositionHeight:true,material:color(roles[p.role][1]).withAlpha(.28),outline:true}});
  }
  const byId=new Map(project.points.map(p=>[p.id,p]));
  for(const c of project.connections){const pts=c.point_ids.map(id=>byId.get(id)).filter(Boolean);if(!pts.some(p=>p.floor===floor))continue;for(let i=1;i<pts.length;i++)layer.entities.add({polyline:{positions:[pts[0],pts[i]].map(p=>position(p.position)),width:4,material:color('#398bef')}});}
  for(const r of project.routes){const pts=r.point_ids.map(id=>byId.get(id)).filter(Boolean);for(let i=1;i<pts.length;i++){if(pts[i-1].floor!==floor&&pts[i].floor!==floor)continue;layer.entities.add({polyline:{positions:[pts[i-1],pts[i]].map(p=>position([p.position[0],p.position[1],p.position[2]+.15])),width:4,material:new C.PolylineArrowMaterialProperty(color('#f4b437'))}});}}
  viewer.scene.requestRender();
 }
 const fit=()=>{if(disposed)return;const p=[...centre.slice(0,2),heights[floor]],radius=base?.boundingSphere?.radius,range=Number.isFinite(radius)?Math.max(60,Math.min(2000,radius*2.7)):floor==='1F'?330:165;viewer.camera.lookAt(position(p),new C.HeadingPitchRange(C.Math.toRadians(0),C.Math.toRadians(-48),range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();};
 const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(e=>{const picked=viewer.scene.pick(e.position),id=typeof picked?.id==='string'?picked.id:picked?.id?.id,tag=entityPick.get(id);let p;try{p=viewer.scene.pickPosition(e.position);}catch{}if(!p){const planeOrigin=position([centre[0],centre[1],heights[floor]]),normal=C.Ellipsoid.WGS84.geodeticSurfaceNormal(planeOrigin);p=C.IntersectionTests.rayPlane(viewer.camera.getPickRay(e.position),C.Plane.fromPointNormal(planeOrigin,normal));}if(!p)return;const geo=C.Cartographic.fromCartesian(p),pos=[C.Math.toDegrees(geo.longitude),C.Math.toDegrees(geo.latitude),geo.height];const sourceId=typeof picked?.getProperty==='function'?picked.getProperty('TD_ID'):null;onPick({position:pos,tag,sourceId,floor,view:{heading:C.Math.toDegrees(viewer.camera.heading),pitch:C.Math.toDegrees(viewer.camera.pitch)}});},C.ScreenSpaceEventType.LEFT_CLICK);
 async function monitorFloor(){
  if(!base||disposed)return;visibleAbort?.abort();const controller=new AbortController();visibleAbort=controller;const tile=base,f=floor;
  modelReady=false;setStatus('rendering',station.name+' · '+f+' 첫 실내 모델 표시를 기다리는 중…');
  try{await firstRenderedTile(viewer,tile,{signal:controller.signal,timeout:20000});if(!disposed&&base===tile&&floor===f){modelReady=true;setStatus('ready',station.name+' · '+f+' 실내 모델 표시 완료 · 변경 레이어 별도 저장');}}
  catch(error){if(error.name!=='AbortError'&&!disposed)setStatus('failed',error.message+' · 초안은 유지됩니다.',true);}
 }
 async function connect(p,{floor:requestedFloor,force=false}={}){
  if(disposed)return;const s=stationOf(p),same=station?.id===s.id;project=p;station=s;centre=s.centre;heights=s.heights;
  floor=s.floors.includes(requestedFloor)?requestedFloor:p.source==='sample'?'2F':s.default_floor;document.querySelector('#floor').value=floor;
  loading?.abort();visibleAbort?.abort();const version=++loadVersion;modelReady=false;
  if(same&&base&&!force){draw();fit();await monitorFloor();return;}
  if(base){viewer.scene.primitives.remove(base);base=null;}draw();fit();
  if(p.source==='sample'){setStatus('sample','가상 샘플 공간 · 실제 역 시설 아님');return;}
  const controller=new AbortController();loading=controller;let lastError=null;
  for(const source of stationTileSources(s,{hostname:location.hostname,local:new URLSearchParams(location.search).get('scene')==='local'})){
   let tile=null;
   try{
    setStatus('loading',s.name+' · '+source.label+' 지도 주소 연결 중…');tile=await openTileset(C,source.url,{timeout:source.timeout,signal:controller.signal});
    if(disposed||controller.signal.aborted||version!==loadVersion){if(!tile.isDestroyed?.())tile.destroy();return;}
    const displayed=firstRenderedTile(viewer,tile,{signal:controller.signal,timeout:20000});displayed.catch(()=>{});base=tile;viewer.scene.primitives.add(tile);baseStyle();fit();
    setStatus('rendering',s.name+' 지도 주소 연결됨 · '+floor+' 첫 실내 모델 표시를 기다리는 중…');
    await displayed;if(disposed||version!==loadVersion)return;modelReady=true;setStatus('ready',s.name+' · '+floor+' 첫 실내 모델 표시 완료 · 변경 레이어 별도 저장');loading=null;return;
   }catch(error){
    if(base===tile&&tile){viewer.scene.primitives.remove(tile);base=null;}
    if(error.name==='AbortError'||disposed||version!==loadVersion)return;lastError=error;
   }
  }
  if(!disposed&&version===loadVersion){loading=null;setStatus('failed',s.name+' 기본지도 연결 실패: '+(lastError?.message||'지도 응답 없음')+' · 초안·사진·동선은 유지됩니다.',true);}
 }
 // Stand in front of a facade (normal = cameraHeading) and look at it.
 function focusFacade(f){if(disposed)return;if(f.floor&&f.floor!==floor){floor=f.floor;document.querySelector('#floor').value=floor;draw();}const h=f.cameraHeading*Math.PI/180,d=Math.max(6,(f.surfaceWidth||3)*1.6),k=111320*Math.cos(f.latitude*Math.PI/180);
  viewer.camera.flyTo({destination:position([f.longitude+Math.sin(h)*d/k,f.latitude+Math.cos(h)*d/111320,f.height+.4]),orientation:{heading:C.Math.toRadians((f.cameraHeading+180)%360),pitch:C.Math.toRadians(-6),roll:0},duration:.9});}
 let cancelCapture=null;
 function capture(){
  if(disposed||!modelReady)throw Error('지도 표시를 먼저 확인하세요.');
  if(cancelCapture)throw Error('캡처 처리 중입니다.');
  return new Promise((resolve,reject)=>{
   const scene=viewer.scene;
   const cleanup=()=>{remove();clearTimeout(timer);cancelCapture=null;};
   const remove=scene.postRender.addEventListener(()=>{
    cleanup();
    try{
     const source=scene.canvas;
     if(!source.width||!source.height)throw Error('지도 화면이 준비되지 않았습니다.');
     const k=Math.min(1,2048/Math.max(source.width,source.height)),canvas=document.createElement('canvas');
     canvas.width=Math.max(1,Math.round(source.width*k));canvas.height=Math.max(1,Math.round(source.height*k));
     canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
     const image=canvas.toDataURL('image/jpeg',.86);
     if(image.length>5_400_000)throw Error('캡처 용량이 큽니다. 시야를 좁혀 다시 시도하세요.');
     resolve(image);
    }catch(error){reject(error);}
   });
   cancelCapture=message=>{cleanup();reject(Error(message));};
   const timer=setTimeout(()=>cancelCapture('지도 화면을 캡처하지 못했습니다. 지도가 표시된 뒤 다시 시도하세요.'),3000);
   // On-demand rendering may skip an idle frame, and WebGL clears its buffer after drawing.
   scene.requestRender();
  });
 }
 return{connect,focusFacade,render(p){if(disposed||station&&stationOf(p).id!==station.id)return;project=p;draw();},setFloor(v){if(disposed||!station?.floors.includes(v))return;floor=v;const watch=modelReady;draw();fit();if(watch)monitorFloor();},setGrid(v){if(disposed)return;grid=v;drawGrid();viewer.scene.requestRender();},fit,focus(p){if(!disposed)viewer.camera.flyTo({destination:position([p[0],p[1]-.00025,p[2]+25]),orientation:{heading:0,pitch:C.Math.toRadians(-42),roll:0},duration:.5});},
  capture,
  dispose(){if(disposed)return;disposed=true;cancelCapture?.('지도가 바뀌었습니다. 현재 화면에서 다시 캡처하세요.');loadVersion++;loading?.abort();visibleAbort?.abort();handler.destroy?.();entityPick.clear();viewer.destroy?.();},
 };
}
