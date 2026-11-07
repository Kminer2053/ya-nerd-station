import {codexTaskPrompt,codexPromptUrl} from './codex-handoff.js';
const FILE_TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
import {dotsLinkCard,bindDotsLink} from './ai-work.js';
const MAX_FILES=8,MAX_BYTES=4_000_000;
const executionViews={
 waiting:{label:'작업 대기',dispatch:'지시가 저장됐습니다. 작업자가 이 지시를 가져오기를 기다리고 있어요.'},
 received:{label:'작업 접수',dispatch:'작업자가 이 지시를 받았습니다. 실행 시작을 기다리고 있어요.'},
 working:{label:'Codex 작업 중',dispatch:'이 지시의 실행이 시작됐습니다. 질문이나 초안이 준비되면 이 대화에 표시됩니다.'},
 needs_info:{label:'보완 필요',dispatch:'Codex가 요청한 내용을 확인하고 같은 대화에서 답해 주세요.'},
 draft_submitted:{label:'초안 제출',dispatch:'검토할 수정안이 준비됐습니다. 아래에서 배치를 확인하거나 보완을 요청하세요.'},
 failed:{label:'작업 실패',dispatch:'이 작업을 마치지 못했습니다. 최신 지시를 확인한 뒤 재시도를 요청할 수 있습니다.'},
 interrupted:{label:'작업 중단',dispatch:'이 작업의 실행이 중단됐습니다. 최신 지시를 확인한 뒤 재시도를 요청할 수 있습니다.'},
 offline:{label:'작업자 오프라인',dispatch:'지시가 저장됐습니다. 이 제보를 맡을 작업자가 연결되기를 기다리고 있어요.'},
 cancelled:{label:'작업 취소',dispatch:'이 작업은 종료됐습니다. 이어서 작업할 지시가 있으면 이 대화에 보내 주세요.'},
 applied:{label:'지도 반영 완료',dispatch:'최종 승인으로 지도 반영이 끝났습니다. 이 제보의 작업 전송은 종료됐습니다.'},
};
const legacyJobViews={queued:'waiting',awaiting_external:'waiting',needs_info:'needs_info',draft:'draft_submitted',ready:'draft_submitted',failed:'failed',cancelled:'cancelled',applied:'applied'};
const executionErrors={
 startup:'작업자 실행 준비를 마치지 못했습니다.',
 authentication:'개인 PC 작업자의 Codex 로그인을 확인해 주세요.',
 connection:'작업자와 서버의 연결을 확인해 주세요.',
 model:'Codex 모델 실행 중 오류가 발생했습니다.',
 timeout:'정해진 실행 시간 안에 결과를 받지 못했습니다.',
 interrupted:'개인 PC 작업자의 실행이 중단됐습니다.',
 lease_lost:'작업 연결이 만료되어 실행을 중단했습니다.',
 no_result:'서버에 저장된 질문이나 초안을 받지 못했습니다.',
 protocol:'작업 결과의 형식을 확인하지 못했습니다.',
 filesystem:'작업자가 필요한 파일에 접근하지 못했습니다.',
};
function jobExecution(job){
 const execution=job?.execution;
 if(!execution||execution.job_id!==job.id||!Object.hasOwn(executionViews,execution.state))return null;
 return execution;
}
export function conversationPresentation(report,job){
 const editable=['review','held','accepted'].includes(report?.status),closed={
  applied:{label:'지도 반영 완료',dispatch:'최종 승인으로 지도 반영이 끝났습니다. 이 제보의 작업 전송은 종료됐습니다.',guidance:'아래 승인 결과와 지도 배치를 확인하세요. 추가 변경이 필요하면 새 제보로 남겨 주세요.',result:true},
  queued:{label:'승인 완료 · 지도 반영 대기',dispatch:'승인된 변경이 지도 반영을 기다리고 있습니다. 새 작업 전송은 종료됐습니다.',guidance:'아래 승인 결과와 반영 상태를 확인하세요.',result:true},
  rejected:{label:'제보 반려 · 종료',dispatch:'반려로 종료된 제보입니다. 현재 새 작업을 전송할 수 없습니다.',guidance:'반려 사유와 기존 대화 기록을 확인하세요. 제보가 다시 검토 상태가 되면 대화를 이어갈 수 있습니다.',result:false}
 }[report?.status];
 if(closed)return {editable:false,state:'closed',...closed};
 const execution=jobExecution(job),state=execution?.state||legacyJobViews[job?.status];
 const view=executionViews[state];
 if(state==='applied')return {editable:false,state,...view,guidance:'아래 승인 결과와 지도 배치를 확인하세요.',result:true};
 return {
  editable,state:state||'idle',execution,
  label:!execution&&state==='draft_submitted'?'검토할 초안 있음':view?.label||(job?'작업 상태 확인 중':'작업 지시 대기'),
  dispatch:view?.dispatch||null,guidance:null,result:false,
 };
}
const stamp=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
const bytes=n=>n<1_000_000?Math.ceil(n/1000)+'KB':(n/1_000_000).toFixed(1)+'MB';
const mimeOf=file=>FILE_TYPES[file.name.split('.').pop().toLowerCase()]||null;
const element=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const setText=(e,text)=>{if(e.textContent!==text)e.textContent=text;};
function privateUrl(url){try{const u=new URL(url,location.origin);return u.origin===location.origin&&u.pathname.startsWith('/api/console/')?u.href:null;}catch{return null;}}

