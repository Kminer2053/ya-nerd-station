import assert from 'node:assert/strict';
import {createScene} from '../src/scene.js';
import {DAEJEON_CANDIDATES} from '../src/daejeon-candidates.js';
import {validateFacadeReframe} from '../server/facade-slots.js';

// Drive the native renderer and its real click handler, including Cesium's two
// different pick contracts: an Entity object or a GeometryInstance's string id.
let picked=null,click=null,viewer=null,nextEntity=0;
class Value{constructor(value){Object.assign(this,value);}}
class Collection{constructor(){this.values=[];}add(value){this.values.push(value);return value;}removeAll(){this.values=[];}remove(value){this.values=this.values.filter(v=>v!==value);}}
class Entities extends Collection{add(value){return super.add({id:'entity-'+nextEntity++,...value});}}
class Cartesian3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}static fromDegrees(...v){return new Cartesian3(...v);}static subtract(a,b,out){Object.assign(out,{x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});return out;}static cross(a,b,out){Object.assign(out,{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});return out;}static normalize(a,out){const n=Math.hypot(a.x,a.y,a.z);Object.assign(out,{x:a.x/n,y:a.y/n,z:a.z/n});return out;}}
const C={Cartesian3,Cartesian2:class{},Geometry:Value,GeometryAttribute:Value,GeometryInstance:Value,Primitive:Value,MaterialAppearance:Value,ImageMaterialProperty:Value,
 ComponentDatatype:{FLOAT:1,DOUBLE:2},PrimitiveType:{TRIANGLES:1},BoundingSphere:{fromVertices:values=>({values})},Material:{fromType:(type,uniforms)=>({type,uniforms})},
 Color:{fromCssColorString:value=>({value,withAlpha:alpha=>({value,alpha})}),WHITE:{withAlpha:alpha=>({alpha})}},Math:{toRadians:n=>n*Math.PI/180,toDegrees:n=>n*180/Math.PI},
 Transforms:{headingPitchRollQuaternion(){}},HeadingPitchRoll:class{},HeadingPitchRange:class{},Matrix4:{IDENTITY:{}},DistanceDisplayCondition:class{},
 PrimitiveCollection:Collection,CustomDataSource:class{constructor(){this.entities=new Entities();}},
 ScreenSpaceEventHandler:class{setInputAction(callback){click=callback;}},ScreenSpaceEventType:{LEFT_CLICK:1},
 Cartographic:{fromCartesian:p=>({longitude:p.x*Math.PI/180,latitude:p.y*Math.PI/180,height:p.z})},
 Viewer:class{constructor(){viewer=this;this.dataSources=new Collection();this.camera={heading:0,pitch:-.5,lookAt(){},lookAtTransform(){},flyTo(view){this.lastView=view;}};this.scene={canvas:{},globe:{},primitives:new Collection(),pick:()=>picked,pickPosition:()=>new Cartesian3(127.43,36.33,60.5),requestRender(){}};}},
};
const nodes=new Map(['#map','#nativeMap','#seoulMap','#floor','#sceneStatus'].map(id=>[id,{}]));
const globals={window:globalThis.window,document:globalThis.document,location:globalThis.location,addEventListener:globalThis.addEventListener};
try{
 globalThis.window={Cesium:C};globalThis.location={hostname:'127.0.0.1',origin:'http://127.0.0.1:4197',search:''};globalThis.document={querySelector:id=>nodes.get(id)};globalThis.addEventListener=()=>{};
 const result=[],scene=await createScene(value=>result.push(value));
 const project={source:'sample',name:'pick fixture',assets:[{id:'all-plane',name:'문 개구부 시험',floor:'2F',position:[127.43,36.33,60.34],size:[4,2,3],heading:0,color:'#ffffff',facades:{front:'data:image/png;base64,AA=='},parts:[
  {id:'left',type:'plane',texture:'front',vertices:[[-2,-1,0],[-.6,-1,0],[-.6,-1,3],[-2,-1,3]],uv:[[0,0],[.35,0],[.35,1],[0,1]]},
  {id:'right',type:'plane',texture:'front',vertices:[[.6,-1,0],[2,-1,0],[2,-1,3],[.6,-1,3]],uv:[[.65,0],[1,0],[1,1],[.65,1]]},
 ]}],points:[{id:'point',name:'기존 시설 포인트',floor:'2F',position:[127.43,36.33,60.34],role:'facility'}],connections:[],routes:[]};
 const before=JSON.stringify(project);await scene.connect(project);scene.setGrid(false);
 const surfaces=viewer.scene.primitives.values[0];assert.equal(surfaces.values.length,2);
 for(const primitive of surfaces.values){picked={id:primitive.geometryInstances.id};click({position:{x:1,y:1}});assert.deepEqual(result.at(-1).tag,{kind:'assets',id:'all-plane'},'each doorway plane selects its parent facility instead of moving another selected record');}
 const point=viewer.dataSources.values[0].entities.values.find(e=>e.point);picked={id:point};click({position:{x:1,y:1}});assert.deepEqual(result.at(-1).tag,{kind:'points',id:'point'},'existing Entity point selection is retained');
 picked={getProperty:key=>key==='TD_ID'?'observed-source':null};click({position:{x:1,y:1}});assert.equal(result.at(-1).tag,undefined);assert.equal(result.at(-1).sourceId,'observed-source','unregistered source picking still supplies its original id and coordinate');
 assert.equal(JSON.stringify(project),before,'picking never mutates the saved position, parts or UV');
 // Check the same wall geometry in a private preview and the resulting public layer.
 const anchor=DAEJEON_CANDIDATES.slots.find(s=>s.alias==='F03_WL05-S04'),photoId=crypto.randomUUID(),r={station_key:'S201801',type:'facade',floor:anchor.floor,position:JSON.stringify(anchor.position)};
 const {slot}=validateFacadeReframe({right_m:2.5,up_m:0,width_m:6,height_m:4.54,source_photo_ids:[photoId],evidence:'합성 기준 사진',uncertainty:'배치 시험용'},r,anchor,DAEJEON_CANDIDATES.slots,[{id:photoId}]);
 const [lon,lat,alt]=slot.position,a=slot.heading*Math.PI/180,k=111320*Math.cos(lat*Math.PI/180),cos=Math.cos(a),sin=Math.sin(a);
 const local=p=>{const east=(p.x-lon)*k,north=(p.y-lat)*111320;return [-cos*east+sin*north,sin*east+cos*north];};
 const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-7);
 for(const image of ['data:image/png;base64,AA==','/api/public/proposal-images/'+crypto.randomUUID()]){
  scene.render({...project,assets:[],points:[],overlays:[{...slot,image}]});
  scene.focusFacade({floor:slot.floor,longitude:lon,latitude:lat,height:alt,cameraHeading:slot.heading,surfaceWidth:slot.surface[0]});
  const walls=viewer.dataSources.values[0].entities.values.filter(e=>e.wall).map(e=>e.wall);assert.equal(walls.length,1);
  const [wall]=walls,[left,right]=wall.positions.map(local);
  close(left[0],-3);close(right[0],3);close(left[1],.05);close(right[1],.05);
  assert.deepEqual(wall.minimumHeights,[alt-2.27,alt-2.27]);assert.deepEqual(wall.maximumHeights,[alt+2.27,alt+2.27]);
  assert.equal(wall.material.image,image);close(local(viewer.camera.lastView.destination)[0],0);assert(local(viewer.camera.lastView.destination)[1]>0);
 }
}finally{for(const[name,value]of Object.entries(globals)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
console.log('PASS: native plane and source picking, immutable model, and identical same-wall private/public geometry with correct front camera.');
