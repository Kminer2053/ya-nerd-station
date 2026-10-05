// Durable, approver-started jobs. AI produces immutable drafts; only a human final approval writes map layers.
import {validateStructure,structurePixels,validatePhotoView,metres,stationByKey} from '../src/reports.js';
import {WORK_KINDS,removalCandidates,parseWorkPlan,workPrompt} from './work-plan.js';
import {decodePhoto,aiThumbnail,rectifyFace} from './work-images.js';
import {requestVision} from './ai.js';
import {workPhotos} from './work-chat.js';
const parse=(s,f=null)=>{try{return s?JSON.parse(s):f;}catch{return f;}};
const now=()=>new Date().toISOString();
const storageLimit=env=>Math.max(10,Math.min(2000,Number(env.REPORT_STORAGE_MB)||500))*1_000_000;
const configured=env=>Boolean(env.AI_API_KEY&&env.AI_MODEL&&['anthropic','openai'].includes(String(env.AI_PROVIDER||'anthropic').toLowerCase()));
const jobRow=j=>({...j,input:parse(j.input,{}),plan:parse(j.plan),questions:parse(j.questions,[])});
const object=async(env,key)=>{const o=await env.UPLOADS.get(key);if(!o)throw Error('사진 원본을 찾지 못했습니다.');return new Uint8Array(await new Response(o.body).arrayBuffer());};
const layerOf=async(db,key)=>parse((await db.prepare('SELECT body FROM station_layers WHERE station_key=?').bind(key).first())?.body,{assets:{},facades:{}});
const path=e=>'$.'+e.collection+'."'+e.id+'"';
const allowedKey=s=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s);
const effectsSafe=effects=>Array.isArray(effects)&&effects.length>0&&effects.length<=11&&effects.every(e=>['assets','facades'].includes(e.collection)&&allowedKey(e.id)&&typeof e.before==='string'&&e.after&&typeof e.after==='object');
const guard=effects=>effects.map(()=>"COALESCE((SELECT json_extract(body,?) FROM station_layers WHERE station_key=?),'null')=?").join(' AND ');
const guardArgs=(effects,key)=>effects.flatMap(e=>[path(e),key,e.before]);
const auditCommand=(db,actor,action,id,detail,stamp,claim)=>db.prepare("INSERT INTO audit_log (id,actor,action,target,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM proposals WHERE id=? AND status=?)").bind(crypto.randomUUID(),actor,action,id,JSON.stringify(detail),stamp,id,claim);
export async function workDetail(env,report){
 const rows=(await env.DB.prepare('SELECT * FROM report_jobs WHERE report_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10').bind(report.id).all()).results;
 // Recover a lost/aborted waitUntil as a retryable failure; never silently restart a billable request.
 await env.DB.prepare("UPDATE report_jobs SET status='failed',error=?,updated_at=? WHERE report_id=? AND status IN ('queued','running') AND updated_at<?").bind('처리가 중단됐습니다. 다시 실행해 주세요.',now(),report.id,new Date(Date.now()-180000).toISOString()).run();
 const layer=await layerOf(env.DB,report.station_key);
 return {configured:configured(env),jobs:rows.map(j=>Date.now()-Date.parse(j.updated_at)>180000&&['queued','running'].includes(j.status)?jobRow({...j,status:'failed',error:'처리가 중단됐습니다. 다시 실행해 주세요.'}):jobRow(j)),candidates:removalCandidates(layer,report)};
}
export function inputOf(v,r){
 if(!WORK_KINDS.includes(v.kind)||v.operation_approved!==true)throw Error('작업 종류를 선택하고 작업 시작을 승인해 주세요.');
 const out={kind:v.kind,notes:String(v.notes||'').slice(0,1000),alias:typeof v.alias==='string'?v.alias:null,structure:null,permitted_ids:[]};
 if(v.engine!==undefined&&!['server','dots'].includes(v.engine))throw Error('실행 방법을 확인하세요.');
 if(v.engine==='dots')out.engine='dots';
 if(v.allow_estimate!==undefined&&typeof v.allow_estimate!=='boolean')throw Error('추정 허용은 승인자 확인 항목으로 선택하세요.');
 if(v.allow_estimate===true){if(v.kind!=='structure')throw Error('추정 허용은 새 구조물 작업에만 지정하세요.');out.allow_estimate=true;}
 if(v.structure&&v.kind!=='structure')throw Error('크기·배치는 새 구조물 작업에만 지정하세요.');
 if(v.structure){out.structure=validateStructure(v.structure,r.station_key);const p=parse(r.position);if(out.structure.floor!==r.floor||!p||metres(out.structure.position,p)>2)throw Error('구조물은 제보 핀과 같은 층·위치에 배치하세요.');}
 if(v.permitted_ids!==undefined){if(!Array.isArray(v.permitted_ids)||v.permitted_ids.length>10||v.permitted_ids.some(x=>!allowedKey(x)))throw Error('숨김 대상 선택을 확인하세요.');out.permitted_ids=[...new Set(v.permitted_ids)];}
 return out;
}
async function finishJob(env,j,status,{questions=[],plan=null,error=null,proposal=null}={}){
 return env.DB.prepare("UPDATE report_jobs SET status=?,questions=?,plan=?,error=?,proposal_id=?,updated_at=? WHERE id=? AND status IN ('queued','running')").bind(status,JSON.stringify(questions),plan?JSON.stringify(plan):null,error,proposal,now(),j.id).run();
}
export async function runWork(env,id,helpers,external=null){
 const db=env.DB,j=await db.prepare('SELECT * FROM report_jobs WHERE id=?').bind(id).first(),expected=external?'awaiting_external':'queued';if(!j||j.status!==expected)return;
 // Dots supplies a plan only; it cannot make an ordinary server-AI job execute.
 if(external&&parse(j.input,{}).engine!=='dots')throw Error('에비에게 맡긴 작업이 아닙니다.');
 const claim=await db.prepare("UPDATE report_jobs SET status='running',updated_at=? WHERE id=? AND status=?").bind(now(),id,expected).run();if(!claim.meta.changes)return;
 const staged=[];let saved=false;
 try{
  const r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(j.report_id).first(),input=parse(j.input),photos=await workPhotos(db,j);
  if(!r||r.status!=='accepted'||r.updated_at!==j.report_version)return finishJob(env,j,'cancelled',{error:'제보가 변경되어 이전 작업을 취소했습니다.'});
  const questions=[],layer=await layerOf(db,j.station_key),all=removalCandidates(layer,r),candidates=all.filter(c=>input.permitted_ids.includes(c.id));
  if(input.permitted_ids.some(id=>!all.some(c=>c.id===id)))throw Error('선택한 구조물이 변경됐거나 이 제보 위치의 대상이 아닙니다.');
  if(!photos.length)questions.push('현장 사진을 추가해 주세요.');
  if(input.kind==='structure'&&!input.structure&&input.allow_estimate!==true)questions.push('구조물의 이름, 폭·깊이·높이(m), 정면 방향과 실측/추정 여부를 입력하거나 추정 제안을 명시적으로 허용해 주세요. 사진만으로 실제 크기를 확정하지 않습니다.');
  if(input.kind==='removal'&&!candidates.length)questions.push('숨길 독립 등록 구조물을 선택해 주세요. 원본 공유 모델·미등록 장애물은 정확한 모델 범위 확인이 필요하며 자동 제거하지 않습니다.');
  let slot=null;
  if(input.kind==='facade'){
   slot=(await helpers.stationData(env,j.station_key)).slots.find(s=>s.alias===input.alias&&s.floor===r.floor&&metres(s.position,parse(r.position))<=12);
   if(!slot)questions.push('제보와 같은 층·12m 이내의 파사드 자리를 선택해 주세요.');
  }
  if(questions.length)return finishJob(env,j,'needs_info',{questions});
  if(!external&&!configured(env))return finishJob(env,j,'needs_config',{error:'운영자가 AI_API_KEY·AI_PROVIDER·AI_MODEL을 비밀 설정으로 등록해야 실제 자동 작업을 실행할 수 있습니다.'});
  let raw=external?.raw;
  if(!external){const images=[];let total=0;
   for(const p of photos){const bytes=await object(env,p.storage_key||'report/'+p.id),src=decodePhoto(bytes,helpers.imageInfo(bytes)),thumb=aiThumbnail(src);total+=thumb.length;if(total>5_000_000)throw Error('분석 사진의 전체 용량이 큽니다. 작은 JPEG로 다시 제보해 주세요.');images.push({...p,mime:'image/png',bytes:thumb});}
   raw=await requestVision(env,{photos:images,prompt:workPrompt({report:r,input,photos,candidates,slot}),timeoutMs:20000});
  }
  const plan=parseWorkPlan(raw,{kind:j.kind,photos,candidates,slot,input,report:r});
  if(plan.confidence!==null&&plan.confidence<.7&&!plan.questions.length)plan.questions.push('AI 판단이 불확실합니다. 가림 없는 사진과 대상 설명을 보완해 주세요.');
  if(plan.questions.length)return finishJob(env,j,'needs_info',{questions:plan.questions,plan});
  const geometry=input.structure||plan.structure;
  const pid=crypto.randomUUID(),effects=[],faces={},stamp=now();let size=0;
  for(const targetId of plan.hide_ids){const asset=layer.assets[targetId];effects.push({collection:'assets',id:targetId,before:JSON.stringify(asset),after:{...asset,hidden:true},label:asset.name,action:'hide'});}
  for(const [side,f] of Object.entries(plan.faces)){
   const p=photos.find(p=>p.id===f.photo_id),bytes=await object(env,p.storage_key||'report/'+p.id),src=decodePhoto(bytes,helpers.imageInfo(bytes)),px=j.kind==='structure'?structurePixels(geometry.size,side):slot.px;
   const out=rectifyFace(src,f,px);size+=out.bytes.length;if(out.bytes.length>4_800_000||size>16_000_000)throw Error('보정 이미지 용량 초과. 수동 보정 작업대에서 JPEG로 최적화해 주세요.');
   const imageKey='proposal/'+pid+(side==='front'?'':'/'+side);staged.push(imageKey);await env.UPLOADS.put(imageKey,out.bytes,{httpMetadata:{contentType:out.mime}});
   faces[side]={photo:p.id,quad:out.quad,blurs:out.blurs,levels:true,people:true,mime:out.mime,px,privacy_reviewed:true};
  }
  const name=geometry?.name||slot?.name||plan.name||'승인 대상',target={name,alias:slot?.alias||'report-'+r.id,before:slot?.image||null,px:faces.front?.px||null,...(geometry?{structure:geometry}:{})};
  if(j.kind==='structure'){const aid='structure-'+pid;effects.push({collection:'assets',id:aid,before:'null',after:{...geometry,id:aid,hidden:false,facades:Object.fromEntries(Object.keys(faces).map(side=>[side,'/api/public/proposal-images/'+pid+(side==='front'?'':'/'+side)])),proposal:pid},label:name,action:'create'});}
  if(j.kind==='facade'){if(!allowedKey(slot.alias))throw Error('파사드 자리 ID가 유효하지 않습니다.');effects.push({collection:'facades',id:slot.alias,before:JSON.stringify(layer.facades?.[slot.alias]??null),after:{front:'/api/public/proposal-images/'+pid,proposal:pid,at:stamp},label:name,action:'replace'});}
  if(!effectsSafe(effects))throw Error('실행할 검증 대상이 없습니다.');
  target.effects=effects;
  const meta={by:external?'dots':'server-ai',ai_job:j.id,report_version:j.report_version,faces,summary:plan.summary,provider:external?'dots':env.AI_PROVIDER||'anthropic',model:external?null:env.AI_MODEL,checks:null,...(external?{agent_link:external.link_id}:{}),...(plan.structure?{geometry_source:'agent-estimate',allow_estimate:true,structure_provenance:plan.structure_provenance}:{})};
  // Recheck access at save time: photo processing may span revocation or expiration.
  const linked=external?" AND EXISTS (SELECT 1 FROM agent_links WHERE id=? AND principal_id=? AND actor=? AND revoked_at IS NULL AND expires_at>?)":'',linkArgs=external?[external.link_id,external.principal,j.actor,now()]:[];
  const result=await db.batch([
   db.prepare("INSERT INTO proposals (id,station_key,report_ids,kind,target,meta,mime,size,confidence,status,reviewer,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM report_jobs WHERE id=? AND status='running') AND EXISTS (SELECT 1 FROM reports WHERE id=? AND status='accepted' AND updated_at=?) AND (SELECT COALESCE(sum(size),0) FROM report_photos)+(SELECT COALESCE(sum(size),0) FROM proposals)+?<=?"+linked).bind(pid,j.station_key,JSON.stringify([r.id]),j.kind,JSON.stringify(target),JSON.stringify(meta),faces.front?.mime||null,size,plan.confidence,'draft',j.actor,stamp,j.id,r.id,j.report_version,size,storageLimit(env),...linkArgs),
   db.prepare("UPDATE proposals SET status='superseded' WHERE report_ids=? AND id<>? AND status IN ('draft','ready') AND EXISTS (SELECT 1 FROM proposals WHERE id=?)").bind(JSON.stringify([r.id]),pid,pid),
   db.prepare("UPDATE report_jobs SET status='draft',plan=?,proposal_id=?,updated_at=? WHERE id=? AND status='running' AND EXISTS (SELECT 1 FROM proposals WHERE id=?)").bind(JSON.stringify(plan),pid,stamp,j.id,pid),
   auditCommand(db,j.actor,external?'dots.draft':'ai.draft',pid,{job:j.id,kind:j.kind,targets:effects.map(e=>e.id)},stamp,'draft')
  ]);
  saved=Boolean(result[0].meta.changes);if(!saved){const current=await db.prepare('SELECT status,updated_at FROM reports WHERE id=?').bind(r.id).first(),stale=!current||current.status!=='accepted'||current.updated_at!==j.report_version;
   const revoked=external&&!await db.prepare('SELECT id FROM agent_links WHERE id=? AND principal_id=? AND actor=? AND revoked_at IS NULL AND expires_at>?').bind(external.link_id,external.principal,j.actor,now()).first();
   await finishJob(env,j,stale||revoked?'cancelled':'failed',{error:revoked?'에비 연결이 해제·만료되어 초안 생성을 취소했습니다.':stale?'다른 창에서 변경되어 초안 생성을 취소했습니다.':'사진 저장 한도에 도달해 초안 생성을 중단했습니다.'});}
 }catch(e){await finishJob(env,j,'failed',{error:String(e.message||'자동 작업 실패').slice(0,500)});}
 finally{if(!saved&&env.UPLOADS?.delete)for(const key of staged)await env.UPLOADS.delete(key).catch(()=>{});}
}
// Called only after the existing approver auth + same-origin checks, not exposed to agents/anonymous visitors.
export async function aiWorkApi(request,env,ctx,{json,body,bytes,me,stationData,imageInfo,audit},matchedProposal=null){
 const u=new URL(request.url),p=u.pathname,db=env.DB;let m=p.match(/^\/api\/console\/ai-work\/([a-f0-9-]{36})(?:\/(cancel))?$/);
 const upload=p.match(/^\/api\/console\/reports\/([a-f0-9-]{36})\/photos$/);
 if(upload&&request.method==='POST'){
  const r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(upload[1]).first();if(!r||!['review','held','accepted'].includes(r.status)||request.headers.get('X-Report-Version')!==r.updated_at)return json({error:'제보 상태가 바뀌었습니다. 다시 불러오세요.'},409);
  const count=await db.prepare('SELECT count(*) AS n FROM report_photos WHERE report_id=?').bind(r.id).first();if(count.n>=5)return json({error:'사진은 제보당 최대 5장입니다. 보완 사진은 새 제보로 등록하고 기존 제보 번호를 적어 주세요.'},400);
  const data=await bytes(request,4_000_000),info=imageInfo(data),role=validatePhotoView(request.headers.get('X-Photo-View'));decodePhoto(data,info);
  const used=await db.prepare('SELECT (SELECT COALESCE(sum(size),0) FROM report_photos)+(SELECT COALESCE(sum(size),0) FROM proposals) AS n').first();if(used.n+data.length>storageLimit(env))return json({error:'제보 사진 저장 한도에 도달했습니다. 자동 증설하지 않습니다.'},429);
  const id=crypto.randomUUID(),stamp=new Date(Math.max(Date.now(),Date.parse(r.updated_at)+1)).toISOString();await env.UPLOADS.put('report/'+id,data,{httpMetadata:{contentType:info.mime}});
  let out;try{out=await db.batch([
   db.prepare("INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,caption,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reports WHERE id=? AND updated_at=? AND status IN ('review','held','accepted')) AND (SELECT count(*) FROM report_photos WHERE report_id=?)<5 AND (SELECT COALESCE(sum(size),0) FROM report_photos)+(SELECT COALESCE(sum(size),0) FROM proposals)+?<=?").bind(id,r.id,info.mime,data.length,info.width,info.height,role,'승인자 보완 사진',stamp,r.id,r.updated_at,r.id,data.length,storageLimit(env)),
   db.prepare("UPDATE reports SET updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM report_photos WHERE id=?)").bind(stamp,r.id,id),
   db.prepare("UPDATE report_jobs SET status='cancelled',updated_at=? WHERE report_id=? AND status IN ('queued','running','awaiting_external') AND EXISTS (SELECT 1 FROM report_photos WHERE id=?)").bind(stamp,r.id,id),
   db.prepare("UPDATE proposals SET status='superseded' WHERE report_ids=? AND status IN ('draft','ready') AND EXISTS (SELECT 1 FROM report_photos WHERE id=?)").bind(JSON.stringify([r.id]),id)
  ]);}catch(e){await env.UPLOADS.delete('report/'+id);throw e;}
  if(!out[0].meta.changes){await env.UPLOADS.delete('report/'+id);return json({error:'다른 창에서 사진·제보가 변경됐거나 저장 한도에 도달했습니다.'},409);}
  await audit(db,me.approver,'ai.photo-supplement',r.id,{photo:id,role});return json({id,updated_at:stamp},201);
 }
 if(m){
  if(m[2]==='cancel'&&request.method==='POST'){const n=await db.prepare("UPDATE report_jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running','awaiting_external')").bind(now(),m[1]).run();await audit(db,me.approver,'ai.cancel',m[1]);return json({cancelled:Boolean(n.meta.changes)});}
  if(request.method==='GET'){const j=await db.prepare('SELECT * FROM report_jobs WHERE id=?').bind(m[1]).first();if(!j)return json({error:'작업이 없습니다.'},404);const r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(j.report_id).first();await workDetail(env,r);return json({job:jobRow(await db.prepare('SELECT * FROM report_jobs WHERE id=?').bind(j.id).first())});}
 }
 if(p==='/api/console/ai-work'&&request.method==='POST'){
  const v=await body(),r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(v.report_id||'').first();
  if(!r||!['review','accepted','held'].includes(r.status))return json({error:'검토 중 제보에서 작업을 시작하세요.'},409);
  const input=inputOf(v,r),jid=v.request_id;if(!/^[a-f0-9-]{36}$/.test(jid||''))return json({error:'작업 요청 ID를 확인하세요.'},400);
  const old=await db.prepare('SELECT * FROM report_jobs WHERE id=?').bind(jid).first();if(old)return old.report_id===r.id&&old.actor===me.approver&&old.input===JSON.stringify(input)?json({job:jobRow(old)},202):json({error:'다른 내용의 중복 작업 ID입니다.'},409);
  if(v.report_version!==r.updated_at)return json({error:'제보가 변경됐습니다. 다시 불러오세요.'},409);
  const count=await db.prepare('SELECT count(*) AS n FROM report_jobs WHERE actor=? AND created_at>?').bind(me.approver,new Date(Date.now()-864e5).toISOString()).first();if(count.n>=40)return json({error:'자동 작업은 승인자별 하루 40회까지입니다. 기존 초안 확인 또는 수동 작업대를 이용하세요.'},429);
  const stamp=new Date(Math.max(Date.now(),Date.parse(r.updated_at)+1)).toISOString();
  const result=await db.batch([
   db.prepare("INSERT INTO report_jobs (id,report_id,station_key,kind,status,report_version,actor,input,questions,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'[]',?,? WHERE EXISTS (SELECT 1 FROM reports WHERE id=? AND updated_at=? AND status IN ('review','accepted','held')) AND (SELECT count(*) FROM report_jobs WHERE actor=? AND created_at>?)<40").bind(jid,r.id,r.station_key,input.kind,input.engine==='dots'?'awaiting_external':'queued',stamp,me.approver,JSON.stringify(input),stamp,stamp,r.id,r.updated_at,me.approver,new Date(Date.now()-864e5).toISOString()),
   db.prepare("UPDATE report_jobs SET status='cancelled',updated_at=? WHERE report_id=? AND id<>? AND status IN ('queued','running','awaiting_external') AND EXISTS (SELECT 1 FROM report_jobs WHERE id=?)").bind(stamp,r.id,jid,jid),
   db.prepare("UPDATE proposals SET status='superseded' WHERE report_ids=? AND status IN ('draft','ready') AND EXISTS (SELECT 1 FROM report_jobs WHERE id=?)").bind(JSON.stringify([r.id]),jid),
   db.prepare("UPDATE reports SET status='accepted',updated_at=?,history=json_insert(history,'$[#]',json(?)) WHERE id=? AND EXISTS (SELECT 1 FROM report_jobs WHERE id=?)").bind(stamp,JSON.stringify({status:'accepted',at:stamp,note:'승인자가 '+input.kind+' AI 초안 작업 시작 승인'}),r.id,jid)
  ]);
  if(!result[0].meta.changes)return json({error:'다른 창에서 변경됐습니다.'},409);
  await audit(db,me.approver,'ai.start',jid,{report:r.id,kind:input.kind});
  if(input.engine!=='dots'){const task=runWork(env,jid,{stationData,imageInfo});if(ctx?.waitUntil)ctx.waitUntil(task);else await task;}
  return json({job:jobRow(await db.prepare('SELECT * FROM report_jobs WHERE id=?').bind(jid).first())},202);
 }
 if(!matchedProposal)return null;
 const pr=matchedProposal,meta=parse(pr.meta,{}),target=parse(pr.target,{}),effects=target.effects,reportId=parse(pr.report_ids,[])[0],action=p.split('/').pop();
 if(!meta.ai_job)return null;
 if(action==='reject')return null; // Existing rejection action keeps its reason/audit behaviour, without consuming its body.
 const v=await body(),r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(reportId).first(),stamp=now();
 if(!effectsSafe(effects))return json({error:'검증된 변경 대상이 없습니다.'},409);
 if(action==='undo'){
  if(pr.status!=='applied'||!['removal','structure'].includes(pr.kind))return json({error:'적용된 자동 숨김·생성 작업만 되돌릴 수 있습니다.'},409);
  if(v.confirm!==true)return json({error:'숨김·생성 대상의 복원을 확인하세요.'},400);
  const reverse=effects.map(e=>({...e,before:JSON.stringify(e.after),after:parse(e.before)})),conds=guard(reverse),args=guardArgs(reverse,pr.station_key);
  const commands=[db.prepare("UPDATE proposals SET status='reverting' WHERE id=? AND status='applied' AND "+conds).bind(pr.id,...args)];
  for(const e of reverse){const sql=e.after===null?"json_remove(body,?)":"json_set(body,?,json(?))",bind=e.after===null?[path(e)]:[path(e),JSON.stringify(e.after)];commands.push(db.prepare("UPDATE station_layers SET revision=revision+1,body="+sql+",updated_at=? WHERE station_key=? AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='reverting')").bind(...bind,stamp,pr.station_key,pr.id));}
  commands.push(db.prepare("UPDATE reports SET status='review',updated_at=?,history=json_insert(history,'$[#]',json(?)) WHERE id=? AND status='applied' AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='reverting')").bind(stamp,JSON.stringify({status:'review',at:stamp,note:'승인자가 자동 작업 결과를 복원'}),reportId,pr.id),auditCommand(db,me.approver,'ai.undo',pr.id,{targets:effects.map(e=>e.id)},stamp,'reverting'),db.prepare("UPDATE proposals SET status='reverted',decided_at=? WHERE id=? AND status='reverting'").bind(stamp,pr.id));
  const out=await db.batch(commands);return out[0].meta.changes?json({id:pr.id,status:'reverted',note:'이 작업이 변경한 대상만 복원했습니다. 다른 승인 결과는 유지됩니다.'}):json({error:'승인 후 대상이 다시 변경돼 자동 복원할 수 없습니다. 현재 상태를 검토하세요.'},409);
 }
 if(!r||r.status!=='accepted'||r.updated_at!==meta.report_version)return json({error:'제보가 변경됐습니다. 새 초안을 생성하세요.'},409);
 if(action==='ready'){
  if(pr.status!=='draft'||![v.geometry_checked,v.privacy_checked,v.preview_checked,v.effects_checked].every(x=>x===true))return json({error:'위치·크기, 모든 사진의 개인정보, 결과 모형, 숨김·교체 대상 모두를 확인하세요.'},400);
  const out=await db.prepare("UPDATE proposals SET status='ready',meta=? WHERE id=? AND status='draft' AND EXISTS (SELECT 1 FROM reports WHERE id=? AND status='accepted' AND updated_at=?) AND "+guard(effects)).bind(JSON.stringify({...meta,checks:{geometry:true,privacy:true,preview:true,effects:true,by:me.approver,at:stamp}}),pr.id,r.id,meta.report_version,...guardArgs(effects,pr.station_key)).run();
  if(!out.meta.changes)return json({error:'변경 대상 또는 제보가 바뀌었습니다. 새 초안을 생성하세요.'},409);
  await audit(db,me.approver,'ai.ready',pr.id);return json({id:pr.id,status:'ready'});
 }
 if(action!=='approve')return null;
 if(pr.status!=='ready'||!meta.checks?.effects)return json({error:'저장된 초안 확인을 먼저 완료하세요.'},409);
 if(stationByKey(pr.station_key)?.locked)return json({error:'이 역은 지도 반영이 잠겨 있습니다.'},409);
 const commands=[db.prepare("UPDATE proposals SET status='applying' WHERE id=? AND status='ready' AND EXISTS (SELECT 1 FROM reports WHERE id=? AND status='accepted' AND updated_at=?) AND "+guard(effects)).bind(pr.id,r.id,meta.report_version,...guardArgs(effects,pr.station_key))];
 for(const e of effects)commands.push(db.prepare("INSERT INTO station_layers (station_key,revision,body,updated_at) SELECT ?,1,json_set('{}',?,json(?)),? WHERE EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying') ON CONFLICT(station_key) DO UPDATE SET revision=station_layers.revision+1,body=json_set(station_layers.body,?,json(?)),updated_at=excluded.updated_at").bind(pr.station_key,path(e),JSON.stringify(e.after),stamp,pr.id,path(e),JSON.stringify(e.after)));
 commands.push(db.prepare("UPDATE reports SET status='applied',reason=NULL,updated_at=?,history=json_insert(history,'$[#]',json(?)) WHERE id=? AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying')").bind(stamp,JSON.stringify({status:'applied',at:stamp,note:'AI 초안을 승인자가 최종 승인하여 지도 반영'}),r.id,pr.id),auditCommand(db,me.approver,'ai.applied',pr.id,{job:meta.ai_job,targets:effects.map(e=>e.id)},stamp,'applying'),db.prepare("UPDATE proposals SET status='applied',reviewer=?,decided_at=? WHERE id=? AND status='applying'").bind(me.approver,stamp,pr.id));
 const out=await db.batch(commands);return out[0].meta.changes?json({id:pr.id,status:'applied',note:'검증된 변경 대상을 지도에 반영했습니다.'}):json({error:'다른 창에서 대상 또는 제보가 변경됐습니다. 새 초안으로 다시 확인하세요.'},409);
}
