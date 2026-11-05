import assert from 'node:assert/strict';
import {createScene} from '../src/scene.js';

// Drive the native renderer and its real click handler, including Cesium's two
// different pick contracts: an Entity object or a GeometryInstance's string id.
let picked=null,click=null,viewer=null,nextEntity=0;
class Value{constructor(value){Object.assign(this,value);}}
class Collection{constructor(){this.values=[];}add(value){this.values.push(value);return value;}removeAll(){this.values=[];}remove(value){this.values=this.values.filter(v=>v!==value);}}
class Entities extends Collection{add(value){return super.add({id:'entity-'+nextEntity++,...value});}}
class Cartesian3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}static fromDegrees(...v){return new Cartesian3(...v);}static subtract(a,b,out){Object.assign(out,{x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});return out;}static cross(a,b,out){Object.assign(out,{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});return out;}static normalize(a,out){const n=Math.hypot(a.x,a.y,a.z);Object.assign(out,{x:a.x/n,y:a.y/n,z:a.z/n});return out;}}
const C={Cartesian3,Cartesian2:class{},Geometry:Value,GeometryAttribute:Value,GeometryInstance:Value,Primitive:Value,MaterialAppearance:Value,
 ComponentDatatype:{FLOAT:1,DOUBLE:2},PrimitiveType:{TRIANGLES:1},BoundingSphere:{fromVertices:values=>({values})},Material:{fromType:(type,uniforms)=>({type,uniforms})},
 Color:{fromCssColorString:value=>({value,withAlpha:alpha=>({value,alpha})}),WHITE:{withAlpha:alpha=>({alpha})}},Math:{toRadians:n=>n*Math.PI/180,toDegrees:n=>n*180/Math.PI},
 Transforms:{headingPitchRollQuaternion(){}},HeadingPitchRoll:class{},HeadingPitchRange:class{},Matrix4:{IDENTITY:{}},DistanceDisplayCondition:class{},
 PrimitiveCollection:Collection,CustomDataSource:class{constructor(){this.entities=new Entities();}},
 ScreenSpaceEventHandler:class{setInputAction(callback){click=callback;}},ScreenSpaceEventType:{LEFT_CLICK:1},
 Cartographic:{fromCartesian:p=>({longitude:p.x*Math.PI/180,latitude:p.y*Math.PI/180,height:p.z})},
 Viewer:class{constructor(){viewer=this;this.dataSources=new Collection();this.camera={heading:0,pitch:-.5,lookAt(){},lookAtTransform(){}};this.scene={canvas:{},globe:{},primitives:new Collection(),pick:()=>picked,pickPosition:()=>new Cartesian3(127.43,36.33,60.5),requestRender(){}};}},
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
}finally{for(const[name,value]of Object.entries(globals)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
console.log('PASS: native all-plane doorway selection, Entity point selection, source picking and immutable model.');
