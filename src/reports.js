// Public reports: one vocabulary for the report form, the server checks and the ambassador console.
// A report says "the 3D map and the station differ here"; ambassadors decide what changes.
import {stations,ktxCatalog} from './stations.js';

export const REPORT_TYPES=[
 {id:'facade',label:'매장·간판이 바뀜',hint:'간판이나 매장 외관이 지도와 달라요'},
 {id:'new',label:'새로 생김',hint:'부스·매장·안내판·자판기가 새로 생겼어요'},
 {id:'removed',label:'없어짐',hint:'철거됐거나 다른 곳으로 옮겼어요'},
 {id:'blocked',label:'길이 막힘',hint:'공사나 통제로 지나갈 수 없어요'},
 {id:'info',label:'안내 정보 오류',hint:'이름·영업시간 같은 정보가 틀려요'},
 {id:'other',label:'기타',hint:'그 밖에 지도와 다른 점'},
];
export const typeLabel=id=>REPORT_TYPES.find(t=>t.id===id)?.label||id;
// received → analyzing → review → queued (jury-locked station, after approval) | applied | held | duplicate | rejected
export const STATUS={received:'접수',analyzing:'정리 중',review:'검토 대기',accepted:'채택 · 초안 작업',draft:'초안',ready:'최종 승인 대기',superseded:'이전 초안',queued:'반영 대기',applied:'반영',held:'보류',duplicate:'중복',rejected:'반려'};
export const DECISIONS=['accepted','held','duplicate','rejected','review'];
export const LIMITS={photos:5,photoBytes:4_000_000,description:500,place:200,caption:120,previewChars:16_000,previewPx:64,perDay:10,matchRadius:12,duplicateRadius:8,duplicateDays:14,reason:300};
export const PHOTO_VIEWS=[
 {id:'front',label:'정면',hint:'간판부터 바닥까지 전체가 보이게'},
 {id:'left',label:'좌측면',hint:'정면을 마주 봤을 때 왼쪽 면'},
 {id:'right',label:'우측면',hint:'정면을 마주 봤을 때 오른쪽 면'},
 {id:'back',label:'후면',hint:'구조물 뒤쪽 면'},
 {id:'context',label:'주변·위치',hint:'주변 시설과 통행 공간이 함께 보이게'},
];
export const STRUCTURE_FACES=PHOTO_VIEWS.filter(v=>v.id!=='context').map(v=>v.id);
export const photoViewLabel=id=>PHOTO_VIEWS.find(v=>v.id===id)?.label||'면 미지정';
export function validatePhotoView(v){if(v===undefined||v===null||v==='unknown')return 'unknown';if(!PHOTO_VIEWS.some(p=>p.id===v))throw Error('사진의 면을 정면·좌측면·우측면·후면·주변 중에서 골라 주세요.');return v;}
export function photoCoverage(photos){return Object.fromEntries(PHOTO_VIEWS.map(v=>[v.id,photos.filter(p=>p.view_role===v.id).length]));}
export function preferredPhoto(photos,savedId=null,side='front'){let i=photos.findIndex(p=>p.id===savedId);if(i<0)i=photos.findIndex(p=>p.view_role===side);return Math.max(0,i);}

// Progress line shown to everyone: 접수 → 자동 정리 → 승인자 검토 → 보정 제안 → 승인 → 지도 반영.
// Held pauses the line, duplicate/rejected close it, a jury-locked approval waits before the map changes.
export const STAGES=['접수','자동 정리','승인자 검토','보정 제안','승인','지도 반영'];
export const STAGE_FILTERS=[{id:'review',label:'검토 대기'},{id:'draft',label:'채택 · 초안 작업'},{id:'proposed',label:'제안 승인 대기'},{id:'queued',label:'반영 대기'},{id:'applied',label:'반영 완료'},{id:'held',label:'보류'},{id:'closed',label:'중복·반려'},{id:'all',label:'전체'}];
export function progressOf(status,proposal=null){
 if(status==='received')return {at:0,state:'active',bucket:'draft'};
 if(status==='analyzing')return {at:1,state:'active',bucket:'review'};
 if(status==='review')return proposal==='ready'?{at:3,state:'active',bucket:'proposed'}:{at:2,state:'active',bucket:'review'};
 if(status==='accepted')return {at:3,state:'active',bucket:proposal==='ready'?'proposed':'draft'};
 if(status==='held')return {at:proposal==='ready'?3:2,state:'paused',bucket:'held'};
 if(status==='queued')return {at:5,state:'waiting',bucket:'queued'};
 if(status==='applied')return {at:5,state:'done',bucket:'applied'};
 return {at:2,state:'closed',bucket:'closed'};
}

// 46 KTX stations with a VWorld indoor map. Only connected stations have verified IDs, floors and heights;
// the others are listed by name until an ambassador connects them (no guessed building IDs).
export const PUBLIC_STATIONS=[
 ...stations.map(s=>({key:s.id,name:s.name,connected:true,locked:s.status==='jury-locked'})),
 ...ktxCatalog.filter(c=>!stations.some(s=>s.name===c.name)).map(c=>({key:'name:'+c.name,name:c.name,connected:false,locked:false})),
];
// Reports filed before a station was connected keep their 'name:<역명>' key; it still resolves to the station.
export const stationByKey=k=>PUBLIC_STATIONS.find(s=>s.key===k)||(typeof k==='string'&&k.startsWith('name:')?PUBLIC_STATIONS.find(s=>s.name===k.slice(5))||null:null);
export const connectedStation=k=>stations.find(s=>s.id===k)||null;

