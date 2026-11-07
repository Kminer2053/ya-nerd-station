// A registered plane is immutable. A draft belongs to one approver/report/version;
// publishing its photograph and registering the plane share the approval transaction.
import {connectedStation,metres} from '../src/reports.js';
const parse=(s,f=null)=>{try{return s?JSON.parse(s):f;}catch{return f;}};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const idPattern=/^[a-f0-9-]{36}$/;
export const slotScope=(actor,r)=>({actor,report_id:r.id,report_version:r.updated_at});
export const privateFacadeTarget=target=>Boolean(target.registration||target.facade_reframe);
export function publicSlot(s){
 const g=typeof s.geometry==='string'?parse(s.geometry,{}):s;
 return {alias:s.alias,name:g.name,floor:g.floor,position:g.position,heading:g.heading,surface:g.surface,px:g.px,dimension_basis:g.dimension_basis};
}
export async function registeredSlots(env,key,scope=null){
 const rows=(await env.DB.prepare("SELECT * FROM facade_slots WHERE station_key=? AND (status='approved' OR (status='draft' AND actor=? AND report_id=? AND report_version=?)) ORDER BY created_at,alias").bind(key,scope?.actor||'',scope?.report_id||'',scope?.report_version||'').all()).results;
 const facades=parse((await env.DB.prepare('SELECT body FROM station_layers WHERE station_key=?').bind(key).first())?.body,{}).facades||{};
 const registered=rows.map(s=>({...publicSlot(s),image:s.status==='approved'?facades[s.alias]?.front||null:null,registered:true,...(s.status==='draft'?{registration:{id:s.id,report_version:s.report_version},dimension_evidence:s.evidence,dimension_uncertainty:s.uncertainty}: {})}));
 // Previously imported approved images also carry plane geometry. Never expose source/provenance.
 const imported=Object.entries(facades).filter(([alias,value])=>value.slot&&(value.reframed===true||!registered.some(s=>s.alias===alias))&&value.front&&value.proposal&&/^[-\w]{1,100}$/.test(alias));
 if(imported.length){
  const approved=new Set((await env.DB.prepare("SELECT id FROM proposals WHERE station_key=? AND status='applied' AND id IN (SELECT value FROM json_each(?))").bind(key,JSON.stringify(imported.map(([,v])=>v.proposal))).all()).results.map(p=>p.id));
  for(const [alias,value] of imported)if(approved.has(value.proposal)){
   const plane={...publicSlot({...value.slot,alias}),image:value.front,registered:true,...(value.reframed===true?{reframed:true}:{})};
   const existing=registered.findIndex(s=>s.alias===alias);
   if(existing<0)registered.push(plane);else if(!registered[existing].registration)registered[existing]=plane;
  }
 }
 return registered;
}
export async function slotDetail(env,r,actor){
 return (await registeredSlots(env,r.station_key,slotScope(actor,r))).filter(s=>s.registration&&s.floor===r.floor&&metres(s.position,parse(r.position))<=12);
}
function validateSlotGeometry(g,r){
 const s=connectedStation(r.station_key),keys=['name','floor','position','heading','surface','px','dimension_basis'];
 if(!s||r.type!=='facade'||!r.floor||!parse(r.position))throw fail('위치와 층이 있는 파사드 변경 제보에서 면을 등록하세요.');
 if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).some(k=>!keys.includes(k)))throw fail('면의 이름·층·위치·방향·규격을 확인하세요.');
 const name=typeof g.name==='string'?g.name.trim():'',position=g.position,surface=g.surface;
 if(!name||name.length>100||g.floor!==r.floor||!s.floors.includes(g.floor))throw fail('면의 이름과 제보와 같은 층을 확인하세요.');
 // VWorld floor references are not surveyed floor elevations: existing B2 planes
 // can sit more than 2m below the reference. Use a coarse sanity bound, then review in 3D.
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||metres(position,parse(r.position))>12||Math.abs(position[0]-s.centre[0])>.03||Math.abs(position[1]-s.centre[1])>.03||position[2]<s.heights[g.floor]-5||position[2]>s.heights[g.floor]+12)throw fail('면은 제보 핀에서 12m 이내, 해당 층 높이 근처에 놓으세요. 위치는 면 중심입니다.');
 if(!Number.isFinite(g.heading)||g.heading<0||g.heading>=360)throw fail('정면 방향은 0 이상 360 미만의 각도로 입력하세요.');
 if(!Array.isArray(surface)||surface.length!==2||!surface.every(x=>Number.isFinite(x)&&x>=.1&&x<=30))throw fail('면의 실제 폭·높이는 0.1~30m 범위로 입력하세요.');
 if(!['measured','estimated'].includes(g.dimension_basis))throw fail('실측인지 추정인지 선택하세요. 사진만으로 정확한 치수를 확정하지 않습니다.');
 const ratio=surface[0]/surface[1],px=g.px??(ratio>=1?[1024,Math.max(32,Math.round(1024/ratio))]:[Math.max(32,Math.round(1024*ratio)),1024]);
 if(!Array.isArray(px)||px.length!==2||!px.every(x=>Number.isInteger(x)&&x>=32&&x<=4096)||px[0]*px[1]>4194304||Math.abs(px[0]/px[1]/ratio-1)>.02)throw fail('이미지는 폭·높이 비율과 2% 이내로 일치하는 32~4,096px, 전체 4MP 이내 규격이어야 합니다.');
 return {name,floor:g.floor,position:[...position],heading:g.heading,surface:[...surface],px:[...px],dimension_basis:g.dimension_basis};
}
function validateSlotEvidence(v){
 const evidence=typeof v.evidence==='string'?v.evidence.trim():'',uncertainty=typeof v.uncertainty==='string'?v.uncertainty.trim():'';
 if(!evidence||evidence.length>1000||!uncertainty||uncertainty.length>1000)throw fail('치수 확인 근거와 오차·불확실성을 각각 1~1,000자로 남겨 주세요.');
 if(!Array.isArray(v.source_photo_ids)||!v.source_photo_ids.length||v.source_photo_ids.length>5||new Set(v.source_photo_ids).size!==v.source_photo_ids.length||v.source_photo_ids.some(id=>!idPattern.test(id)))throw fail('이 제보에서 면과 치수를 확인한 사진을 선택하세요.');
 return {evidence,uncertainty,sources:v.source_photo_ids};
}
export function validateSlot(v,r){
 const geometry=validateSlotGeometry(v.slot,r),proof=validateSlotEvidence(v);
 if(v.geometry_checked!==true)throw fail('위치·방향·규격과 실측/추정 여부를 확인하세요.');
 return {geometry,...proof};
}
export function canReframeFacade(report,input,slot){
 return report?.type==='facade'&&report.station_key!=='S202103'&&input?.kind==='conversation'&&input.engine==='dots'&&input.allow_estimate===true&&Boolean(slot&&!slot.registration);
}
const reframeKeys=['right_m','up_m','width_m','height_m','source_photo_ids','evidence','uncertainty'];
export function validateFacadeReframe(v,r,base,slots,photos){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!reframeKeys.includes(k)))throw fail('같은 면의 좌우·높이 이동량과 새 폭·높이, 사진 근거를 확인하세요.');
 const {right_m,up_m,width_m,height_m}=v;
 if(![right_m,up_m,width_m,height_m].every(Number.isFinite)||Math.abs(right_m)>24||Math.abs(up_m)>17)throw fail('면 중심의 이동량과 실제 폭·높이를 확인하세요.');
 const proof=validateSlotEvidence(v);
 if(proof.sources.some(id=>!photos.some(p=>p.id===id)))throw fail('현재 작업의 사진만 배치·치수의 근거로 선택할 수 있습니다.');
 const [lon,lat,alt]=base.position,angle=base.heading*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),mLat=111320,mLon=mLat*Math.cos(lat*Math.PI/180);
 // This is viewer-right on the same vertical plane used by the native map overlay.
 const point=(right,up)=>[lon-cos*right/mLon,lat+sin*right/mLat,alt+up];
 const geometry=validateSlotGeometry({name:base.name,floor:base.floor,position:point(right_m,up_m),heading:base.heading,surface:[width_m,height_m],dimension_basis:'estimated'},r);
 const pin=parse(r.position),floor=connectedStation(r.station_key).heights[r.floor];
 for(const x of [-width_m/2,width_m/2])for(const y of [-height_m/2,height_m/2]){
  const corner=point(right_m+x,up_m+y);
  if(metres(corner,pin)>12||corner[2]<floor-5||corner[2]>floor+12)throw fail('면의 네 모서리를 제보 핀에서 12m 이내, 해당 층 높이 근처에 놓으세요.');
 }
 for(const neighbor of slots){
  if(neighbor.alias===base.alias||neighbor.floor!==base.floor||neighbor.registration||!neighbor.position||!neighbor.surface)continue;
  const headingDifference=Math.abs(((neighbor.heading-base.heading+540)%360)-180);
  const east=(neighbor.position[0]-lon)*mLon,north=(neighbor.position[1]-lat)*mLat;
  if(headingDifference>5||Math.abs(sin*east+cos*north)>.2)continue;
  const right=-cos*east+sin*north,up=neighbor.position[2]-alt;
  const horizontal=Math.min(right_m+width_m/2,right+neighbor.surface[0]/2)-Math.max(right_m-width_m/2,right-neighbor.surface[0]/2);
  const vertical=Math.min(up_m+height_m/2,up+neighbor.surface[1]/2)-Math.max(up_m-height_m/2,up-neighbor.surface[1]/2);
  if(horizontal>.05&&vertical>.05)throw fail('새 범위가 이웃 면 '+neighbor.name+'과 겹칩니다. 바꿀 경계를 확인하세요.');
 }
 return {slot:{alias:base.alias,...geometry},reframe:{right_m,up_m,width_m,height_m,source_photo_ids:proof.sources,evidence:proof.evidence,uncertainty:proof.uncertainty,anchor:publicSlot(base)}};
}
export function rebaseSlots(db,r,actor,version,claimSql,claimArgs=[]){
 return db.prepare("UPDATE facade_slots SET report_version=? WHERE report_id=? AND actor=? AND status='draft' AND report_version=? AND "+claimSql).bind(version,r.id,actor,r.updated_at,...claimArgs);
}
// This SQL predicate is rechecked in the same transaction that claims approval.
export function registrationGuard(target,r,actor,version){
 if(!target.registration)return {sql:'1=1',args:[]};
 return {sql:"EXISTS (SELECT 1 FROM facade_slots WHERE id=? AND alias=? AND station_key=? AND report_id=? AND actor=? AND report_version=? AND status='draft' AND geometry=?)",args:[target.registration.id,target.alias,r.station_key,r.id,actor,version,JSON.stringify(publicGeometry(target.slot))]};
}
const publicGeometry=s=>({name:s.name,floor:s.floor,position:s.position,heading:s.heading,surface:s.surface,px:s.px,dimension_basis:s.dimension_basis});
export function registrationTarget(slot){return slot.registration?{registration:{...slot.registration},slot:publicSlot(slot)}:slot.registered?{slot:publicSlot(slot),...(slot.reframed?{reframed:true}:{})}:{};}
export function activateSlot(db,target,proposal,stamp){
 if(!target.registration)return null;
 return db.prepare("UPDATE facade_slots SET status='approved',decided_at=?,proposal_id=? WHERE id=? AND status='draft' AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying')").bind(stamp,proposal,target.registration.id,proposal);
}
export async function facadeSlotApi(request,env,{json,body,me,audit}){
 const m=new URL(request.url).pathname.match(/^\/api\/console\/reports\/([a-f0-9-]{36})\/facade-slot$/);if(!m)return null;
 const db=env.DB,r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(m[1]).first();
 if(!r)return json({error:'제보가 없습니다.'},404);
 if(request.method==='GET')return json({slots:await slotDetail(env,r,me.approver)});
 if(request.method!=='POST')return json({error:'지원하지 않는 요청입니다.'},405);
 const v=await body();
 if(Object.keys(v).some(k=>!['request_id','report_version','slot','source_photo_ids','evidence','uncertainty','geometry_checked'].includes(k))||!idPattern.test(v.request_id||''))throw fail('면 등록 요청을 다시 확인하세요.');
 const checked=validateSlot(v,r),old=await db.prepare('SELECT * FROM facade_slots WHERE id=?').bind(v.request_id).first();
 if(old){if(old.actor!==me.approver||old.report_id!==r.id||old.geometry!==JSON.stringify(checked.geometry)||old.source_photo_ids!==JSON.stringify(checked.sources)||old.evidence!==checked.evidence||old.uncertainty!==checked.uncertainty)throw fail('이미 사용한 요청입니다.',409);return json({slot:{...publicSlot(old),status:old.status},updated_at:old.report_version});}
 if(!['review','held','accepted'].includes(r.status)||v.report_version!==r.updated_at)throw fail('제보가 변경됐습니다. 최신 제보에서 면을 다시 확인하세요.',409);
 for(const id of checked.sources)if(!await db.prepare('SELECT id FROM report_photos WHERE id=? AND report_id=?').bind(id,r.id).first())throw fail('현재 제보의 사진만 근거로 선택할 수 있습니다.');
 const count=await db.prepare('SELECT count(*) AS n FROM facade_slots WHERE actor=? AND created_at>?').bind(me.approver,new Date(Date.now()-864e5).toISOString()).first();if(count.n>=80)throw fail('면 등록은 승인자별 하루 80회까지입니다.',429);
 const stamp=new Date(Math.max(Date.now(),Date.parse(r.updated_at)+1)).toISOString(),alias='REG-'+crypto.randomUUID(),id=v.request_id;
 const out=await db.batch([
  db.prepare("INSERT INTO facade_slots (id,alias,station_key,report_id,actor,report_version,status,geometry,source_photo_ids,evidence,uncertainty,created_at) SELECT ?,?,?,?,?,?,'draft',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reports WHERE id=? AND updated_at=? AND status IN ('review','held','accepted')) AND (SELECT count(*) FROM facade_slots WHERE actor=? AND created_at>?)<80").bind(id,alias,r.station_key,r.id,me.approver,stamp,JSON.stringify(checked.geometry),JSON.stringify(checked.sources),checked.evidence,checked.uncertainty,stamp,r.id,r.updated_at,me.approver,new Date(Date.now()-864e5).toISOString()),
  db.prepare("UPDATE facade_slots SET status='superseded' WHERE report_id=? AND actor=? AND status='draft' AND id<>? AND EXISTS (SELECT 1 FROM facade_slots WHERE id=?)").bind(r.id,me.approver,id,id),
  db.prepare("UPDATE reports SET updated_at=?,history=json_insert(history,'$[#]',json(?)) WHERE id=? AND EXISTS (SELECT 1 FROM facade_slots WHERE id=?)").bind(stamp,JSON.stringify({status:r.status,at:stamp,note:'파사드 면 후보 확인 · 이미지 최종 승인 전 비공개'}),r.id,id),
  db.prepare("UPDATE report_jobs SET status='cancelled',updated_at=? WHERE report_id=? AND status IN ('queued','running','awaiting_external','needs_info','draft') AND EXISTS (SELECT 1 FROM facade_slots WHERE id=?)").bind(stamp,r.id,id),
  db.prepare("UPDATE proposals SET status='superseded' WHERE report_ids=? AND status IN ('draft','ready') AND EXISTS (SELECT 1 FROM facade_slots WHERE id=?)").bind(JSON.stringify([r.id]),id)
 ]);
 if(!out[0].meta.changes)throw fail('다른 창에서 제보가 변경됐습니다.',409);
 await audit(db,me.approver,'facade-slot.draft',id,{report:r.id,basis:checked.geometry.dimension_basis});
 return json({slot:{alias,...checked.geometry,status:'draft'},updated_at:stamp,note:'면은 비공개 후보로 저장했습니다. 사진 보정안을 최종 승인해야 공개됩니다.'},201);
}
