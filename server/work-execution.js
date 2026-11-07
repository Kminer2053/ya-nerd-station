export const RUNNER_ONLINE_MS=45_000;

export const runnerCutoff=at=>new Date(Date.parse(at)-RUNNER_ONLINE_MS).toISOString();

// A successful submission supersedes earlier validation errors, including in old rows.
export function workError(job){
 return ['draft','ready','applied'].includes(job.status)?null:job.error;
}

export function onlineRunner(db,actor,at,reportId=null){
 return db.prepare(`SELECT r.id,r.label,r.phase,r.error_code,r.last_seen_at
  FROM agent_runners r JOIN agent_links a ON a.id=r.link_id
  WHERE r.actor=? AND a.actor=r.actor AND a.principal_id=r.principal_id
    AND r.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>?
    AND r.last_seen_at>? AND (r.report_id IS NULL OR r.report_id=?)
  ORDER BY r.last_seen_at DESC LIMIT 1`).bind(actor,at,runnerCutoff(at),reportId).first();
}

export function workExecution(job,lease,{at,available}){
 if(!job)return null;
 const active=lease?.status==='active';
 const leaseLost=active&&(lease.lease_until<=at||!lease.authorized);
 const online=Boolean(active&&!leaseLost?lease.online:available);
 let state,updatedAt=job.updated_at,errorCode=null;
 switch(job.status){
  case 'applied':state='applied';break;
  case 'draft':
  case 'ready':state=job.proposal_status==='applied'?'applied':'draft_submitted';break;
  case 'needs_info':state='needs_info';break;
  case 'cancelled':state='cancelled';break;
  case 'failed':state='failed';break;
  default:
   if(lease?.outcome==='failed'){
    state='failed';updatedAt=lease.updated_at;errorCode=lease.error_code;
   }else if(leaseLost||lease?.outcome==='interrupted'){
    state='interrupted';updatedAt=leaseLost&&lease.lease_until<=at?lease.lease_until:lease.updated_at;errorCode=lease.error_code||'lease_lost';
   }else if(active&&online){
    state=lease.started_at?'working':'received';updatedAt=lease.started_at||lease.created_at;
   }else if(active){
    state='offline';updatedAt=lease.last_seen_at||lease.created_at;
   }else if(job.status==='running'){
    state='working';
   }else{
    state=online?'waiting':'offline';
   }
 }
 let input={};
 try{input=JSON.parse(job.input||'{}')||{};}catch{}
 return {
  state,job_id:job.id,message_id:input.chat_message_id||null,parent_job_id:input.parent_job_id||null,
  updated_at:updatedAt,retryable:state==='failed'||state==='interrupted',runner_online:online,
  ...(errorCode?{error_code:errorCode}:{}),
 };
}
