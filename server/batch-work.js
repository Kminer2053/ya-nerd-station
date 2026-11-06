import {chatConsoleApi} from './work-chat.js';
import {activeApprover} from './dots-auth.js';
const stamp=()=>new Date().toISOString(),idOk=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const active=['queued','awaiting_external','running','draft','ready','needs_info'];
const prompt=notes=>'제보 사진과 설명을 실제로 확인하고 제보 요청에 맞는 비공개 수정안을 준비해 주세요. 불명확한 점은 이 채팅에 질문하고, 치수 추정의 근거와 한계를 기록하세요. 최종 승인은 사람이 합니다.'+(notes?'\n추가 작업 지시: '+notes:'');
async function linked(db,actor){return db.prepare('SELECT id FROM agent_links WHERE actor=? AND principal_id IS NOT NULL AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(actor,stamp()).first();}
async function createBatch(env,actor,{id,station=null,ids=null,notes='',source='manual',schedule=null}){
 const requestKey=JSON.stringify({station,ids:ids?[...ids].sort():null,notes,source});
 const db=env.DB,old=await db.prepare('SELECT * FROM batch_runs WHERE id=?').bind(id).first();
 if(old){if(old.actor!==actor||old.request_key!==requestKey)throw fail('다른 일괄 요청에 사용한 전송 ID입니다.',409);return id;}
 if(!activeApprover(env,actor)||!await linked(db,actor))throw fail('유효한 Codex 연결이 필요합니다.',409);
 const where=["status IN ('review','held','accepted')","floor IS NOT NULL","position IS NOT NULL"],args=[];
 if(station){where.push('station_key=?');args.push(station);}if(ids){where.push('id IN ('+ids.map(()=>'?').join(',')+')');args.push(...ids);}
 // A station/all request advances past previously scheduled versions. Explicit
 // IDs keep their outcomes visible and are checked again before enqueue.
 if(!ids){where.push("NOT EXISTS (SELECT 1 FROM report_jobs j WHERE j.report_id=reports.id AND j.report_version=reports.updated_at AND j.status IN ('queued','awaiting_external','running','draft','ready','needs_info'))");where.push("NOT EXISTS (SELECT 1 FROM batch_items i JOIN batch_runs b ON b.id=i.run_id WHERE b.actor=? AND i.report_id=reports.id AND i.report_version=reports.updated_at AND i.status<>'cancelled')");args.push(actor);}
 const rows=(await db.prepare('SELECT id,updated_at FROM reports WHERE '+where.join(' AND ')+' ORDER BY created_at,id LIMIT 200').bind(...args).all()).results;
 const at=stamp(),guard=schedule?' WHERE EXISTS (SELECT 1 FROM batch_schedules WHERE actor=? AND enabled=1 AND next_run_at=? AND updated_at=?)':'',guardArgs=schedule?[actor,schedule.next_run_at,schedule.updated_at]:[];
 const commands=[db.prepare('INSERT OR IGNORE INTO batch_runs (id,actor,source,station_key,notes,request_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?'+guard).bind(id,actor,source,station,notes,requestKey,at,at,...guardArgs)];
 // Keep each statement below SQLite/D1's bounded parameter count.
 for(let start=0;start<rows.length;start+=16){const group=rows.slice(start,start+16);commands.push(db.prepare("INSERT OR IGNORE INTO batch_items (id,run_id,report_id,report_version,status,updated_at) SELECT column1,column2,column3,column4,'pending',column5 FROM (VALUES "+group.map(()=>'(?,?,?,?,?)').join(',')+") WHERE EXISTS (SELECT 1 FROM batch_runs WHERE id=? AND actor=? AND request_key=?)").bind(...group.flatMap(r=>[crypto.randomUUID(),id,r.id,r.updated_at,at]),id,actor,requestKey));}
 await db.batch(commands);
 const saved=await db.prepare('SELECT actor,request_key FROM batch_runs WHERE id=?').bind(id).first();if(saved&&(saved.actor!==actor||saved.request_key!==requestKey))throw fail('다른 일괄 요청에 사용한 전송 ID입니다.',409);
 return id;
}
async function overview(env,actor){
 const schedule=await env.DB.prepare('SELECT * FROM batch_schedules WHERE actor=?').bind(actor).first(),runs=(await env.DB.prepare('SELECT * FROM batch_runs WHERE actor=? ORDER BY created_at DESC,rowid DESC LIMIT 10').bind(actor).all()).results;
 for(const run of runs){const items=(await env.DB.prepare('SELECT i.report_id,i.status,i.job_id,i.error,j.status AS job_status,j.proposal_id FROM batch_items i LEFT JOIN report_jobs j ON j.id=i.job_id WHERE i.run_id=? ORDER BY i.rowid').bind(run.id).all()).results;run.items=items;run.counts=items.reduce((o,i)=>{const status=i.status==='queued'?i.job_status||'queued':i.status;o[status]=(o[status]||0)+1;return o;},{});}
 return {schedule:schedule?{...schedule,enabled:Boolean(schedule.enabled)}:null,runs,execution:'personal-companion',note:'연결된 개인 PC 작업자가 실행 중일 때 예약 작업이 수행됩니다. 결과는 제보별로 검토하고 최종 승인하세요.'};
}
export async function batchConsoleApi(request,env,helpers){
 const p=new URL(request.url).pathname;if(p!=='/api/console/batch-work')return null;
 const {json,me,body}=helpers,actor=me.approver;if(!activeApprover(env,actor))return json({error:'현재 승인자 로그인이 필요합니다.',login:true},401);
 if(request.method==='GET')return json(await overview(env,actor));if(request.method!=='POST')return json({error:'지원하지 않는 요청입니다.'},405);
 const v=await body();if(v.confirm!==true)throw fail('사진·설명에 따라 비공개 수정안을 일괄 작성할 범위를 확인하세요.');
 if(v.action==='cancel'){
  if(!idOk(v.run_id))throw fail('실행 ID를 확인하세요.');await env.DB.prepare("UPDATE batch_items SET status='cancelled',updated_at=? WHERE run_id IN (SELECT id FROM batch_runs WHERE id=? AND actor=?) AND status='pending'").bind(stamp(),v.run_id,actor).run();return json(await overview(env,actor));
 }
 const notes=typeof v.notes==='string'?v.notes.trim():'';if(notes.length>2000)throw fail('추가 지시는 2,000자까지입니다.');
 const station=v.station_key||null;if(station!==null&&!/^S\d{6}$/.test(station))throw fail('역을 확인하세요.');
 if(v.action==='schedule'){
  if(typeof v.enabled!=='boolean'||!Number.isInteger(v.interval_minutes)||v.interval_minutes<15||v.interval_minutes>10080)throw fail('예약 주기는 15분~7일이며 켜기·끄기를 지정하세요.');
  if(v.enabled&&!await linked(env.DB,actor))throw fail('예약을 켜기 전에 Codex를 연결하세요.',409);
  const at=stamp();await env.DB.prepare('INSERT INTO batch_schedules (actor,enabled,interval_minutes,station_key,notes,next_run_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,station_key=excluded.station_key,notes=excluded.notes,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at').bind(actor,v.enabled?1:0,v.interval_minutes,station,notes,new Date(Date.now()+v.interval_minutes*60000).toISOString(),at).run();
  if(!v.enabled)await env.DB.prepare("UPDATE batch_items SET status='cancelled',updated_at=? WHERE status='pending' AND run_id IN (SELECT id FROM batch_runs WHERE actor=? AND source='schedule')").bind(at,actor).run();
  return json(await overview(env,actor));
 }
 if(v.action!=='run'||!idOk(v.request_id))throw fail('일괄 실행 요청을 확인하세요.');
 if(v.report_ids!==undefined&&(!Array.isArray(v.report_ids)||!v.report_ids.length||v.report_ids.length>200||v.report_ids.some(id=>!idOk(id))||new Set(v.report_ids).size!==v.report_ids.length))throw fail('제보는 1~200건을 선택하세요.');
 await createBatch(env,actor,{id:v.request_id,station,ids:v.report_ids||null,notes});return json(await overview(env,actor),202);
}
export async function runDueBatches(env,actor,helpers){
 helpers={json:(data,status=200)=>Response.json(data,{status}),audit:async(db,by,action,target,detail)=>{await db.prepare('INSERT INTO audit_log (id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),by,action,target,JSON.stringify(detail||{}),stamp()).run();},...helpers};
 if(!activeApprover(env,actor)||!await linked(env.DB,actor))return;
 const db=env.DB,s=await db.prepare('SELECT * FROM batch_schedules WHERE actor=? AND enabled=1 AND next_run_at<=?').bind(actor,stamp()).first();
 if(s){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([actor,s.next_run_at,s.updated_at,s.station_key,s.notes])))),hex=[...hash].map(n=>n.toString(16).padStart(2,'0')).join(''),id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');await createBatch(env,actor,{id,station:s.station_key,notes:s.notes,source:'schedule',schedule:s});await db.prepare('UPDATE batch_schedules SET next_run_at=? WHERE actor=? AND enabled=1 AND next_run_at=? AND updated_at=?').bind(new Date(Date.now()+s.interval_minutes*60000).toISOString(),actor,s.next_run_at,s.updated_at).run();}
 const cutoff=new Date(Date.now()-120000).toISOString(),items=(await db.prepare("SELECT i.*,b.notes FROM batch_items i JOIN batch_runs b ON b.id=i.run_id WHERE b.actor=? AND (i.status='pending' OR i.status='enqueuing' AND i.updated_at<?) ORDER BY b.created_at,i.rowid LIMIT 3").bind(actor,cutoff).all()).results;
 for(const item of items){
  const claimed=await db.prepare("UPDATE batch_items SET status='enqueuing',updated_at=? WHERE id=? AND (status='pending' OR status='enqueuing' AND updated_at<?) AND EXISTS (SELECT 1 FROM batch_runs b WHERE b.id=batch_items.run_id AND b.actor=?)").bind(stamp(),item.id,cutoff,actor).run();if(!claimed.meta.changes)continue;
  const saved=await db.prepare("SELECT job_id FROM work_messages WHERE id=? AND report_id=? AND actor=? AND role='admin'").bind(item.id,item.report_id,actor).first();if(saved?.job_id){await db.prepare("UPDATE batch_items SET status='queued',job_id=?,error=NULL,updated_at=? WHERE id=? AND status='enqueuing'").bind(saved.job_id,stamp(),item.id).run();continue;}
  const report=await db.prepare('SELECT * FROM reports WHERE id=?').bind(item.report_id).first(),prior=await db.prepare("SELECT status FROM report_jobs WHERE report_id=? AND report_version=? AND status IN ('queued','awaiting_external','running','draft','ready','needs_info') LIMIT 1").bind(item.report_id,report?.updated_at||'').first();
  const error=!report||!['review','held','accepted'].includes(report.status)||report.updated_at!==item.report_version?'제보가 변경·종료되어 건너뛰었습니다.':active.includes(prior?.status)?'진행 중인 작업이나 검토할 결과가 있어 건너뛰었습니다.':null;
  if(error){await db.prepare("UPDATE batch_items SET status='skipped',error=?,updated_at=? WHERE id=? AND status='enqueuing'").bind(error,stamp(),item.id).run();continue;}
  try{
   const request=new Request('https://toolkit.internal/api/console/reports/'+report.id+'/chat',{method:'POST'}),response=await chatConsoleApi(request,env,null,{...helpers,me:{approver:actor},body:async()=>({request_id:item.id,text:prompt(item.notes),attachment_ids:[],start:true,confirm:true,report_version:item.report_version})}),data=await response.json();
   if(!response.ok)throw Error(data.error||'일괄 요청 저장 실패');await db.prepare("UPDATE batch_items SET status='queued',job_id=?,error=NULL,updated_at=? WHERE id=? AND status='enqueuing'").bind(data.job.id,stamp(),item.id).run();
  }catch(error){await db.prepare("UPDATE batch_items SET status='failed',error=?,updated_at=? WHERE id=? AND status='enqueuing'").bind(String(error.message).slice(0,300),stamp(),item.id).run();}
 }
}
