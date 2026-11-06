import {codexTaskPrompt,codexPromptUrl} from './codex-handoff.js';
const FILE_TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
import {dotsLinkCard,bindDotsLink} from './ai-work.js';
const MAX_FILES=8,MAX_BYTES=4_000_000;
const jobLabels={queued:'작업 대기',awaiting_external:'작업자 처리 대기',running:'초안 처리 중',needs_info:'추가 정보 필요',needs_config:'작업 연결 확인 필요',draft:'검토할 초안 있음',ready:'검토할 초안 있음',failed:'작업 실패',cancelled:'작업 취소됨'};
export function conversationPresentation(report,job){
 const editable=['review','held','accepted'].includes(report?.status),closed={
  applied:{label:'지도 반영 완료',dispatch:'최종 승인으로 지도 반영이 끝났습니다. 이 제보의 작업 전송은 종료됐습니다.',guidance:'아래 승인 결과와 지도 배치를 확인하세요. 추가 변경이 필요하면 새 제보로 남겨 주세요.',result:true},
  queued:{label:'승인 완료 · 지도 반영 대기',dispatch:'승인된 변경이 지도 반영을 기다리고 있습니다. 새 작업 전송은 종료됐습니다.',guidance:'아래 승인 결과와 반영 상태를 확인하세요.',result:true},
  rejected:{label:'제보 반려 · 종료',dispatch:'반려로 종료된 제보입니다. 현재 새 작업을 전송할 수 없습니다.',guidance:'반려 사유와 기존 대화 기록을 확인하세요. 제보가 다시 검토 상태가 되면 대화를 이어갈 수 있습니다.',result:false}
 }[report?.status];
 if(closed)return {editable:false,...closed};
 return {editable,label:jobLabels[job?.status]||'작업 상태 확인 필요',dispatch:null,guidance:null,result:false};
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
 const stop=()=>{clearTimeout(poll);poll=null;pollRequest?.abort();pollRequest=null;};
 const preserveScroll=()=>{if(!context||!ui)return;const s=stateFor(context.report.id);s.scrollTop=ui.log.scrollTop;s.atBottom=ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64;};
 const clear=()=>{epoch++;stop();ui?.connection?.querySelector('#dotsLinkPanel')?._stopLinkPoll?.();for(const s of drafts.values()){s.controller?.abort();for(const item of s.items)dropPreview(item);}drafts.clear();owner=null;context=null;if(panel){panel.hidden=true;ui.text.value='';ui.files.value='';ui.consent.checked=false;ui.lastConnection=undefined;ui.connection.querySelector('#dotsLinkRequest').value='';ui.connection.querySelector('#dotsLinkCodeBox').hidden=true;ui.connection.querySelector('#dotsLinkConsent').checked=false;ui.filesList.replaceChildren();ui.log.replaceChildren();ui.handoff.hidden=true;ui.handoffPrompt.value='';ui.handoffOpen.href='#';ui.questions.replaceChildren();for(const field of [ui.context,ui.error,ui.status,ui.dispatch,ui.syncError,ui.phase,ui.jobError,ui.count])field.textContent='';for(const field of [ui.questions,ui.jobError,ui.retry,ui.work,ui.draft,ui.newMessages])field.hidden=true;}};
 const needsStart=s=>!s.data?.job||s.data.job.kind!=='conversation'||!['awaiting_external','running','needs_info','draft','ready'].includes(s.data.job.status)||s.data.job.report_version!==context?.report.updated_at;
 const compose=()=>{if(!context||!ui)return;const s=stateFor(context.report.id),start=needsStart(s),editable=['review','held','accepted'].includes(context.report.status);ui.text.disabled=s.sending||!editable;ui.files.disabled=s.sending||!editable;ui.send.disabled=s.sending||!editable||!s.data?.connection?.connected||(!s.text.trim()&&!s.items.length)||(start&&!ui.consent.checked);ui.scope.hidden=!start||!editable;setText(ui.send,!editable?'작업 전송 종료':s.sending?'전송 중…':s.error?'다시 전송':start?'Codex에게 작업 맡기기':'Codex에게 보내기');setText(ui.count,s.text.length.toLocaleString()+'자 · 첨부 '+s.items.length+'/8');setText(ui.error,s.error);setText(ui.phase,s.phase);ui.retry.hidden=!s.syncError;setText(ui.syncError,s.syncError);};
 function renderFiles(){
  if(!context)return;const s=stateFor(context.report.id);ui.filesList.replaceChildren();
  for(const item of s.items){const row=element('li','ebi-file');if(item.preview){const image=element('img','ebi-file-preview');image.src=item.preview;image.alt=item.file.name;row.append(image);}
   const info=element('div','ebi-file-info');info.append(element('b','',item.file.name),element('span','fine',bytes(item.file.size)+' · '+(item.uploading?'업로드 중':item.error?'업로드 실패':item.uploaded?'첨부 준비 완료':'전송 시 업로드')));if(item.error)info.append(element('span','error',item.error));
   const remove=element('button','','제거');remove.type='button';remove.disabled=s.sending;remove.setAttribute('aria-label',item.file.name+' 첨부 제거');remove.onclick=()=>{if(s.sending)return;dropPreview(item);s.items=s.items.filter(x=>x!==item);s.requestId=null;s.error='';renderFiles();compose();};row.append(info,remove);ui.filesList.append(row);
  }
 }
 function messageNode(message){
  const role=['admin','agent','system'].includes(message.role)?message.role:'system',node=element('article','ebi-message ebi-'+role);node.dataset.messageId=message.id;node._signature=JSON.stringify(message);
  const head=element('div','ebi-message-head');head.append(element('b','',role==='admin'?'나':role==='agent'?'Codex':'작업 안내'),element('time','fine',stamp(message.created_at)));node.append(head,element('p','ebi-message-text',String(message.text||'')));
  if(message.attachments?.length){const files=element('div','ebi-message-files'),reportId=context?.report.id;for(const file of message.attachments){const url=privateUrl(file.url),link=element(url?'a':'span','ebi-message-file',file.name+' · '+bytes(Number(file.size)||0));if(url){link.href=url;link.target='_blank';link.rel='noopener';}if(url&&['image/jpeg','image/png'].includes(file.mime)){const img=element('img','');img.src=url;img.alt=file.name;img.loading='lazy';img.onload=()=>{if(current(reportId)&&stateFor(reportId).atBottom)ui.log.scrollTop=ui.log.scrollHeight;};link.prepend(img);}files.append(link);}node.append(files);}
  return node;
 }
 function renderHistory(force=false){
  if(!context)return;const s=stateFor(context.report.id),messages=(s.data?.messages||[]).filter(m=>s.data?.job?.kind==='conversation'||!m.id.startsWith('status-')),bottom=force?s.atBottom:ui.log.scrollHeight-ui.log.scrollTop-ui.log.clientHeight<64,previous=force?s.scrollTop:ui.log.scrollTop;
  if(!messages.length){ui.log.replaceChildren(element('p','ebi-empty',s.loading?'대화 기록을 불러오는 중…':'사진·자료를 첨부하고 필요한 작업을 Codex에게 설명해 주세요.'));ui.newMessages.hidden=true;return;}
  const existing=new Map([...ui.log.children].filter(e=>e.dataset.messageId).map(e=>[e.dataset.messageId,e])),ids=new Set(messages.map(m=>m.id));let added=false;
  for(const child of [...ui.log.children])if(!ids.has(child.dataset.messageId))child.remove();
  messages.forEach((message,index)=>{let node=existing.get(message.id);if(!node){node=messageNode(message);added=true;}else if(node._signature!==JSON.stringify(message)){const replacement=messageNode(message);node.replaceWith(replacement);node=replacement;}
   if(ui.log.children[index]!==node)ui.log.insertBefore(node,ui.log.children[index]||null);
  });
  if(bottom){ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;}else{ui.log.scrollTop=previous;if(added&&!force)ui.newMessages.hidden=false;}
 }
 function renderStatus(){
  if(!context)return;const s=stateFor(context.report.id),data=s.data,job=data?.job,connected=data?.connection?.connected,view=conversationPresentation(context.report,job);
  if(data&&ui.lastConnection!==connected){ui.connection.open=!connected;ui.lastConnection=connected;}
  setText(ui.status,s.loading&&!data?'대화 기록 확인 중…':data?(connected?(data.connection.label||'Codex')+' 연결됨':'Codex 연결 필요')+(job||!view.editable?' · '+view.label:''):'');
  setText(ui.dispatch,view.dispatch||(data?.dispatch?.automatic?(data.dispatch.runner?.phase==='working'?'Codex 작업 중 · 응답과 수정안을 기다리는 중':'자동 작업자 실행 중 · 이 채팅에서 지시하고 답변을 확인하세요.'):(data?.dispatch?.note||'최초 연결 인증 후 이 화면에서 작업합니다.')));
  setText(ui.guidance,view.guidance|| (job&&job.kind!=='conversation'?'이전 수동 작업입니다. 아래에서 대화 작업을 맡기면 이전 초안을 대체하고 Codex가 종류·치수를 제안합니다.':['draft','ready'].includes(job?.status)?'수정할 점을 작업 채팅으로 보내거나 아래의 수정안을 최종 승인하세요.':'원하는 결과를 설명해 주세요. 종류·치수·사진 보정은 Codex가 제안합니다.'));
  ui.handoff.hidden=true;ui.handoffId.textContent=job?'현재 작업 '+job.id:'';ui.handoffPrompt.value=job?codexTaskPrompt(job.id):'';ui.handoffOpen.href=job?codexPromptUrl(ui.handoffPrompt.value):'#';
  ui.questions.replaceChildren();ui.questions.hidden=true;ui.jobError.textContent=view.editable?job?.error||'':'';ui.jobError.hidden=!view.editable||!job?.error;ui.retryWork.hidden=!view.editable||!data?.dispatch?.retryable;
  ui.draft.hidden=!(job?.proposal_id&&(view.result||view.editable&&['draft','ready'].includes(job.status)));setText(ui.draft,view.result?'승인 결과 확인':'초안 검토로 이동');ui.work.hidden=true;compose();
 }
 async function load(id,operationEpoch=epoch){
  if(!current(id)||operationEpoch!==epoch)return;const s=stateFor(id);if(s.sending){schedule(id);return;}
  const controller=new AbortController();pollRequest=controller;s.loading=true;renderStatus();if(!s.data)renderHistory();
  try{const data=await api('/api/console/reports/'+id+'/chat',{signal:controller.signal});if(!current(id)||operationEpoch!==epoch)return;const signature=JSON.stringify([data.job?.id,data.job?.proposal_id,data.job?.status]);const changed=s.signature&&signature!==s.signature;s.signature=signature;s.data=data;s.syncError='';renderHistory();renderStatus();if(changed)await onWorkChange?.(id);}
  catch(e){if(current(id)&&operationEpoch===epoch&&e.name!=='AbortError'){s.syncError='대화 기록을 불러오지 못했습니다. 입력을 유지한 채 다시 시도할 수 있습니다. '+e.message;compose();}}
  finally{if(pollRequest===controller)pollRequest=null;s.loading=false;if(current(id)&&operationEpoch===epoch){renderHistory();renderStatus();schedule(id);}}
 }
 function schedule(id){clearTimeout(poll);if(current(id))poll=setTimeout(()=>load(id),8000);}
 async function send(){
  if(!context||!owner)return;compose();if(ui.send.disabled)return;const id=context.report.id,s=stateFor(id);if(s.sending||(!s.text.trim()&&!s.items.length))return;
  if(s.text.length>12000||s.items.length>MAX_FILES){s.error='본문은 12,000자, 첨부는 8개까지 보낼 수 있습니다.';compose();return;}
  const operationEpoch=epoch,operationOwner=owner,start=needsStart(s),version=context.report.updated_at,confirmed=ui.consent.checked,controller=new AbortController();s.controller=controller;s.sending=true;s.error='';s.requestId||=crypto.randomUUID();clearTimeout(poll);pollRequest?.abort();pollRequest=null;compose();renderFiles();
  try{
   for(let index=0;index<s.items.length;index++){const item=s.items[index];if(item.uploaded)continue;item.uploading=true;item.error='';s.phase='첨부 '+(index+1)+'/'+s.items.length+' 업로드 중';if(current(id)){renderFiles();compose();}
    try{const out=await api('/api/console/reports/'+id+'/chat/files',{method:'POST',body:item.file,headers:{'Content-Type':mimeOf(item.file),'X-File-Name':encodeURIComponent(item.file.name)},signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;if(!out.file?.id)throw Error('첨부파일 저장 결과를 확인하지 못했습니다.');item.uploaded=out.file;}
    catch(e){item.error=e.message;throw e;}finally{item.uploading=false;if(current(id))renderFiles();}
   }
   s.phase='Codex가 읽을 대기열에 저장 중';if(current(id))compose();
   const data=await api('/api/console/reports/'+id+'/chat',{method:'POST',body:JSON.stringify({request_id:s.requestId,text:s.text,attachment_ids:s.items.map(item=>item.uploaded.id),...(start?{start:true,confirm:confirmed,report_version:version}:{})}),signal:controller.signal});if(operationEpoch!==epoch||operationOwner!==owner)return;
   s.data=data;s.text='';for(const item of s.items)dropPreview(item);s.items=[];s.requestId=null;s.phase='요청을 저장했습니다. Codex의 실제 답변이 이 대화에 표시됩니다.';s.syncError='';if(current(id)){ui.text.value='';ui.files.value='';ui.consent.checked=false;renderFiles();renderHistory();renderStatus();}await onWorkChange?.(id);toast('대화 작업을 저장했습니다.');
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
 async function attachImage(blob,{name='배치 확인.png',note=''}={}){
  if(!context||!owner||!['review','held','accepted'].includes(context.report.status))throw Error('작업할 제보를 선택한 뒤 이미지를 첨부하세요.');
  const operationOwner=owner,operationEpoch=epoch,id=context.report.id,s=stateFor(id);if(s.sending)throw Error('현재 전송을 마친 뒤 이미지를 첨부하세요.');
  if(s.items.length>=MAX_FILES)throw Error('첨부는 한 번에 8개까지입니다.');
  const image=await createImageBitmap(blob);let file;
  try{if(operationOwner!==owner||operationEpoch!==epoch||!current(id))throw Error('이미지를 준비하는 동안 계정이나 제보가 바뀌었습니다. 현재 제보에서 다시 첨부하세요.');const k=Math.min(1,2048/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*k));canvas.height=Math.max(1,Math.round(image.height*k));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);let output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!output||output.size>MAX_BYTES){output=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));name=name.replace(/\.png$/i,'.jpg');}if(!output||output.size>MAX_BYTES)throw Error('이미지를 4MB 이하로 줄여 다시 첨부하세요.');name=name.replace(/\.[^.]+$/,'')+(output.type==='image/png'?'.png':'.jpg');file=new File([output],name,{type:output.type});}finally{image.close();}
  if(operationOwner!==owner||operationEpoch!==epoch||!current(id))throw Error('이미지를 준비하는 동안 계정이나 제보가 바뀌었습니다. 현재 제보에서 다시 첨부하세요.');
  addFiles([file]);if(note){s.text+=(s.text?'\n':'')+note;ui.text.value=s.text;compose();}ui.text.focus();toast('이미지를 첨부했습니다. 수정할 점을 적고 전송하세요.');
 }
 function mount(target){
  panel=target;if(!panel)return;panel.hidden=true;
  panel.innerHTML='<header class="ebi-head"><div><h3 id="ebiChatTitle">Codex와 작업</h3><p id="ebiContext" class="fine"></p></div><button type="button" id="ebiToggle" aria-controls="ebiBody" aria-expanded="true">접기</button></header><div id="ebiBody" class="ebi-body"><p id="ebiStatus" class="ebi-status" role="status"></p><p id="ebiDispatch" class="fine"></p><p id="ebiSyncError" class="error" role="status"></p><div class="buttons"><button type="button" id="ebiRetry" hidden>기록 다시 불러오기</button><button type="button" id="ebiWork">작업 설정으로 이동</button><button type="button" id="ebiDraft" hidden>초안 검토로 이동</button></div><ul id="ebiQuestions" class="ebi-questions" hidden></ul><p id="ebiJobError" class="error" hidden></p><div id="ebiLog" class="ebi-log" role="log" aria-label="Codex 대화 기록" aria-live="polite" aria-relevant="additions text" tabindex="0"></div><button type="button" id="ebiNewMessages" hidden>새 메시지 보기 ↓</button><form id="ebiForm" class="ebi-composer"><label for="ebiText">Codex에게 할 말</label><textarea id="ebiText" rows="3" maxlength="12000" placeholder="사진·자료를 첨부하고 필요한 작업을 설명해 주세요."></textarea><div class="ebi-compose-tools"><label class="button ebi-file-picker">사진·파일 첨부<input id="ebiFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"></label><span id="ebiCount" class="fine"></span><button type="submit" class="primary" id="ebiSend">Codex에게 보내기</button></div><p class="fine">JPG·PNG·PDF·TXT·MD·CSV·JSON·DOCX·XLSX · 총 8개 · 파일당 4MB<br>⌘/Ctrl + Enter로 전송합니다. 최종 승인은 아래 초안 검토 화면에서 직접 합니다.</p><ul id="ebiFilesList" class="ebi-files"></ul><p id="ebiPhase" class="fine" role="status"></p><p id="ebiError" class="error" role="alert"></p></form></div>';
  const select=id=>panel.querySelector('#'+id);ui={context:select('ebiContext'),toggle:select('ebiToggle'),body:select('ebiBody'),status:select('ebiStatus'),dispatch:select('ebiDispatch'),syncError:select('ebiSyncError'),retry:select('ebiRetry'),work:select('ebiWork'),draft:select('ebiDraft'),questions:select('ebiQuestions'),jobError:select('ebiJobError'),log:select('ebiLog'),newMessages:select('ebiNewMessages'),form:select('ebiForm'),text:select('ebiText'),files:select('ebiFiles'),count:select('ebiCount'),send:select('ebiSend'),filesList:select('ebiFilesList'),phase:select('ebiPhase'),error:select('ebiError')};
  select('ebiChatTitle').textContent='작업 지시 채팅 · Codex';
  ui.retryWork=element('button','','재시도 요청 작성');ui.retryWork.type='button';ui.retryWork.hidden=true;ui.jobError.after(ui.retryWork);ui.retryWork.onclick=()=>{if(!context)return;const s=stateFor(context.report.id);if(!s.text.trim())s.text='이전 작업이 중단되었습니다. 같은 제보 사진과 최신 요청을 다시 확인해 수정안을 작성해 주세요.';ui.text.value=s.text;s.requestId=null;compose();ui.text.focus();toast('재시도 요청을 준비했습니다. 내용을 확인하고 전송하세요.');};
  ui.handoff=element('section','codex-handoff');ui.handoff.hidden=true;ui.handoffId=element('p','fine');ui.handoffOpen=element('a','button','Codex에서 작업 열기');ui.handoffOpen.title='입력창에 요청문을 채웁니다. Codex에서 전송해야 시작합니다.';const copy=element('button','','Codex 요청문 복사');copy.type='button';ui.handoffPrompt=element('textarea','');ui.handoffPrompt.readOnly=true;ui.handoffPrompt.rows=5;ui.handoffPrompt.setAttribute('aria-label','최신 Codex 작업 요청문');const details=element('details','');details.append(element('summary','','작업 요청문 확인'),ui.handoffPrompt);const controls=element('div','buttons');controls.append(ui.handoffOpen,copy);ui.handoff.append(ui.handoffId,controls,element('p','fine','Codex 앱의 입력창이 열립니다. 직접 전송해야 작업이 시작되며, 저장만으로 자동 실행되지 않습니다. 질문에 답하면 최신 작업 ID로 이어집니다.'),details);ui.dispatch.after(ui.handoff);copy.onclick=async()=>{try{await navigator.clipboard.writeText(ui.handoffPrompt.value);toast('최신 작업 요청문을 복사했습니다. Codex 입력창에서 전송하세요.');}catch{ui.handoffPrompt.closest('details').open=true;ui.handoffPrompt.focus();ui.handoffPrompt.select();toast('요청문을 선택했습니다. 직접 복사해 주세요.');}};
  ui.guidance=element('p','fine');ui.dispatch.after(ui.guidance);
  ui.scope=element('label','ebi-scope');ui.consent=element('input','');ui.consent.type='checkbox';ui.scope.append(ui.consent,document.createTextNode(' 이 제보의 층·핀 주변에서 파사드 교체, 생성·보정 이미지와 새 구조물 초안, 독립 장애물 숨김을 검토하도록 맡깁니다. Codex의 치수 추정은 근거와 한계를 표시하며, 최종 승인 전 지도는 바뀌지 않습니다.'));ui.form.querySelector('.ebi-compose-tools').before(ui.scope);ui.consent.onchange=compose;
  const connection=element('section','ebi-connection');connection.append(element('h3','','Codex 연결 설정'));const link=element('div','');link.innerHTML=dotsLinkCard('dots');connection.append(link);(document.querySelector('#connectionHost')||ui.body).prepend(connection);ui.connection=connection;
  ui.filesList.before(element('p','fine','보낸 대화는 서버에 저장됩니다. 작성 중인 글·첨부는 제보 전환과 화면 내 기록 갱신에는 유지되지만, 브라우저 새로고침·종료 시 사라집니다.'));
  ui.toggle.onclick=()=>{opened=!opened;ui.body.hidden=!opened;ui.toggle.textContent=opened?'접기':'Codex와 작업 열기';ui.toggle.setAttribute('aria-expanded',String(opened));};
  ui.text.oninput=()=>{if(!context)return;const s=stateFor(context.report.id);s.text=ui.text.value;s.requestId=null;s.error='';compose();};ui.files.onchange=()=>addFiles();ui.text.onpaste=async e=>{const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;e.preventDefault();try{for(const file of files)await attachImage(file);}catch(error){toast(error.message);}};ui.form.onsubmit=e=>{e.preventDefault();send();};ui.text.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();send();}};
  ui.retry.onclick=()=>{if(context){stop();load(context.report.id);}};ui.log.onscroll=()=>{preserveScroll();if(context&&stateFor(context.report.id).atBottom)ui.newMessages.hidden=true;};ui.newMessages.onclick=()=>{ui.log.scrollTop=ui.log.scrollHeight;ui.newMessages.hidden=true;preserveScroll();};
  ui.work.remove();ui.draft.onclick=()=>{const job=context&&stateFor(context.report.id).data?.job;if(job?.proposal_id)Promise.resolve(onOpenDraft?.({reportId:context.report.id,proposalId:job.proposal_id})).catch(e=>toast(e.message));};
 }
 function report(next,nextOwner){
  if(!panel)return;if(!nextOwner){clear();return;}if(owner!==nextOwner){clear();owner=nextOwner;}panel.hidden=false;
  const id=next?.report?.id;if(!id){preserveScroll();stop();context=null;ui.context.textContent='왼쪽 목록에서 제보를 선택해 주세요.';ui.guidance.textContent='';ui.body.hidden=!opened;ui.text.value='';ui.files.value='';ui.filesList.replaceChildren();ui.text.disabled=true;ui.files.disabled=true;ui.send.disabled=true;ui.log.replaceChildren(element('p','ebi-empty','제보를 선택하면 Codex에게 사진·파일과 작업 설명을 보낼 수 있습니다.'));ui.work.hidden=true;ui.draft.hidden=true;bindDotsLink({api,toast,isCurrent:()=>Boolean(owner)},null);return;}
  const changed=context?.report.id!==id;if(changed){preserveScroll();stop();}context=next;const s=stateFor(id);ui.context.textContent=[next.report.station_name,next.report.floor,next.report.type_label].filter(Boolean).join(' · ')+' · 이 제보의 대화';
  if(changed){ui.text.value=s.text;ui.files.value='';ui.consent.checked=false;ui.log.replaceChildren();renderFiles();renderHistory(true);bindDotsLink({api,toast,isCurrent:current},id);}compose();renderStatus();if(changed||!s.data){stop();load(id);}
 }
 return {mount,report,clear,stop,attachImage};
}
