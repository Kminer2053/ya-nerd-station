import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
export const RUNNER_TOOLS=['toolkit_runner_register','toolkit_runner_heartbeat','toolkit_runner_claim','toolkit_runner_begin','toolkit_runner_execute','toolkit_runner_finish'];
const uuid=/^[a-f0-9-]{36}$/;
const save=async(file,value)=>{const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);};
export function diagnosticCode(error){const text=String(error?.message||error);return /lease|임대/.test(text)?'lease_lost':/timeout|시간|제한 시간/i.test(text)?'timeout':/auth|login|계정|로그인|401|403/i.test(text)?'authentication':/sandbox|프로필|읽기|filesystem/i.test(text)?'filesystem':/protocol|JSON|프로토콜/i.test(text)?'protocol':/model|모델|400/i.test(text)?'model':/중단|interrupt/i.test(text)?'interrupted':'unknown';}
// Nonces stay in this host. Neither model prompts nor hosted state gets a Codex token.
export class CompanionSession{
 constructor({call,jsonValue,workspace,reportId,label='개인 PC Codex',onLost=()=>{},log=()=>{}}){Object.assign(this,{call,jsonValue,workspace,reportId,label,onLost,log});this.active=null;this.lost=null;this.timer=null;this.pulsePending=null;}
 async start(){
  this.file=path.join(this.workspace,'companion.json');try{this.state=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.state={runner_id:randomUUID(),report_id:this.reportId||null};await save(this.file,this.state);}
  if(!uuid.test(this.state.runner_id||'')||this.state.report_id!==(this.reportId||null))throw Error('개인 작업자 식별자·제보 범위를 확인하세요. 별도 작업 폴더를 사용하세요.');
  await this.rpc('toolkit_runner_register',{runner_id:this.state.runner_id,label:this.label,...(this.reportId?{report_id:this.reportId}:{})});
  await this.pulse();this.timer=setInterval(()=>this.pulse().catch(error=>{this.lost=error;this.onLost(error);}),15000);this.timer.unref();
  this.log({event:'companion_online',runner_id:this.state.runner_id,scope:this.reportId?'single-report':'assigned-drafts-only',heartbeat_ms:15000,can_approve:false});
 }
 rpc(tool,args){return this.call(tool,args).then(this.jsonValue);}
 async pulse(){if(this.pulsePending)return this.pulsePending;this.pulsePending=this.rpc('toolkit_runner_heartbeat',{runner_id:this.state.runner_id,phase:this.active?'working':'idle',...(this.active?{job_id:this.active.job.job_id,lease_token:this.active.token}:{})});try{return await this.pulsePending;}finally{this.pulsePending=null;}}
 async claim(){
  if(this.lost)throw this.lost;if(this.active)throw Error('이미 실행 중인 작업 임대가 있습니다.');
  const pending=this.state.pending||{request_id:randomUUID(),token:randomBytes(32).toString('hex')};this.state.pending=pending;await save(this.file,this.state);
  const response=await this.rpc('toolkit_runner_claim',{runner_id:this.state.runner_id,request_id:pending.request_id,lease_token:pending.token});
  // Keep a successful claim on disk until finish; restart reuses the same nonce.
  if(response.job){this.active={job:response.job,token:pending.token};await this.pulse();if(['draft','needs_info'].includes(response.job.status)){await this.finish(response.job.status);return null;}if(response.job.status!=='awaiting_external'||response.job.already_started){await this.finish('interrupted',Error('이전 작업 중단'));this.log({event:'companion_attention',reason:'previous_model_run_not_replayed',job_id:response.job.job_id});return null;}return response.job;}
  delete this.state.pending;await save(this.file,this.state);if(response.attention)this.log({event:'companion_attention',reason:response.reason||'lease_ended'});return null;
 }
 async jobCall(tool,args){if(this.lost)throw this.lost;if(!this.active||args.job_id!==this.active.job.job_id)throw Error('현재 작업 임대 범위가 아닙니다.');return this.call('toolkit_runner_execute',{runner_id:this.state.runner_id,job_id:this.active.job.job_id,lease_token:this.active.token,tool,arguments:args});}
 async begin(){if(this.lost)throw this.lost;if(!this.active)throw Error('작업 임대가 없습니다.');return this.rpc('toolkit_runner_begin',{runner_id:this.state.runner_id,job_id:this.active.job.job_id,lease_token:this.active.token});}
 async finish(outcome,error){
  if(!this.active)return;const active=this.active;try{await this.rpc('toolkit_runner_finish',{runner_id:this.state.runner_id,job_id:active.job.job_id,lease_token:active.token,outcome,...(error?{error_code:diagnosticCode(error)}:{})});}finally{this.active=null;delete this.state.pending;await save(this.file,this.state);}
 }
 async close(){if(this.timer)clearInterval(this.timer);if(this.active)await this.finish('interrupted',Error('interrupted')).catch(()=>{});await this.pulsePending?.catch(()=>{});}
}
