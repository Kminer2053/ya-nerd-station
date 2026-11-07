import {chatConsoleApi} from './work-chat.js';
import {activeApprover} from './dots-auth.js';
import {onlineRunner,runnerCutoff,workExecution} from './work-execution.js';
const stamp=()=>new Date().toISOString(),idOk=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const active=['queued','awaiting_external','running','draft','ready','needs_info'];
const prompt=notes=>'제보 사진과 설명을 실제로 확인하고 제보 요청에 맞는 비공개 수정안을 준비해 주세요. 불명확한 점은 이 채팅에 질문하고, 치수 추정의 근거와 한계를 기록하세요. 최종 승인은 사람이 합니다.'+(notes?'\n추가 작업 지시: '+notes:'');
async function linked(db,actor){return db.prepare('SELECT id FROM agent_links WHERE actor=? AND principal_id IS NOT NULL AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(actor,stamp()).first();}
async function createBatch(env,actor,{id,station=null,ids=null,notes='',source='manual',schedule=null}){
 const requestKey=JSON.stringify({station,ids:ids?[...ids].sort():null,notes,source});
 const db=env.DB;
 const alreadySaved=async()=>{
  const row=await db.prepare('SELECT actor,request_key FROM batch_runs WHERE id=?').bind(id).first();
  if(row&&(row.actor!==actor||row.request_key!==requestKey))throw fail('다른 일괄 요청에 사용한 전송 ID입니다.',409);
  return Boolean(row);
 };
 if(await alreadySaved())return id;
 if(!activeApprover(env,actor)||!await linked(db,actor))throw fail('유효한 Codex 연결이 필요합니다.',409);
 const where=["status IN ('review','held','accepted')","floor IS NOT NULL","position IS NOT NULL"],args=[];
 if(station){where.push('station_key=?');args.push(station);}
 if(ids){where.push('id IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(ids));}
 // A station/all request advances past previously scheduled versions. Explicit
 // IDs keep their outcomes visible and are checked again before enqueue.
 if(!ids){where.push("NOT EXISTS (SELECT 1 FROM report_jobs j WHERE j.report_id=reports.id AND j.report_version=reports.updated_at AND j.status IN ('queued','awaiting_external','running','draft','ready','needs_info'))");where.push("NOT EXISTS (SELECT 1 FROM batch_items i JOIN batch_runs b ON b.id=i.run_id WHERE b.actor=? AND i.report_id=reports.id AND i.report_version=reports.updated_at AND i.status<>'cancelled')");args.push(actor);}
 const rows=(await db.prepare('SELECT id,updated_at FROM reports WHERE '+where.join(' AND ')+' ORDER BY created_at,id LIMIT 200').bind(...args).all()).results;
 if(!rows.length){
  if(await alreadySaved())return id;
  if(source==='schedule')return null;
  throw fail('이 범위에 맡길 수 있는 제보가 없습니다. 층과 위치가 있는 검토 대상 제보를 선택해 주세요.',409);
 }
 const at=stamp(),guard=schedule?'EXISTS (SELECT 1 FROM batch_schedules WHERE actor=? AND enabled=1 AND next_run_at=? AND updated_at=?)':'',guardArgs=schedule?[actor,schedule.next_run_at,schedule.updated_at]:[];
 const commands=[db.prepare('INSERT INTO batch_runs (id,actor,source,station_key,notes,request_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?'+(guard?' WHERE '+guard:'')).bind(id,actor,source,station,notes,requestKey,at,at,...guardArgs)];
 // Keep each statement below SQLite/D1's bounded parameter count.
 for(let start=0;start<rows.length;start+=16){
  const group=rows.slice(start,start+16);
  const values=group.map(()=>'(?,?,?,?,?)').join(',');
  commands.push(db.prepare("INSERT INTO batch_items (id,run_id,report_id,report_version,status,updated_at) SELECT column1,column2,column3,column4,'pending',column5 FROM (VALUES "+values+") WHERE EXISTS (SELECT 1 FROM batch_runs WHERE id=? AND actor=? AND request_key=?)"+(guard?' AND '+guard:''))
   .bind(...group.flatMap(r=>[crypto.randomUUID(),id,r.id,r.updated_at,at]),id,actor,requestKey,...guardArgs));
 }
 // A collision rolls back the entire second write and leaves the first run's
 // candidate set intact even if new reports arrived between the two reads.
 try{await db.batch(commands);}catch(error){if(!await alreadySaved())throw error;}
 return id;
}
async function overview(env,actor){
 const db=env.DB,at=stamp(),cutoff=runnerCutoff(at);
 const [schedule,{results:runs},worker,scopedWorker]=await Promise.all([
  db.prepare('SELECT * FROM batch_schedules WHERE actor=?').bind(actor).first(),
  db.prepare('SELECT id,source,station_key,created_at FROM batch_runs WHERE actor=? ORDER BY created_at DESC,rowid DESC LIMIT 10').bind(actor).all(),
  onlineRunner(db,actor,at),
  db.prepare(`SELECT r.id FROM agent_runners r JOIN agent_links a ON a.id=r.link_id
   WHERE r.actor=? AND r.report_id IS NOT NULL AND r.revoked_at IS NULL AND r.last_seen_at>?
     AND a.actor=r.actor AND a.principal_id=r.principal_id AND a.revoked_at IS NULL AND a.expires_at>?
   LIMIT 1`).bind(actor,cutoff,at).first(),
 ]);
 for(const run of runs){
  const {results}=await db.prepare(`WITH RECURSIVE attempts(item_id,job_id,report_id,created_at) AS (
    SELECT i.id,j.id,i.report_id,j.created_at FROM batch_items i
    JOIN report_jobs j ON j.id=i.job_id AND j.report_id=i.report_id AND j.actor=?
    WHERE i.run_id=?
    UNION ALL
    SELECT a.item_id,j.id,a.report_id,j.created_at FROM attempts a
    JOIN report_jobs j ON j.report_id=a.report_id AND j.actor=? AND j.created_at>a.created_at
      AND json_extract(j.input,'$.parent_job_id')=a.job_id
   ), latest AS (
    SELECT item_id,job_id,row_number() OVER (PARTITION BY item_id ORDER BY created_at DESC,job_id DESC) AS rank
    FROM attempts
   )
   SELECT i.report_id,i.status,i.job_id,i.error,j.id AS current_job_id,
    substr(r.description,1,100) AS description,r.station_key,r.floor,
    j.status AS job_status,j.updated_at AS job_updated_at,j.input AS job_input,j.proposal_id,p.status AS proposal_status,
    l.status AS lease_status,l.outcome,l.error_code,l.lease_until,l.started_at,
    l.created_at AS lease_created_at,l.updated_at AS lease_updated_at,a.last_seen_at,
    (a.revoked_at IS NULL AND k.revoked_at IS NULL AND k.expires_at>? AND k.actor=a.actor AND k.principal_id=a.principal_id) AS authorized,
    a.last_seen_at>? AS online
   FROM batch_items i JOIN reports r ON r.id=i.report_id
   LEFT JOIN latest ON latest.item_id=i.id AND latest.rank=1
   LEFT JOIN report_jobs j ON j.id=latest.job_id
   LEFT JOIN proposals p ON p.id=j.proposal_id AND p.reviewer=j.actor
   LEFT JOIN agent_runner_leases l ON l.job_id=j.id
   LEFT JOIN agent_runners a ON a.id=l.runner_id AND a.actor=j.actor
   LEFT JOIN agent_links k ON k.id=a.link_id
   WHERE i.run_id=? ORDER BY i.rowid`).bind(actor,run.id,actor,at,cutoff,run.id).all();
  run.items=results.map(row=>{
   const job=row.job_status?{id:row.current_job_id,status:row.job_status,updated_at:row.job_updated_at,input:row.job_input,proposal_status:row.proposal_status}:null;
   const lease=row.lease_status?{...row,status:row.lease_status,created_at:row.lease_created_at,updated_at:row.lease_updated_at}:null;
   const execution=workExecution(job,lease,{at,available:worker});
   return {report_id:row.report_id,description:row.description,station_key:row.station_key,floor:row.floor,
    status:row.status,error:row.error,job_id:row.job_id,current_job_id:row.current_job_id,job_status:row.job_status,proposal_id:row.proposal_id,state:execution?.state||row.status};
  });
  run.counts=run.items.reduce((counts,item)=>{counts[item.state]=(counts[item.state]||0)+1;return counts;},{});
 }
 const workerStatus=worker?'online':scopedWorker?'single-report':'offline';
 return {schedule:schedule?{...schedule,enabled:Boolean(schedule.enabled)}:null,runs,execution:'personal-companion',worker_status:workerStatus,
  note:worker?'연결된 Codex 작업자가 맡긴 제보를 차례로 처리합니다. 수정안은 제보별로 검토하고 승인하세요.':scopedWorker?'현재 작업자는 한 제보 전용입니다. 일괄 작업은 여러 제보를 받을 수 있는 Codex 작업자가 켜지면 이어집니다.':'일괄 요청은 저장됩니다. 여러 제보를 받을 수 있는 개인 PC Codex 작업자가 켜지면 차례로 처리합니다.'};
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
  const at=stamp();
  const save=env.DB.prepare('INSERT INTO batch_schedules (actor,enabled,interval_minutes,station_key,notes,next_run_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,station_key=excluded.station_key,notes=excluded.notes,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at').bind(actor,v.enabled?1:0,v.interval_minutes,station,notes,new Date(Date.now()+v.interval_minutes*60000).toISOString(),at);
  if(v.enabled)await save.run();
  else await env.DB.batch([save,env.DB.prepare("UPDATE batch_items SET status='cancelled',updated_at=? WHERE status='pending' AND run_id IN (SELECT id FROM batch_runs WHERE actor=? AND source='schedule')").bind(at,actor)]);
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
