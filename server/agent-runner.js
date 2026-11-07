// Outbound personal companions only. This table never holds a Codex/OpenAI token.
const now=()=>new Date().toISOString();
const uuid={type:'string',pattern:'^[a-f0-9-]{36}$'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const write={...read,readOnlyHint:false};
const LEASE_MS=90_000,ONLINE_MS=45_000;
const safeCodes=['startup','authentication','connection','model','timeout','interrupted','lease_lost','no_result','protocol','filesystem','unknown'];
const jobTools=['toolkit_read_work','toolkit_read_conversation','toolkit_read_file','toolkit_send_message','toolkit_read_photo','toolkit_read_photo_original','toolkit_read_facade_reference','toolkit_store_draft_artifact','toolkit_submit_plan','toolkit_request_info'];
const identity={runner_id:uuid};
const lease={...identity,job_id:uuid,lease_token:{type:'string',pattern:'^[a-f0-9]{64}$'}};
export const runnerToolDefinitions=[
 ['toolkit_runner_register','개인 PC의 로컬 Codex 동반 작업자를 현재 초안 전용 연결에 등록합니다. OpenAI 토큰·비밀번호·최종 승인 권한은 전송하지 않습니다.',object({...identity,label:{type:'string',maxLength:80},report_id:uuid},['runner_id','label'])],
 ['toolkit_runner_heartbeat','로컬 동반 작업자의 생존과 현재 임대를 갱신합니다. 다른 작업 임대는 갱신하지 않습니다.',object({...lease,phase:{enum:['idle','working','attention']},error_code:{enum:safeCodes}},['runner_id','phase'])],
 ['toolkit_runner_claim','최신 대화·승인 범위의 대기 작업 한 건을 임대합니다. 만료·실패한 작업을 자동 중복 실행하지 않습니다.',object({...identity,request_id:uuid,lease_token:lease.lease_token},['runner_id','request_id','lease_token'])],
 ['toolkit_runner_begin','임대한 작업의 모델 실행을 한 번만 시작하도록 기록합니다. 재시작·응답 유실 시 같은 작업을 다시 실행하지 않습니다.',object(lease,['runner_id','job_id','lease_token'])],
 ['toolkit_runner_execute','유효한 개인 작업 임대 안에서 기존 초안 전용 도구를 실행합니다. 임의 작업·최종 승인·운영 명령은 허용하지 않습니다.',object({...lease,tool:{enum:jobTools},arguments:{type:'object'}},['runner_id','job_id','lease_token','tool','arguments'])],
 ['toolkit_runner_finish','실제 서버 초안·질문 결과를 확인하고 개인 동반 작업자의 임대를 종료합니다.',object({...lease,outcome:{enum:['draft','needs_info','failed','interrupted','superseded']},error_code:{enum:safeCodes}},['runner_id','job_id','lease_token','outcome'])]
].map(([name,description,inputSchema])=>({name,description,inputSchema,annotations:write}));
function fail(message,status=400){const e=Error(message);e.status=status;return e;}
function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw fail('허용되지 않은 동반 작업자 입력입니다.');}
function id(v){if(typeof v!=='string'||!/^[a-f0-9-]{36}$/.test(v))throw fail('작업자 또는 작업 식별자를 확인하세요.');}
async function hash(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const result=v=>({content:[{type:'text',text:JSON.stringify(v)}],structuredContent:v});
const parse=s=>{try{return JSON.parse(s);}catch{return {};}};
async function owner(env,link,principal,runnerId){id(runnerId);const r=await env.DB.prepare('SELECT * FROM agent_runners WHERE id=? AND actor=? AND principal_id=? AND link_id=? AND revoked_at IS NULL').bind(runnerId,link.actor,principal,link.id).first();if(!r)throw fail('개인 동반 작업자 연결이 없거나 해제됐습니다.',403);return r;}
async function context(env,runner,jobId){
 id(jobId);const j=await env.DB.prepare('SELECT j.* FROM report_jobs j JOIN reports r ON r.id=j.report_id WHERE j.id=? AND j.actor=? AND r.status=\'accepted\' AND r.updated_at=j.report_version').bind(jobId,runner.actor).first();
 if(!j||parse(j.input).engine!=='dots'||runner.report_id&&runner.report_id!==j.report_id||['cancelled','failed'].includes(j.status))throw fail('작업이 변경·취소됐습니다. 최신 작업을 확인하세요.',409);
 const anchor=parse(j.input).chat_message_id;if(anchor){const latest=await env.DB.prepare("SELECT id FROM work_messages WHERE report_id=? AND actor=? AND role='admin' ORDER BY rowid DESC LIMIT 1").bind(j.report_id,runner.actor).first();if(latest?.id!==anchor)throw fail('관리자 대화가 갱신됐습니다. 최신 작업을 확인하세요.',409);}
 return j;
}
async function validLease(env,runner,v){
 id(v.job_id);if(typeof v.lease_token!=='string'||!/^[a-f0-9]{64}$/.test(v.lease_token))throw fail('작업 임대 인증을 확인하세요.',403);
 const r=await env.DB.prepare("SELECT * FROM agent_runner_leases WHERE job_id=? AND runner_id=? AND token_hash=? AND status='active' AND lease_until>?").bind(v.job_id,runner.id,await hash(v.lease_token),now()).first();if(!r)throw fail('작업 임대가 종료됐습니다. 최신 작업 재시도로 이어 주세요.',409);return r;
}
async function assertLink(env,link,principal){const r=await env.DB.prepare('SELECT id FROM agent_links WHERE id=? AND actor=? AND principal_id=? AND revoked_at IS NULL AND expires_at>?').bind(link.id,link.actor,principal,now()).first();if(!r)throw fail('초안 전용 연결이 만료·해제됐습니다.',403);}
export async function runnerAgentTool(name,v,env,link,principal,{execute,beforeClaim}={}){
 const def=runnerToolDefinitions.find(d=>d.name===name);if(!def)return null;keys(v,Object.keys(def.inputSchema.properties));await assertLink(env,link,principal);id(v.runner_id);
 const db=env.DB;
 let at=now();
 if(name==='toolkit_runner_register'){
  if(typeof v.label!=='string'||!v.label.trim()||v.label.length>80)throw fail('개인 작업자 이름은 1~80자로 입력하세요.');if(v.report_id)id(v.report_id);
  if(v.report_id&&!await db.prepare("SELECT r.id FROM reports r JOIN report_jobs j ON j.report_id=r.id WHERE r.id=? AND j.actor=? AND r.status='accepted' AND json_extract(j.input,'$.engine')='dots' LIMIT 1").bind(v.report_id,link.actor).first())throw fail('맡긴 제보 범위가 아닙니다.',404);
  await db.prepare("INSERT INTO agent_runners (id,actor,principal_id,link_id,label,report_id,phase,created_at,last_seen_at) VALUES (?,?,?,?,?,?,'idle',?,?) ON CONFLICT(id) DO NOTHING").bind(v.runner_id,link.actor,principal,link.id,v.label.trim(),v.report_id||null,at,at).run();
  const existing=await db.prepare('SELECT * FROM agent_runners WHERE id=?').bind(v.runner_id).first();
  if(!existing||existing.actor!==link.actor||existing.principal_id!==principal||existing.revoked_at)throw fail('다른 승인자·GPT 계정의 작업자 식별자는 재사용할 수 없습니다. 새 전용 작업 폴더로 연결하세요.',403);
  if(existing.report_id!==(v.report_id||null))throw fail('기존 작업자의 제보 범위를 바꿀 수 없습니다. 별도 작업 폴더를 사용하세요.',409);
  let reconnected=false;
  if(existing.link_id!==link.id){
   const old=await db.prepare('SELECT actor,principal_id,revoked_at,expires_at FROM agent_links WHERE id=?').bind(existing.link_id).first();
   if(!old||old.actor!==link.actor||old.principal_id!==principal||!old.revoked_at&&old.expires_at>at)throw fail('이전 연결이 아직 유효합니다. 이전 연결을 해제한 뒤 같은 계정으로 다시 등록하세요.',409);
   // A new link must never revive an in-flight model or an old lease. Wait for
   // the bounded lease before rebinding, then retire expired leases atomically.
   if(await db.prepare("SELECT job_id FROM agent_runner_leases WHERE runner_id=? AND status='active' AND lease_until>? LIMIT 1").bind(existing.id,at).first())throw fail('이전 연결의 작업 임대가 아직 진행 중입니다. 최대 90초 후 다시 연결하세요. 중단된 작업은 최신 작업 재시도로 이어 주세요.',409);
   const updated=await db.batch([
    db.prepare("UPDATE agent_runners SET link_id=?,last_seen_at=? WHERE id=? AND actor=? AND principal_id=? AND link_id=? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM agent_links a WHERE a.id=? AND a.actor=? AND a.principal_id=? AND (a.revoked_at IS NOT NULL OR a.expires_at<=?)) AND EXISTS (SELECT 1 FROM agent_links a WHERE a.id=? AND a.actor=? AND a.principal_id=? AND a.revoked_at IS NULL AND a.expires_at>?) AND NOT EXISTS (SELECT 1 FROM agent_runner_leases l WHERE l.runner_id=agent_runners.id AND l.status='active' AND l.lease_until>?)").bind(link.id,at,existing.id,link.actor,principal,existing.link_id,existing.link_id,link.actor,principal,at,link.id,link.actor,principal,at,at),
    db.prepare("UPDATE agent_runner_leases SET status='finished',outcome='interrupted',error_code='lease_lost',updated_at=? WHERE runner_id=? AND status='active' AND lease_until<=? AND EXISTS (SELECT 1 FROM agent_runners a WHERE a.id=? AND a.link_id=? AND a.actor=? AND a.principal_id=? AND a.revoked_at IS NULL)").bind(at,existing.id,at,existing.id,link.id,link.actor,principal)
   ]);reconnected=Boolean(updated[0].meta.changes);
   if(!reconnected&&(await db.prepare('SELECT link_id FROM agent_runners WHERE id=?').bind(existing.id).first())?.link_id!==link.id)throw fail('재연결 조건이나 이전 작업 임대가 변경됐습니다. 진행 중인 작업이 끝난 뒤 다시 등록하세요.',409);
  }
  const r=await owner(env,link,principal,v.runner_id);if(r.report_id!==(v.report_id||null))throw fail('기존 작업자의 제보 범위를 바꿀 수 없습니다. 별도 작업 폴더를 사용하세요.',409);
  return result({runner_id:r.id,scope:r.report_id?'single-report':'assigned-drafts-only',reconnected,heartbeat_ms:15_000,lease_ms:LEASE_MS,can_approve:false});
 }
 const runner=await owner(env,link,principal,v.runner_id);
 if(name==='toolkit_runner_heartbeat'){
  if(!['idle','working','attention'].includes(v.phase)||v.error_code&&!safeCodes.includes(v.error_code))throw fail('작업자 상태를 확인하세요.');
  if(v.job_id){await validLease(env,runner,v);await context(env,runner,v.job_id);const renewed=await db.prepare("UPDATE agent_runner_leases SET lease_until=?,updated_at=? WHERE job_id=? AND runner_id=? AND token_hash=? AND status='active' AND lease_until>?").bind(new Date(Date.now()+LEASE_MS).toISOString(),at,v.job_id,runner.id,await hash(v.lease_token),at).run();if(!renewed.meta.changes)throw fail('작업 임대가 종료됐습니다.',409);}
  else if(v.phase==='working'||v.lease_token)throw fail('진행 중인 작업 임대를 확인하세요.');
  await db.prepare('UPDATE agent_runners SET last_seen_at=?,phase=?,error_code=? WHERE id=? AND revoked_at IS NULL').bind(at,v.phase,v.error_code||null,runner.id).run();return result({online:true,can_approve:false});
 }
 if(name==='toolkit_runner_claim'){
  id(v.request_id);if(typeof v.lease_token!=='string'||!/^[a-f0-9]{64}$/.test(v.lease_token))throw fail('작업 임대 인증을 확인하세요.');const tokenHash=await hash(v.lease_token);
  if(!runner.report_id&&beforeClaim){
   await beforeClaim();
   await assertLink(env,link,principal);
   at=now();
  }
  const prior=await db.prepare('SELECT * FROM agent_runner_leases WHERE runner_id=? AND request_id=?').bind(runner.id,v.request_id).first();
  if(prior){if(prior.token_hash!==tokenHash)throw fail('동일 요청의 임대 인증이 다릅니다.',409);if(prior.status!=='active'||prior.lease_until<=at)return result({job:null,attention:true,reason:'lease_ended',can_approve:false});let j;try{j=await context(env,runner,prior.job_id);}catch(e){if(e.status!==409)throw e;await db.prepare("UPDATE agent_runner_leases SET status='finished',outcome='superseded',updated_at=? WHERE job_id=? AND runner_id=? AND status='active'").bind(at,prior.job_id,runner.id).run();return result({job:null,attention:true,reason:'latest_job_changed',can_approve:false});}return result({job:{job_id:j.id,report_id:j.report_id,status:j.status,updated_at:j.updated_at,already_started:Boolean(prior.started_at)},lease_until:prior.lease_until,can_approve:false});}
  const until=new Date(Date.now()+LEASE_MS).toISOString();
  const out=await db.prepare("INSERT INTO agent_runner_leases (job_id,runner_id,request_id,token_hash,status,lease_until,created_at,updated_at) SELECT j.id,?,?,?,'active',?,?,? FROM report_jobs j JOIN reports r ON r.id=j.report_id WHERE j.actor=? AND json_extract(j.input,'$.engine')='dots' AND j.status='awaiting_external' AND r.status='accepted' AND r.updated_at=j.report_version AND (? IS NULL OR j.report_id=?) AND (json_extract(j.input,'$.chat_message_id') IS NULL OR json_extract(j.input,'$.chat_message_id')=(SELECT m.id FROM work_messages m WHERE m.report_id=j.report_id AND m.actor=j.actor AND m.role='admin' ORDER BY m.rowid DESC LIMIT 1)) AND NOT EXISTS (SELECT 1 FROM agent_runner_leases x WHERE x.job_id=j.id) AND NOT EXISTS (SELECT 1 FROM agent_runner_leases x WHERE x.runner_id=? AND x.status='active' AND x.lease_until>?) AND EXISTS (SELECT 1 FROM agent_links a WHERE a.id=? AND a.principal_id=? AND a.revoked_at IS NULL AND a.expires_at>?) AND EXISTS (SELECT 1 FROM agent_runners a WHERE a.id=? AND a.revoked_at IS NULL) ORDER BY j.created_at ASC,j.rowid ASC LIMIT 1 ON CONFLICT DO NOTHING").bind(runner.id,v.request_id,tokenHash,until,at,at,runner.actor,runner.report_id,runner.report_id,runner.id,at,link.id,principal,at,runner.id).run();
  const claimed=await db.prepare('SELECT j.id AS job_id,j.report_id,j.status,j.updated_at FROM report_jobs j JOIN agent_runner_leases l ON l.job_id=j.id WHERE l.runner_id=? AND l.request_id=?').bind(runner.id,v.request_id).first();
  return result({job:claimed||null,...(out.meta.changes?{lease_until:until}:{}),can_approve:false});
 }
 if(name==='toolkit_runner_begin'){
  await validLease(env,runner,v);const job=await context(env,runner,v.job_id);if(job.status!=='awaiting_external')throw fail('이미 처리 중이거나 종료된 작업입니다.',409);
  const changed=await db.prepare("UPDATE agent_runner_leases SET started_at=?,updated_at=? WHERE job_id=? AND runner_id=? AND token_hash=? AND status='active' AND lease_until>? AND started_at IS NULL").bind(at,at,v.job_id,runner.id,await hash(v.lease_token),at).run();if(!changed.meta.changes)throw fail('동일 작업의 모델 실행이 이미 시작됐습니다. 최신 작업 재시도로 이어 주세요.',409);return result({started:true,can_approve:false});
 }
 if(name==='toolkit_runner_execute'){
  await validLease(env,runner,v);await context(env,runner,v.job_id);if(!jobTools.includes(v.tool)||!v.arguments||typeof v.arguments!=='object'||Array.isArray(v.arguments)||v.arguments.job_id!==v.job_id)throw fail('현재 임대 작업의 초안 도구만 실행할 수 있습니다.',403);if(!execute)throw fail('작업 실행 경로가 준비되지 않았습니다.',503);return execute(v.tool,v.arguments);
 }
 if(name==='toolkit_runner_finish'){
  if(!['draft','needs_info','failed','interrupted','superseded'].includes(v.outcome)||v.error_code&&!safeCodes.includes(v.error_code))throw fail('작업 종료 상태를 확인하세요.');
  const digest=await hash(v.lease_token||''),previous=await db.prepare('SELECT * FROM agent_runner_leases WHERE job_id=? AND runner_id=? AND token_hash=?').bind(v.job_id,runner.id,digest).first();
  if(previous&&previous.status!=='active'){if(previous.outcome!==v.outcome)throw fail('이미 다른 결과로 종료된 임대입니다.',409);return result({finished:true,outcome:previous.outcome,can_approve:false});}
  await validLease(env,runner,v);
  if(['draft','needs_info'].includes(v.outcome)){const j=await context(env,runner,v.job_id);if(j.status!==v.outcome)throw fail('서버에 실제 초안·질문이 저장되지 않았습니다.',409);}
  const changed=await db.prepare("UPDATE agent_runner_leases SET status='finished',outcome=?,error_code=?,updated_at=? WHERE job_id=? AND runner_id=? AND token_hash=? AND status='active' AND lease_until>?").bind(v.outcome,v.error_code||null,at,v.job_id,runner.id,digest,at).run();if(!changed.meta.changes)throw fail('작업 임대가 종료됐습니다.',409);
  await db.prepare('UPDATE agent_runners SET phase=?,error_code=?,last_seen_at=? WHERE id=?').bind(['failed','interrupted'].includes(v.outcome)?'attention':'idle',v.error_code||null,at,runner.id).run();return result({finished:true,outcome:v.outcome,can_approve:false});
 }
}
// The caller has already checked the approver cookie and same-origin policy.
export async function runnerConsoleApi(request,env,{json,me}){
 if(new URL(request.url).pathname!=='/api/console/agent-runners')return null;if(request.method!=='GET')return json({error:'지원하지 않는 요청입니다.'},405);
 const at=now(),rows=(await env.DB.prepare('SELECT r.id,r.label,r.report_id,r.phase,r.error_code,r.last_seen_at,r.revoked_at,a.revoked_at AS link_revoked,a.expires_at AS link_expires FROM agent_runners r JOIN agent_links a ON a.id=r.link_id WHERE r.actor=? ORDER BY r.last_seen_at DESC LIMIT 20').bind(me.approver).all()).results;
 const runners=[];for(const r of rows){const leases=(await env.DB.prepare("SELECT l.job_id,l.status,l.outcome,l.error_code,l.lease_until,l.updated_at,j.status AS job_status FROM agent_runner_leases l JOIN report_jobs j ON j.id=l.job_id WHERE l.runner_id=? ORDER BY l.updated_at DESC LIMIT 10").bind(r.id).all()).results;const active=leases.find(l=>l.status==='active');runners.push({id:r.id,label:r.label,report_id:r.report_id,online:!r.revoked_at&&!r.link_revoked&&r.link_expires>at&&Date.parse(r.last_seen_at)>Date.now()-ONLINE_MS,phase:active&&active.lease_until<=at?'attention':r.phase,error_code:active&&active.lease_until<=at?'lease_lost':r.error_code,last_seen_at:r.last_seen_at,jobs:leases.map(l=>({...l,needs_retry:['awaiting_external','running','failed'].includes(l.job_status)&&(l.status==='active'&&l.lease_until<=at||['failed','interrupted'].includes(l.outcome))}))});}
 return json({runners,can_approve:false});
}