// A photo does not establish real dimensions. An approver supplies measured/estimated box geometry.
export function structurePixels(size,side='front'){const width=['left','right'].includes(side)?size[1]:size[0],k=1024/Math.max(width,size[2]);return [Math.max(32,Math.round(width*k)),Math.max(32,Math.round(size[2]*k))];}
export function validateStructure(v,key){
 const s=connectedStation(key),fail=()=>{throw Error('구조물의 이름·층·위치·크기·방향을 확인하세요. 크기는 0.1~30m입니다.');};
 if(!s||!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>100||!s.floors.includes(v.floor))fail();
 if(!Array.isArray(v.position)||v.position.length!==3||!v.position.every(Number.isFinite)||Math.abs(v.position[0]-s.centre[0])>.03||Math.abs(v.position[1]-s.centre[1])>.03||v.position[2]<-200||v.position[2]>1000)fail();
 if(!Array.isArray(v.size)||v.size.length!==3||!v.size.every(n=>Number.isFinite(n)&&n>=.1&&n<=30)||!Number.isFinite(v.heading)||!/^#[a-fA-F0-9]{6}$/.test(v.color||''))fail();
 if(!['estimated','measured'].includes(v.dimension_basis))fail();
 return {name:v.name.trim(),floor:v.floor,position:v.position,size:v.size,heading:((v.heading%360)+360)%360,color:v.color,dimension_basis:v.dimension_basis};
}

const LAT_M=111320;
export const metres=(a,b)=>{const k=Math.cos(a[1]*Math.PI/180)*LAT_M;return Math.hypot((b[0]-a[0])*k,(b[1]-a[1])*LAT_M,((b[2]??0)-(a[2]??0))*.3);};
const text=(v,max)=>typeof v==='string'&&v.length<=max;

// Report input as the public form sends it. Returns the stored shape or throws a message the reporter can act on.
export function validateReportInput(v){
 const fail=m=>{throw Error(m);};
 if(!v||typeof v!=='object')fail('제보 내용을 확인하세요.');
 const station=stationByKey(v.station);if(!station)fail('역을 다시 선택하세요.');
 if(!REPORT_TYPES.some(t=>t.id===v.type))fail('무엇이 달라졌는지 골라 주세요.');
 if(v.consent!==true)fail('사진을 지도 개선에 쓰는 것에 동의해 주세요.');
 const description=String(v.description??'').trim(),place=String(v.place_note??'').trim();
 if(!text(description,LIMITS.description))fail('설명은 '+LIMITS.description+'자까지 쓸 수 있어요.');
 if(!text(place,LIMITS.place))fail('위치 설명은 '+LIMITS.place+'자까지 쓸 수 있어요.');
 let floor=null,position=null,view=null;
 const connected=connectedStation(station.key);
 if(connected){
  if(!connected.floors.includes(v.floor))fail('층을 다시 선택하세요.');
  const p=v.position;if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)||Math.abs(p[0]-connected.centre[0])>.03||Math.abs(p[1]-connected.centre[1])>.03||p[2]<-200||p[2]>1000)fail('지도에서 위치를 다시 골라 주세요.');
  floor=v.floor;position=p.map(n=>Math.round(n*1e7)/1e7);
  if(v.view&&Number.isFinite(v.view.heading))view={heading:((v.view.heading%360)+360)%360,pitch:Number.isFinite(v.view.pitch)?v.view.pitch:null};
 }else{
  if(!place)fail('3D 지도 연결 전인 역은 위치를 글로 적어 주세요. 예: 2층 대합실 동쪽 출구 옆');
  if(v.floor!==undefined&&v.floor!==null&&v.floor!==''&&!/^(B[1-9]|[1-9]F|RF)$/.test(v.floor))fail('층 표기를 확인하세요. 예: 2F, B1');
  floor=v.floor||null;
 }
 return {station_key:station.key,floor,position,view,type:v.type,description,place_note:place};
}

// Nearest candidate on the same floor within radius. Facade slots also weigh the view: a facade faces the camera
// when the camera looks against the slot normal (cameraHeading is where a camera stands in front of the face).
export function nearest(items,position,floor,radius,viewHeading=null){
 let best=null;
 for(const it of items){if(it.floor!==floor||!Array.isArray(it.position))continue;let d=metres(position,it.position);
  if(Number.isFinite(viewHeading)&&Number.isFinite(it.heading)){const diff=Math.abs(((viewHeading-(it.heading+180))%360+540)%360-180);if(diff>100)d+=4;}
  if(d<=radius&&(!best||d<best.distance))best={...it,distance:Math.round(d*10)/10};}
 return best;
}

// Rules-only confidence: close to a known slot, several people saying the same, more than one photo.
export function ruleConfidence({slotDistance=null,duplicates=0,photos=0}){
 let c=.35;if(Number.isFinite(slotDistance))c+=slotDistance<=5?.25:.15;c+=Math.min(.2,duplicates*.1);if(photos>=2)c+=.1;
 return Math.round(Math.min(.8,c)*100)/100;
}