// Draft files stay in memory, per report and approver. No private messages or files enter browser storage.
export function createEbiChat({api,toast,onWorkChange,onOpenDraft}){
 const drafts=new Map();let panel=null,ui=null,owner=null,context=null,poll=null,pollRequest=null,epoch=0,opened=true;
 const stateFor=id=>{if(!drafts.has(id))drafts.set(id,{text:'',items:[],requestId:null,sending:false,error:'',syncError:'',phase:'',data:null,loading:false,controller:null,scrollTop:0,atBottom:true});return drafts.get(id);};
 const current=id=>Boolean(owner&&context?.report.id===id&&panel?.isConnected);
 const dropPreview=item=>{if(item.preview)URL.revokeObjectURL(item.preview);item.preview=null;};
 function stop(){
  clearTimeout(poll);
  poll=null;
  const pending=pollRequest;
  pollRequest=null;
  if(pending){pending.state.loading=false;pending.controller.abort();}
 }
 const preserveScroll=()=>{if(!context||!ui)return;const s=stateFor(context.report.id);s.scrollTop=ui.log.scrollTop;s.atBottom=ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64;};
 function clearStatus(){
  for(const field of [ui.status,ui.workerStatus,ui.executionMeta,ui.dispatch,ui.guidance,ui.syncError,ui.phase,ui.jobError])field.textContent='';
  delete ui.status.dataset.state;
  ui.workState.hidden=true;
  for(const field of [ui.executionMeta,ui.questions,ui.jobError,ui.retry,ui.retryWork,ui.work,ui.draft,ui.newMessages])field.hidden=true;
 }
 function clear(){
  epoch++;
  stop();
  ui?.connection?.querySelector('#dotsLinkPanel')?._stopLinkPoll?.();
  for(const s of drafts.values()){
   s.controller?.abort();
   for(const item of s.items)dropPreview(item);
  }
  drafts.clear();
  owner=null;
  context=null;
  if(!panel)return;
  panel.hidden=true;
  ui.text.value='';
  ui.files.value='';
  ui.consent.checked=false;
  ui.lastConnection=undefined;
  ui.connection.querySelector('#dotsLinkRequest').value='';
  ui.connection.querySelector('#dotsLinkCodeBox').hidden=true;
  ui.connection.querySelector('#dotsLinkConsent').checked=false;
  ui.filesList.replaceChildren();
  ui.log.replaceChildren();
  ui.handoff.hidden=true;
  ui.handoffPrompt.value='';
  ui.handoffOpen.href='#';
  ui.questions.replaceChildren();
  for(const field of [ui.context,ui.error,ui.count])field.textContent='';
  clearStatus();
 }
 const needsStart=s=>!s.data?.job||s.data.job.kind!=='conversation'||!['awaiting_external','running','needs_info','draft','ready'].includes(s.data.job.status)||s.data.job.report_version!==context?.report.updated_at;
 function compose(){
  if(!context||!ui)return;
  const s=stateFor(context.report.id),start=needsStart(s);
  const {editable}=conversationPresentation(context.report,s.data?.job);
  ui.text.disabled=s.sending||!editable;
  ui.files.disabled=s.sending||!editable;
  ui.send.disabled=s.sending||!editable||!s.data?.connection?.connected||(!s.text.trim()&&!s.items.length)||(start&&!ui.consent.checked);
  ui.scope.hidden=!start||!editable;
  ui.retryWork.disabled=s.sending;
  setText(ui.send,!editable?'작업 전송 종료':s.sending?'전송 중…':s.error?'다시 전송':start?'Codex에게 작업 맡기기':'Codex에게 보내기');
  setText(ui.count,s.text.length.toLocaleString()+'자 · 첨부 '+s.items.length+'/8');
  setText(ui.error,s.error);
  setText(ui.phase,s.phase);
  ui.retry.hidden=!s.syncError;
  setText(ui.syncError,s.syncError);
 }
 function renderFiles(){
  if(!context)return;const s=stateFor(context.report.id);ui.filesList.replaceChildren();
  for(const item of s.items){const row=element('li','ebi-file');if(item.preview){const image=element('img','ebi-file-preview');image.src=item.preview;image.alt=item.file.name;row.append(image);}
   const info=element('div','ebi-file-info');info.append(element('b','',item.file.name),element('span','fine',bytes(item.file.size)+' · '+(item.uploading?'업로드 중':item.error?'업로드 실패':item.uploaded?'첨부 준비 완료':'전송 시 업로드')));if(item.error)info.append(element('span','error',item.error));
   const remove=element('button','','제거');remove.type='button';remove.disabled=s.sending;remove.setAttribute('aria-label',item.file.name+' 첨부 제거');remove.onclick=()=>{if(s.sending)return;dropPreview(item);s.items=s.items.filter(x=>x!==item);s.requestId=null;s.error='';renderFiles();compose();};row.append(info,remove);ui.filesList.append(row);
  }
 }
 function messageNode(message,badge,signature){
  const role=['admin','agent','system'].includes(message.role)?message.role:'system',node=element('article','ebi-message ebi-'+role);
  node.dataset.messageId=message.id;
  node._signature=signature;
  const head=element('div','ebi-message-head');
  head.append(element('b','',role==='admin'?'나':role==='agent'?'Codex':'작업 안내'),element('time','fine',stamp(message.created_at)));
  if(badge){head.append(element('span','ebi-instruction-badge',badge));node.dataset.activeInstruction='true';}
  node.append(head,element('p','ebi-message-text',String(message.text||'')));
  if(message.attachments?.length){const files=element('div','ebi-message-files'),reportId=context?.report.id;for(const file of message.attachments){const url=privateUrl(file.url),link=element(url?'a':'span','ebi-message-file',file.name+' · '+bytes(Number(file.size)||0));if(url){link.href=url;link.target='_blank';link.rel='noopener';}if(url&&['image/jpeg','image/png'].includes(file.mime)){const img=element('img','');img.src=url;img.alt=file.name;img.loading='lazy';img.onload=()=>{if(current(reportId)&&stateFor(reportId).atBottom)ui.log.scrollTop=ui.log.scrollHeight;};link.prepend(img);}files.append(link);}node.append(files);}
  return node;
 }
 function renderHistory(force=false){
  if(!context)return;
  const s=stateFor(context.report.id),job=s.data?.job,execution=conversationPresentation(context.report,job).execution;
  const messages=[...new Map((s.data?.messages||[]).filter(m=>m.id&&(job?.kind==='conversation'||!m.id.startsWith('status-'))).map(m=>[m.id,m])).values()];
  const parentInstruction=execution?.parent_job_id&&messages.find(m=>m.role==='admin'&&m.job_id===execution.parent_job_id);
  const bottom=force?s.atBottom:ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64;
  const previous=force?s.scrollTop:ui.log.scrollTop;
  if(!messages.length){ui.log.replaceChildren(element('p','ebi-empty',s.loading?'대화 기록을 불러오는 중…':'사진·자료를 첨부하고 필요한 작업을 Codex에게 설명해 주세요.'));ui.newMessages.hidden=true;return;}
  const existing=new Map([...ui.log.children].filter(e=>e.dataset.messageId).map(e=>[e.dataset.messageId,e])),ids=new Set(messages.map(m=>m.id));let added=false;
  for(const child of [...ui.log.children])if(!ids.has(child.dataset.messageId))child.remove();
  messages.forEach((message,index)=>{
   const active=message.role==='admin'&&execution?.message_id===message.id;
   const badge=active?(parentInstruction&&parentInstruction.id!==message.id?'현재 보완 지시':'현재 작업 지시'):null;
   const signature=JSON.stringify([message,badge]);
   let node=existing.get(message.id);
   if(!node){node=messageNode(message,badge,signature);added=true;}
   else if(node._signature!==signature){const replacement=messageNode(message,badge,signature);node.replaceWith(replacement);node=replacement;}
   if(ui.log.children[index]!==node)ui.log.insertBefore(node,ui.log.children[index]||null);
  });
  if(bottom){ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;}else{ui.log.scrollTop=previous;if(added&&!force)ui.newMessages.hidden=false;}
 }
 function renderStatus(){
  if(!context)return;
  const s=stateFor(context.report.id),data=s.data,job=data?.job;
  const connected=data?.connection?.connected,view=conversationPresentation(context.report,job),execution=view.execution;
  if(data&&ui.lastConnection!==connected){ui.connection.open=!connected;ui.lastConnection=connected;}
  const stale=Boolean(view.editable&&s.syncError),loading=Boolean(view.editable&&!data&&!stale);
  ui.workState.hidden=false;
  ui.status.dataset.state=stale?'unavailable':loading?'loading':view.state;
  setText(ui.status,stale?'작업 상태 확인 지연':loading?'대화 기록 확인 중…':view.label);
  const linkLabel=data?(connected?(data.connection.label||'Codex')+' 연결됨':'Codex 연결 필요'):'';
  const runnerLabel=typeof execution?.runner_online==='boolean'&&view.state!=='offline'
   ?(execution.runner_online?'자동 작업자 온라인':'자동 작업자 오프라인'):'';
  setText(ui.workerStatus,stale?'':[linkLabel,runnerLabel].filter(Boolean).join(' · '));
  const dispatch=stale?(data?'마지막으로 확인한 상태는 '+view.label+'입니다.':'서버 상태를 다시 확인해 주세요.')
   :view.dispatch||(connected?'작업 지시를 보내면 서버 상태가 여기에 표시됩니다.':'최초 연결 인증 후 이 화면에서 작업합니다.');
  setText(ui.dispatch,dispatch);
  const instruction=execution?.message_id&&(data.messages||[]).find(message=>message.id===execution.message_id&&message.role==='admin');
  const instructionTime=instruction?.created_at&&stamp(instruction.created_at);
  const updatedTime=execution?.updated_at&&stamp(execution.updated_at);
  const meta=[instructionTime&&'지시 '+instructionTime,updatedTime&&'상태 갱신 '+updatedTime].filter(Boolean).join(' · ');
  setText(ui.executionMeta,meta);
  ui.executionMeta.hidden=!meta;
  setText(ui.guidance,view.guidance|| (job&&job.kind!=='conversation'?'이전 수동 작업입니다. 아래에서 대화 작업을 맡기면 이전 초안을 대체하고 Codex가 종류·치수를 제안합니다.':['draft','ready'].includes(job?.status)?'수정할 점을 작업 채팅으로 보내거나 아래의 수정안을 최종 승인하세요.':'원하는 결과를 설명해 주세요. 종류·치수·사진 보정은 Codex가 제안합니다.'));
  ui.handoff.hidden=true;ui.handoffId.textContent=job?'현재 작업 '+job.id:'';ui.handoffPrompt.value=job?codexTaskPrompt(job.id):'';ui.handoffOpen.href=job?codexPromptUrl(ui.handoffPrompt.value):'#';
  const replies=(data?.messages||[]).filter(message=>message.job_id===job?.id&&(message.role==='agent'||message.id==='status-'+job?.id));
  const questions=view.state==='needs_info'&&!stale&&Array.isArray(job?.questions)
   ?job.questions.filter(question=>typeof question==='string'&&question.trim()&&!replies.some(reply=>String(reply.text||'').includes(question)))
   :[];
  ui.questions.replaceChildren(...[...new Set(questions)].map(question=>element('li','',question)));
  ui.questions.hidden=!questions.length;
  const executionError=['failed','interrupted'].includes(view.state)&&Object.hasOwn(executionErrors,execution?.error_code)
   ?executionErrors[execution.error_code]:'';
  const error=view.editable?(job?.error||executionError):'';
  setText(ui.jobError,error);
  ui.jobError.hidden=!error;
  ui.retryWork.hidden=!view.editable||stale||!(execution?.retryable??data?.dispatch?.retryable);
  ui.draft.hidden=!(job?.proposal_id&&(view.result||view.editable&&view.state==='draft_submitted'));
  setText(ui.draft,view.result?'승인 결과 확인':'초안 검토로 이동');
  ui.work.hidden=true;
  compose();
 }
 function applySnapshot(state,data){
  const signature=JSON.stringify([data.job?.id,data.job?.proposal_id,data.job?.status]);
  const changed=state.signature!==undefined&&signature!==state.signature;
  state.signature=signature;
  state.data=data;
  state.syncError='';
  return changed;
 }
 async function refreshWork(id){
  const operationEpoch=epoch;
  try{await onWorkChange?.(id);}
  catch(error){if(current(id)&&operationEpoch===epoch)toast('제보 요약을 갱신하지 못했습니다. '+error.message);}
 }
 function clearSavedInput(id,state,phase=''){
  state.text='';
  for(const item of state.items)dropPreview(item);
  state.items=[];
  state.requestId=null;
  state.error='';
  state.phase=phase;
  if(!current(id))return;
  ui.text.value='';
  ui.files.value='';
  ui.consent.checked=false;
  renderFiles();
 }
 async function load(id){
  if(!current(id)||pollRequest)return;
  const operationEpoch=epoch,s=stateFor(id);
  if(s.sending){schedule(id);return;}
  const controller=new AbortController(),request={controller,state:s};
  const valid=()=>pollRequest===request&&!controller.signal.aborted&&current(id)&&operationEpoch===epoch;
  pollRequest=request;
  s.loading=true;
  renderStatus();
  if(!s.data)renderHistory();
  try{
   const data=await api('/api/console/reports/'+id+'/chat',{signal:controller.signal});
   if(!valid())return;
   const changed=applySnapshot(s,data);
   const saved=s.requestId&&(data.messages||[]).some(message=>message.role==='admin'&&message.id===s.requestId);
   if(saved)clearSavedInput(id,s,'서버에 저장된 지시를 확인했습니다.');
   renderHistory();
   renderStatus();
   const newerJob=Date.parse(data.job?.report_version)>Date.parse(context.report.updated_at);
   if(changed||saved||newerJob)await refreshWork(id);
  }catch(error){
   if(valid()&&error.name!=='AbortError')s.syncError='대화 기록을 불러오지 못했습니다. 입력을 유지한 채 다시 시도할 수 있습니다. '+error.message;
  }finally{
   if(pollRequest===request){
    pollRequest=null;
    s.loading=false;
    if(current(id)&&operationEpoch===epoch){renderHistory();renderStatus();schedule(id);}
   }
  }
 }
 function schedule(id){clearTimeout(poll);if(current(id))poll=setTimeout(()=>load(id),8000);}
 async function send(){
  if(!context||!owner)return;compose();if(ui.send.disabled)return;const id=context.report.id,s=stateFor(id);if(s.sending||(!s.text.trim()&&!s.items.length))return;
  if(s.text.length>12000||s.items.length>MAX_FILES){s.error='본문은 12,000자, 첨부는 8개까지 보낼 수 있습니다.';compose();return;}
  const operationEpoch=epoch,operationOwner=owner,start=needsStart(s),version=context.report.updated_at,confirmed=ui.consent.checked,controller=new AbortController();s.controller=controller;s.sending=true;s.error='';s.requestId||=crypto.randomUUID();stop();compose();renderFiles();
  try{
   for(let index=0;index<s.items.length;index++){const item=s.items[index];if(item.uploaded)continue;item.uploading=true;item.error='';s.phase='첨부 '+(index+1)+'/'+s.items.length+' 업로드 중';if(current(id)){renderFiles();compose();}
    try{const out=await api('/api/console/reports/'+id+'/chat/files',{method:'POST',body:item.file,headers:{'Content-Type':mimeOf(item.file),'X-File-Name':encodeURIComponent(item.file.name)},signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;if(!out.file?.id)throw Error('첨부파일 저장 결과를 확인하지 못했습니다.');item.uploaded=out.file;}
    catch(e){item.error=e.message;throw e;}finally{item.uploading=false;if(current(id))renderFiles();}
   }
   s.phase='Codex가 읽을 대기열에 저장 중';if(current(id))compose();
   const data=await api('/api/console/reports/'+id+'/chat',{method:'POST',body:JSON.stringify({request_id:s.requestId,text:s.text,attachment_ids:s.items.map(item=>item.uploaded.id),...(start?{start:true,confirm:confirmed,report_version:version}:{})}),signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;
   applySnapshot(s,data);
   clearSavedInput(id,s);
   if(current(id)){renderHistory();renderStatus();}
   await refreshWork(id);
   if(current(id)&&operationEpoch===epoch)toast('대화 작업을 저장했습니다.');
  }catch(e){if(operationEpoch===epoch&&operationOwner===owner&&e.name!=='AbortError'){s.error=e.message+' 입력과 첨부를 유지했습니다. 다시 전송할 수 있습니다.';s.phase='전송 실패';if(current(id))compose();}}
  finally{s.sending=false;s.controller=null;if(current(id)&&operationEpoch===epoch){renderFiles();compose();schedule(id);}}
 }
 function addFiles(incoming=ui.files.files){
  if(!context)return;const s=stateFor(context.report.id),errors=[];if(s.sending)return;
  for(const file of incoming){const mime=mimeOf(file);if(!mime){errors.push(file.name+': 지원하지 않는 형식입니다.');continue;}if(file.size>MAX_BYTES){errors.push(file.name+': 파일당 4MB까지 첨부할 수 있습니다.');continue;}if(!file.size){errors.push(file.name+': 빈 파일은 첨부할 수 없습니다.');continue;}if(s.items.some(item=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified))continue;if(s.items.length>=MAX_FILES){errors.push('첨부파일은 합계 8개까지 선택할 수 있습니다.');break;}
   s.items.push({file,uploaded:null,uploading:false,error:'',preview:mime.startsWith('image/')?URL.createObjectURL(file):null});
  }
  ui.files.value='';s.requestId=null;s.error=errors.join(' ');renderFiles();compose();
 }
 function assertMapFrame(canvas){
  const sample=document.createElement('canvas');sample.width=sample.height=16;
  const ctx=sample.getContext('2d');ctx.drawImage(canvas,0,0,16,16);
  const {data}=ctx.getImageData(0,0,16,16);
  for(let i=0;i<data.length;i+=4){
   if(data[i+3]>0&&Math.max(data[i],data[i+1],data[i+2])>8)return;
  }
  throw Error('지도 화면이 캡처되지 않았습니다. 지도가 보이는 상태에서 다시 캡처하세요.');
 }
 async function attachImage(blob,{name='배치 확인.png',note='',mapCapture=false}={}){
  if(!context||!owner||!['review','held','accepted'].includes(context.report.status))throw Error('작업할 제보를 선택한 뒤 이미지를 첨부하세요.');
  const operationOwner=owner,operationEpoch=epoch,id=context.report.id,s=stateFor(id);if(s.sending)throw Error('현재 전송을 마친 뒤 이미지를 첨부하세요.');
  if(s.items.length>=MAX_FILES)throw Error('첨부는 한 번에 8개까지입니다.');
  const image=await createImageBitmap(blob);let file;
  try{
   if(operationOwner!==owner||operationEpoch!==epoch||!current(id))throw Error('이미지를 준비하는 동안 계정이나 제보가 바뀌었습니다. 현재 제보에서 다시 첨부하세요.');
   const k=Math.min(1,2048/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.width*k));canvas.height=Math.max(1,Math.round(image.height*k));
   canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   if(mapCapture)assertMapFrame(canvas);
   let output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!output||output.size>MAX_BYTES)output=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
   if(!output||output.size>MAX_BYTES)throw Error('이미지를 4MB 이하로 줄여 다시 첨부하세요.');
   name=name.replace(/\.[^.]+$/,'')+(output.type==='image/png'?'.png':'.jpg');file=new File([output],name,{type:output.type});
  }finally{image.close();}
  if(operationOwner!==owner||operationEpoch!==epoch||!current(id))throw Error('이미지를 준비하는 동안 계정이나 제보가 바뀌었습니다. 현재 제보에서 다시 첨부하세요.');
  addFiles([file]);if(note){s.text+=(s.text?'\n':'')+note;ui.text.value=s.text;compose();}ui.text.focus();toast('이미지를 첨부했습니다. 수정할 점을 적고 전송하세요.');
 }
 function mount(target){
  panel=target;if(!panel)return;panel.hidden=true;
  panel.innerHTML='<header class="ebi-head"><div><h3 id="ebiChatTitle">Codex와 작업</h3><p id="ebiContext" class="fine"></p></div><button type="button" id="ebiToggle" aria-controls="ebiBody" aria-expanded="true">접기</button></header><div id="ebiBody" class="ebi-body"><section id="ebiWorkState" class="ebi-work-state" aria-label="현재 Codex 작업 상태" hidden><div class="ebi-state-row"><p id="ebiStatus" class="ebi-status" role="status"></p><p id="ebiWorkerStatus" class="fine"></p></div><p id="ebiDispatch" class="fine"></p><p id="ebiExecutionMeta" class="fine ebi-execution-meta" hidden></p></section><p id="ebiSyncError" class="error" role="status"></p><div class="buttons"><button type="button" id="ebiRetry" hidden>기록 다시 불러오기</button><button type="button" id="ebiWork">작업 설정으로 이동</button><button type="button" id="ebiDraft" hidden>초안 검토로 이동</button></div><ul id="ebiQuestions" class="ebi-questions" aria-label="답변이 필요한 질문" hidden></ul><p id="ebiJobError" class="error" hidden></p><button type="button" id="ebiRetryWork" hidden>재시도 지시 작성</button><div id="ebiLog" class="ebi-log" role="log" aria-label="Codex 대화 기록" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><button type="button" id="ebiNewMessages" hidden>새 메시지 보기 ↓</button><form id="ebiForm" class="ebi-composer"><label for="ebiText">Codex에게 할 말</label><textarea id="ebiText" rows="3" maxlength="12000" placeholder="사진·자료를 첨부하고 필요한 작업을 설명해 주세요."></textarea><div class="ebi-compose-tools"><label class="button ebi-file-picker">사진·파일 첨부<input id="ebiFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"></label><span id="ebiCount" class="fine"></span><button type="submit" class="primary" id="ebiSend">Codex에게 보내기</button></div><p class="fine">JPG·PNG·PDF·TXT·MD·CSV·JSON·DOCX·XLSX · 총 8개 · 파일당 4MB<br>⌘/Ctrl + Enter로 전송합니다. 최종 승인은 아래 초안 검토 화면에서 직접 합니다.</p><ul id="ebiFilesList" class="ebi-files"></ul><p id="ebiPhase" class="fine" role="status"></p><p id="ebiError" class="error" role="alert"></p></form></div>';
  const select=id=>panel.querySelector('#'+id);ui={context:select('ebiContext'),toggle:select('ebiToggle'),body:select('ebiBody'),workState:select('ebiWorkState'),status:select('ebiStatus'),workerStatus:select('ebiWorkerStatus'),executionMeta:select('ebiExecutionMeta'),retryWork:select('ebiRetryWork'),dispatch:select('ebiDispatch'),syncError:select('ebiSyncError'),retry:select('ebiRetry'),work:select('ebiWork'),draft:select('ebiDraft'),questions:select('ebiQuestions'),jobError:select('ebiJobError'),log:select('ebiLog'),newMessages:select('ebiNewMessages'),form:select('ebiForm'),text:select('ebiText'),files:select('ebiFiles'),count:select('ebiCount'),send:select('ebiSend'),filesList:select('ebiFilesList'),phase:select('ebiPhase'),error:select('ebiError')};
  select('ebiChatTitle').textContent='작업 지시 채팅 · Codex';
  ui.retryWork.onclick=()=>{
   if(!context||ui.retryWork.hidden)return;
   const s=stateFor(context.report.id);
   if(s.sending)return;
   if(s.requestId&&s.error){
    stop();
    load(context.report.id);
    return;
   }
   if(!s.text.trim()){
    s.text='이전 작업을 재시도해 주세요. 같은 제보 사진과 최신 지시를 확인해 수정안을 작성해 주세요.';
    s.requestId=null;
   }
   ui.text.value=s.text;
   compose();
   ui.text.focus();
   toast('재시도 지시를 확인하고 전송하세요.');
  };
  ui.handoff=element('section','codex-handoff');ui.handoff.hidden=true;ui.handoffId=element('p','fine');ui.handoffOpen=element('a','button','Codex에서 작업 열기');ui.handoffOpen.title='입력창에 요청문을 채웁니다. Codex에서 전송해야 시작합니다.';const copy=element('button','','Codex 요청문 복사');copy.type='button';ui.handoffPrompt=element('textarea','');ui.handoffPrompt.readOnly=true;ui.handoffPrompt.rows=5;ui.handoffPrompt.setAttribute('aria-label','최신 Codex 작업 요청문');const details=element('details','');details.append(element('summary','','작업 요청문 확인'),ui.handoffPrompt);const controls=element('div','buttons');controls.append(ui.handoffOpen,copy);ui.handoff.append(ui.handoffId,controls,element('p','fine','Codex 앱의 입력창이 열립니다. 직접 전송해야 작업이 시작되며, 저장만으로 자동 실행되지 않습니다. 질문에 답하면 최신 작업 ID로 이어집니다.'),details);ui.dispatch.after(ui.handoff);copy.onclick=async()=>{try{await navigator.clipboard.writeText(ui.handoffPrompt.value);toast('최신 작업 요청문을 복사했습니다. Codex 입력창에서 전송하세요.');}catch{ui.handoffPrompt.closest('details').open=true;ui.handoffPrompt.focus();ui.handoffPrompt.select();toast('요청문을 선택했습니다. 직접 복사해 주세요.');}};
  ui.guidance=element('p','fine');ui.executionMeta.after(ui.guidance);
  ui.scope=element('label','ebi-scope');ui.consent=element('input','');ui.consent.type='checkbox';ui.scope.append(ui.consent,document.createTextNode(' 이 제보의 층·핀 주변에서 파사드 교체, 생성·보정 이미지와 새 구조물 초안, 독립 장애물 숨김을 검토하도록 맡깁니다. Codex의 치수 추정은 근거와 한계를 표시하며, 최종 승인 전 지도는 바뀌지 않습니다.'));ui.form.querySelector('.ebi-compose-tools').before(ui.scope);ui.consent.onchange=compose;
  const host=document.querySelector('#connectionHost'),connection=element('section','ebi-connection');
  if(!host)connection.append(element('h3','','Codex 연결 설정'));
  const link=element('div','');link.innerHTML=dotsLinkCard('dots');connection.append(link);
  if(host)host.append(connection);
  else ui.body.prepend(connection);
  ui.connection=connection;
  ui.filesList.before(element('p','fine','보낸 대화는 서버에 저장됩니다. 작성 중인 글·첨부는 제보 전환과 화면 내 기록 갱신에는 유지되지만, 브라우저 새로고침·종료 시 사라집니다.'));
  ui.toggle.onclick=()=>{opened=!opened;ui.body.hidden=!opened;ui.toggle.textContent=opened?'접기':'Codex와 작업 열기';ui.toggle.setAttribute('aria-expanded',String(opened));};
  ui.text.oninput=()=>{if(!context)return;const s=stateFor(context.report.id);s.text=ui.text.value;s.requestId=null;s.error='';compose();};ui.files.onchange=()=>addFiles();ui.text.onpaste=async e=>{const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;e.preventDefault();try{for(const file of files)await attachImage(file);}catch(error){toast(error.message);}};ui.form.onsubmit=e=>{e.preventDefault();send();};ui.text.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();send();}};
  ui.retry.onclick=()=>{if(context){stop();load(context.report.id);}};ui.log.onscroll=()=>{preserveScroll();if(context&&stateFor(context.report.id).atBottom)ui.newMessages.hidden=true;};ui.newMessages.onclick=()=>{ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;preserveScroll();};
  ui.work.remove();ui.draft.onclick=()=>{const job=context&&stateFor(context.report.id).data?.job;if(job?.proposal_id)Promise.resolve(onOpenDraft?.({reportId:context.report.id,proposalId:job.proposal_id})).catch(e=>toast(e.message));};
 }
 function report(next,nextOwner){
  if(!panel)return;if(!nextOwner){clear();return;}if(owner!==nextOwner){clear();owner=nextOwner;}panel.hidden=false;
  const id=next?.report?.id;
  if(!id){
   preserveScroll();
   stop();
   context=null;
   ui.context.textContent='왼쪽 목록에서 제보를 선택해 주세요.';
   ui.body.hidden=!opened;
   ui.text.value='';
   ui.files.value='';
   ui.filesList.replaceChildren();
   ui.text.disabled=true;
   ui.files.disabled=true;
   ui.send.disabled=true;
   ui.scope.hidden=true;
   ui.handoff.hidden=true;
   ui.log.replaceChildren(element('p','ebi-empty','제보를 선택하면 Codex에게 사진·파일과 작업 설명을 보낼 수 있습니다.'));
   ui.error.textContent='';
   ui.count.textContent='';
   clearStatus();
   return;
  }
  const changed=context?.report.id!==id;if(changed){preserveScroll();stop();}context=next;const s=stateFor(id);ui.context.textContent=[next.report.station_name,next.report.floor,next.report.type_label].filter(Boolean).join(' · ')+' · 이 제보의 대화';
  if(changed){ui.text.value=s.text;ui.files.value='';ui.consent.checked=false;ui.log.replaceChildren();renderFiles();renderHistory(true);bindDotsLink({api,toast,isCurrent:current},id);}compose();renderStatus();if(changed||!s.data){stop();load(id);}
 }
 return {mount,report,clear,stop,attachImage};
}
