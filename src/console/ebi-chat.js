const FILE_TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const MAX_FILES=8,MAX_BYTES=4_000_000;
const jobLabels={queued:'작업 대기',awaiting_external:'에비가 읽을 대기열에 저장됨',running:'초안 처리 중',needs_info:'추가 정보 필요',needs_config:'작업 연결 확인 필요',draft:'검토할 초안 있음',ready:'검토할 초안 있음',failed:'작업 실패',cancelled:'작업 취소됨'};
const stamp=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
const bytes=n=>n<1_000_000?Math.ceil(n/1000)+'KB':(n/1_000_000).toFixed(1)+'MB';
const mimeOf=file=>FILE_TYPES[file.name.split('.').pop().toLowerCase()]||null;
const element=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const setText=(e,text)=>{if(e.textContent!==text)e.textContent=text;};
function privateUrl(url){try{const u=new URL(url,location.origin);return u.origin===location.origin&&u.pathname.startsWith('/api/console/')?u.href:null;}catch{return null;}}

// Draft files stay in memory, per report and approver. No private messages or files enter browser storage.
export function createEbiChat({api,toast,onOpenWork,onOpenDraft}){
 const drafts=new Map();let panel=null,ui=null,owner=null,context=null,poll=null,pollRequest=null,epoch=0,opened=true;
 const stateFor=id=>{if(!drafts.has(id))drafts.set(id,{text:'',items:[],requestId:null,sending:false,error:'',syncError:'',phase:'',data:null,loading:false,controller:null,scrollTop:0,atBottom:true});return drafts.get(id);};
 const current=id=>Boolean(owner&&context?.report.id===id&&panel?.isConnected);
 const dropPreview=item=>{if(item.preview)URL.revokeObjectURL(item.preview);item.preview=null;};
 const stop=()=>{clearTimeout(poll);poll=null;pollRequest?.abort();pollRequest=null;};
 const preserveScroll=()=>{if(!context||!ui)return;const s=stateFor(context.report.id);s.scrollTop=ui.log.scrollTop;s.atBottom=ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64;};
 const clear=()=>{epoch++;stop();for(const s of drafts.values()){s.controller?.abort();for(const item of s.items)dropPreview(item);}drafts.clear();owner=null;context=null;if(panel){panel.hidden=true;ui.text.value='';ui.files.value='';ui.filesList.replaceChildren();ui.log.replaceChildren();ui.questions.replaceChildren();for(const field of [ui.context,ui.error,ui.status,ui.dispatch,ui.syncError,ui.phase,ui.jobError,ui.count])field.textContent='';for(const field of [ui.questions,ui.jobError,ui.retry,ui.work,ui.draft,ui.newMessages])field.hidden=true;}};
 const compose=()=>{if(!context||!ui)return;const s=stateFor(context.report.id);ui.text.disabled=s.sending;ui.files.disabled=s.sending;ui.send.disabled=s.sending||(!s.text.trim()&&!s.items.length);setText(ui.send,s.sending?'전송 중…':s.error?'다시 전송':'에비에게 보내기');setText(ui.count,s.text.length.toLocaleString()+' / 12,000자 · 첨부 '+s.items.length+'/8');setText(ui.error,s.error);setText(ui.phase,s.phase);ui.retry.hidden=!s.syncError;setText(ui.syncError,s.syncError);};
 function renderFiles(){
  if(!context)return;const s=stateFor(context.report.id);ui.filesList.replaceChildren();
  for(const item of s.items){const row=element('li','ebi-file');if(item.preview){const image=element('img','ebi-file-preview');image.src=item.preview;image.alt=item.file.name;row.append(image);}
   const info=element('div','ebi-file-info');info.append(element('b','',item.file.name),element('span','fine',bytes(item.file.size)+' · '+(item.uploading?'업로드 중':item.error?'업로드 실패':item.uploaded?'첨부 준비 완료':'전송 시 업로드')));if(item.error)info.append(element('span','error',item.error));
   const remove=element('button','','제거');remove.type='button';remove.disabled=s.sending;remove.setAttribute('aria-label',item.file.name+' 첨부 제거');remove.onclick=()=>{if(s.sending)return;dropPreview(item);s.items=s.items.filter(x=>x!==item);s.requestId=null;s.error='';renderFiles();compose();};row.append(info,remove);ui.filesList.append(row);
  }
 }
 function messageNode(message){
  const role=['admin','agent','system'].includes(message.role)?message.role:'system',node=element('article','ebi-message ebi-'+role);node.dataset.messageId=message.id;node._signature=JSON.stringify(message);
  const head=element('div','ebi-message-head');head.append(element('b','',role==='admin'?'나':role==='agent'?'에비':'작업 안내'),element('time','fine',stamp(message.created_at)));node.append(head,element('p','ebi-message-text',String(message.text||'')));
  if(message.attachments?.length){const files=element('div','ebi-message-files'),reportId=context?.report.id;for(const file of message.attachments){const url=privateUrl(file.url),link=element(url?'a':'span','ebi-message-file',file.name+' · '+bytes(Number(file.size)||0));if(url){link.href=url;link.target='_blank';link.rel='noopener';}if(url&&['image/jpeg','image/png'].includes(file.mime)){const img=element('img','');img.src=url;img.alt=file.name;img.loading='lazy';img.onload=()=>{if(current(reportId)&&stateFor(reportId).atBottom)ui.log.scrollTop=ui.log.scrollHeight;};link.prepend(img);}files.append(link);}node.append(files);}
  return node;
 }
 function renderHistory(force=false){
  if(!context)return;const s=stateFor(context.report.id),messages=s.data?.messages||[],bottom=force?s.atBottom:ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64,previous=force?s.scrollTop:ui.log.scrollTop;
  if(!messages.length){ui.log.replaceChildren(element('p','ebi-empty',s.loading?'대화 기록을 불러오는 중…':'사진·자료를 첨부하고 필요한 작업을 에비에게 설명해 주세요.'));ui.newMessages.hidden=true;return;}
  const existing=new Map([...ui.log.children].filter(e=>e.dataset.messageId).map(e=>[e.dataset.messageId,e])),ids=new Set(messages.map(m=>m.id));let added=false;
  for(const child of [...ui.log.children])if(!ids.has(child.dataset.messageId))child.remove();
  messages.forEach((message,index)=>{let node=existing.get(message.id);if(!node){node=messageNode(message);added=true;}else if(node._signature!==JSON.stringify(message)){const replacement=messageNode(message);node.replaceWith(replacement);node=replacement;}
   if(ui.log.children[index]!==node)ui.log.insertBefore(node,ui.log.children[index]||null);
  });
  if(bottom){ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;}else{ui.log.scrollTop=previous;if(added&&!force)ui.newMessages.hidden=false;}
 }
 function renderStatus(){
  if(!context)return;const s=stateFor(context.report.id),data=s.data,job=data?.job,connected=data?.connection?.connected;
  setText(ui.status,s.loading&&!data?'대화 기록 확인 중…':data?(connected?(data.connection.label||'에비')+' 연결됨':'에비 연결 필요')+(job?' · '+(jobLabels[job.status]||'작업 상태 확인 필요'):''):'');
  setText(ui.dispatch,data?.dispatch?.note||'메시지는 에비가 읽을 대기열에 저장됩니다. 자동 깨움은 아직 연결되지 않았습니다.');
  ui.questions.replaceChildren();for(const question of job?.questions||[])ui.questions.append(element('li','',question));ui.questions.hidden=!ui.questions.children.length;ui.jobError.textContent=job?.error||'';ui.jobError.hidden=!job?.error;
  ui.draft.hidden=!(job?.proposal_id&&['draft','ready'].includes(job.status));ui.work.hidden=!(context.work&&['review','held','accepted'].includes(context.report.status));compose();
 }
 async function load(id,operationEpoch=epoch){
  if(!current(id)||operationEpoch!==epoch)return;const s=stateFor(id);if(s.sending){schedule(id);return;}
  const controller=new AbortController();pollRequest=controller;s.loading=true;renderStatus();if(!s.data)renderHistory();
  try{const data=await api('/api/console/reports/'+id+'/chat',{signal:controller.signal});if(!current(id)||operationEpoch!==epoch)return;s.data=data;s.syncError='';renderHistory();renderStatus();}
  catch(e){if(current(id)&&operationEpoch===epoch&&e.name!=='AbortError'){s.syncError='대화 기록을 불러오지 못했습니다. 입력을 유지한 채 다시 시도할 수 있습니다. '+e.message;compose();}}
  finally{if(pollRequest===controller)pollRequest=null;s.loading=false;if(current(id)&&operationEpoch===epoch){renderStatus();schedule(id);}}
 }
 function schedule(id){clearTimeout(poll);if(current(id))poll=setTimeout(()=>load(id),8000);}
 async function send(){
  if(!context||!owner)return;const id=context.report.id,s=stateFor(id);if(s.sending||(!s.text.trim()&&!s.items.length))return;
  if(s.text.length>12000||s.items.length>MAX_FILES){s.error='본문은 12,000자, 첨부는 8개까지 보낼 수 있습니다.';compose();return;}
  const operationEpoch=epoch,operationOwner=owner,controller=new AbortController();s.controller=controller;s.sending=true;s.error='';s.requestId||=crypto.randomUUID();clearTimeout(poll);pollRequest?.abort();pollRequest=null;compose();renderFiles();
  try{
   for(let index=0;index<s.items.length;index++){const item=s.items[index];if(item.uploaded)continue;item.uploading=true;item.error='';s.phase='첨부 '+(index+1)+'/'+s.items.length+' 업로드 중';if(current(id)){renderFiles();compose();}
    try{const out=await api('/api/console/reports/'+id+'/chat/files',{method:'POST',body:item.file,headers:{'Content-Type':mimeOf(item.file),'X-File-Name':encodeURIComponent(item.file.name)},signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;if(!out.file?.id)throw Error('첨부파일 저장 결과를 확인하지 못했습니다.');item.uploaded=out.file;}
    catch(e){item.error=e.message;throw e;}finally{item.uploading=false;if(current(id))renderFiles();}
   }
   s.phase='에비가 읽을 대기열에 저장 중';if(current(id))compose();
   const data=await api('/api/console/reports/'+id+'/chat',{method:'POST',body:JSON.stringify({request_id:s.requestId,text:s.text,attachment_ids:s.items.map(item=>item.uploaded.id)}),signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;
   s.data=data;s.text='';for(const item of s.items)dropPreview(item);s.items=[];s.requestId=null;s.phase='에비가 읽을 대기열에 저장했습니다.';s.syncError='';if(current(id)){ui.text.value='';ui.files.value='';renderFiles();renderHistory();renderStatus();}toast('메시지를 에비가 읽을 대기열에 저장했습니다.');
  }catch(e){if(operationEpoch===epoch&&operationOwner===owner&&e.name!=='AbortError'){s.error=e.message+' 입력과 첨부를 유지했습니다. 다시 전송할 수 있습니다.';s.phase='전송 실패';if(current(id))compose();}}
  finally{s.sending=false;s.controller=null;if(current(id)&&operationEpoch===epoch){renderFiles();compose();schedule(id);}}
 }
 function addFiles(){
  if(!context)return;const s=stateFor(context.report.id),errors=[];if(s.sending)return;
  for(const file of ui.files.files){const mime=mimeOf(file);if(!mime){errors.push(file.name+': 지원하지 않는 형식입니다.');continue;}if(file.size>MAX_BYTES){errors.push(file.name+': 파일당 4MB까지 첨부할 수 있습니다.');continue;}if(!file.size){errors.push(file.name+': 빈 파일은 첨부할 수 없습니다.');continue;}if(s.items.some(item=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified))continue;if(s.items.length>=MAX_FILES){errors.push('첨부파일은 합계 8개까지 선택할 수 있습니다.');break;}
   s.items.push({file,uploaded:null,uploading:false,error:'',preview:mime.startsWith('image/')?URL.createObjectURL(file):null});
  }
  ui.files.value='';s.requestId=null;s.error=errors.join(' ');renderFiles();compose();
 }
 function mount(target){
  panel=target;if(!panel)return;panel.hidden=true;
  panel.innerHTML='<header class="ebi-head"><div><h3 id="ebiChatTitle">에비와 작업</h3><p id="ebiContext" class="fine"></p></div><button type="button" id="ebiToggle" aria-controls="ebiBody" aria-expanded="true">접기</button></header><div id="ebiBody" class="ebi-body"><p id="ebiStatus" class="ebi-status" role="status"></p><p id="ebiDispatch" class="fine"></p><p id="ebiSyncError" class="error" role="status"></p><div class="buttons"><button type="button" id="ebiRetry" hidden>기록 다시 불러오기</button><button type="button" id="ebiWork">작업 설정으로 이동</button><button type="button" id="ebiDraft" hidden>초안 검토로 이동</button></div><ul id="ebiQuestions" class="ebi-questions" hidden></ul><p id="ebiJobError" class="error" hidden></p><div id="ebiLog" class="ebi-log" role="log" aria-label="에비 대화 기록" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><button type="button" id="ebiNewMessages" hidden>새 메시지 보기 ↓</button><form id="ebiForm" class="ebi-composer"><label for="ebiText">에비에게 할 말</label><textarea id="ebiText" rows="3" maxlength="12000" placeholder="사진·자료를 첨부하고 필요한 작업을 설명해 주세요."></textarea><div class="ebi-compose-tools"><label class="button ebi-file-picker">사진·파일 첨부<input id="ebiFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"></label><span id="ebiCount" class="fine"></span><button type="submit" class="primary" id="ebiSend">에비에게 보내기</button></div><p class="fine">JPG·PNG·PDF·TXT·MD·CSV·JSON·DOCX·XLSX · 총 8개 · 파일당 4MB<br>⌘/Ctrl + Enter로 전송합니다. 최종 승인은 아래 초안 검토 화면에서 직접 합니다.</p><ul id="ebiFilesList" class="ebi-files"></ul><p id="ebiPhase" class="fine" role="status"></p><p id="ebiError" class="error" role="alert"></p></form></div>';
  const select=id=>panel.querySelector('#'+id);ui={context:select('ebiContext'),toggle:select('ebiToggle'),body:select('ebiBody'),status:select('ebiStatus'),dispatch:select('ebiDispatch'),syncError:select('ebiSyncError'),retry:select('ebiRetry'),work:select('ebiWork'),draft:select('ebiDraft'),questions:select('ebiQuestions'),jobError:select('ebiJobError'),log:select('ebiLog'),newMessages:select('ebiNewMessages'),form:select('ebiForm'),text:select('ebiText'),files:select('ebiFiles'),count:select('ebiCount'),send:select('ebiSend'),filesList:select('ebiFilesList'),phase:select('ebiPhase'),error:select('ebiError')};
  ui.toggle.onclick=()=>{opened=!opened;ui.body.hidden=!opened;ui.toggle.textContent=opened?'접기':'에비와 작업 열기';ui.toggle.setAttribute('aria-expanded',String(opened));};
  ui.text.oninput=()=>{if(!context)return;const s=stateFor(context.report.id);s.text=ui.text.value;s.requestId=null;s.error='';compose();};ui.files.onchange=addFiles;ui.form.onsubmit=e=>{e.preventDefault();send();};ui.text.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();send();}};
  ui.retry.onclick=()=>{if(context){stop();load(context.report.id);}};ui.log.onscroll=()=>{preserveScroll();if(context&&stateFor(context.report.id).atBottom)ui.newMessages.hidden=true;};ui.newMessages.onclick=()=>{ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;preserveScroll();};
  ui.work.onclick=()=>onOpenWork?.();ui.draft.onclick=()=>{const job=context&&stateFor(context.report.id).data?.job;if(job?.proposal_id)Promise.resolve(onOpenDraft?.({reportId:context.report.id,proposalId:job.proposal_id})).catch(e=>toast(e.message));};
 }
 function report(next,nextOwner){
  if(!panel)return;if(!nextOwner){clear();return;}if(owner!==nextOwner){clear();owner=nextOwner;}panel.hidden=false;
  const id=next?.report?.id;if(!id){preserveScroll();stop();context=null;ui.context.textContent='왼쪽 목록에서 제보를 선택해 주세요.';ui.body.hidden=!opened;ui.text.value='';ui.files.value='';ui.filesList.replaceChildren();ui.text.disabled=true;ui.files.disabled=true;ui.send.disabled=true;ui.log.replaceChildren(element('p','ebi-empty','제보를 선택하면 에비에게 사진·파일과 작업 설명을 보낼 수 있습니다.'));ui.work.hidden=true;ui.draft.hidden=true;return;}
  const changed=context?.report.id!==id;if(changed){preserveScroll();stop();}context=next;const s=stateFor(id);ui.context.textContent=[next.report.station_name,next.report.floor,next.report.type_label].filter(Boolean).join(' · ')+' · 이 제보의 대화';
  if(changed){ui.text.value=s.text;ui.files.value='';ui.log.replaceChildren();renderFiles();renderHistory(true);}compose();renderStatus();if(changed||!s.data){stop();load(id);}
 }
 return {mount,report,clear,stop};
}
