import assert from 'node:assert/strict';
import {createEbiChat} from '../src/console/ebi-chat.js';

// Execute the real mount/report/renderStatus controller without a network or a
// browser dependency. This catches closure/DOM update errors, not just labels.
const nodes=new Map();
let sampledPixels=new Uint8ClampedArray([0,0,0,255]);
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.isConnected=true;this.scrollTop=0;this.scrollHeight=0;this.clientHeight=0;}
 set innerHTML(value){this._html=value;for(const [,id]of value.matchAll(/\bid="([^"]+)"/g)){const node=new Element();node.id=id;nodes.set(id,node);}}
 get innerHTML(){return this._html||'';}
 querySelector(selector){if(selector.startsWith('#'))return nodes.get(selector.slice(1))||null;return new Element();}
 append(...children){for(const child of children)child.parent=this;this.children.push(...children);}
 prepend(...children){for(const child of children)child.parent=this;this.children.unshift(...children);}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 insertBefore(node,reference){
  if(node.parent)node.parent.children=node.parent.children.filter(child=>child!==node);
  const index=reference?this.children.indexOf(reference):this.children.length;
  this.children.splice(index,0,node);
  node.parent=this;
 }
 replaceWith(node){this.parent.insertBefore(node,this);this.remove();}
 before(){} after(){} remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;this.isConnected=false;}
 setAttribute(name,value){this.attributes[name]=value;}
 getContext(){return {drawImage(){},getImageData:()=>({data:sampledPixels})};}
 toBlob(resolve,type){resolve(new Blob(['fixture'],{type}));}
 focus(){} select(){}
}
const nativeDocument=globalThis.document,nativeBitmap=globalThis.createImageBitmap;
globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text}),querySelector:()=>null};
let chat;
try{
 const job={id:'c74a3ce4-6d3c-4b17-b081-2fc25aee8d39',kind:'conversation',status:'draft',proposal_id:'proposal',report_version:'v1'};
 chat=createEbiChat({api:async()=>({messages:[],connection:{connected:true,label:'시험 Codex'},job,dispatch:{automatic:false}}),toast:()=>{}});
 const panel=new Element();chat.mount(panel);
 const report=status=>({report:{id:'report',station_name:'서울역',floor:'2F',type_label:'파사드',status,updated_at:status==='accepted'?'v1':'v2'}});
 chat.report(report('accepted'),'시험 승인자');await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.get('ebiStatus').textContent,/검토할 초안 있음/);assert.equal(nodes.get('ebiText').disabled,false);
 chat.report(report('applied'),'시험 승인자');
 assert.match(nodes.get('ebiStatus').textContent,/지도 반영 완료/);assert(!nodes.get('ebiStatus').textContent.includes('초안 있음'));assert.equal(nodes.get('ebiText').disabled,true);assert.equal(nodes.get('ebiSend').textContent,'작업 전송 종료');assert.equal(nodes.get('ebiDraft').textContent,'승인 결과 확인');assert.equal(nodes.get('ebiDraft').hidden,false);
 chat.report(report('queued'),'시험 승인자');assert.match(nodes.get('ebiStatus').textContent,/지도 반영 대기/);assert.equal(nodes.get('ebiText').disabled,true);
 chat.report(report('rejected'),'시험 승인자');assert.match(nodes.get('ebiStatus').textContent,/제보 반려 · 종료/);assert.equal(nodes.get('ebiDraft').hidden,true);
 chat.report(report('accepted'),'시험 승인자');assert.equal(nodes.get('ebiText').disabled,false);assert.match(nodes.get('ebiStatus').textContent,/검토할 초안 있음/);
 let finishBitmap;globalThis.createImageBitmap=()=>new Promise(resolve=>finishBitmap=resolve);
 const attachment=chat.attachImage(new Blob(['test'],{type:'image/png'}));
 chat.clear();chat.report(report('accepted'),'다른 승인자');
 finishBitmap({width:2,height:2,close(){}});await assert.rejects(attachment,/계정이나 제보/,'An image prepared under another login must not enter the new composer');
 assert.equal(nodes.get('ebiText').value,'');
 globalThis.createImageBitmap=async()=>({width:2,height:2,close(){}});await chat.attachImage(new Blob(['image'],{type:'image/jpeg'}),{name:'지도 배치.jpg'});
 assert.equal(nodes.get('ebiFilesList').children[0].children[1].children[0].textContent,'지도 배치.png','Normalized image MIME and filename extension agree');assert.match(nodes.get('ebiCount').textContent,/첨부 1\/8/);
 const mapImage=new Blob(['capture'],{type:'image/jpeg'}),mapOptions={mapCapture:true,note:'배치 확인'};
 await assert.rejects(chat.attachImage(mapImage,mapOptions),/지도 화면이 캡처되지 않았습니다/);
 sampledPixels=new Uint8ClampedArray([255,255,255,0]);
 await assert.rejects(chat.attachImage(mapImage,mapOptions),/지도 화면이 캡처되지 않았습니다/);
 assert.match(nodes.get('ebiCount').textContent,/첨부 1\/8/);assert.equal(nodes.get('ebiText').value,'');
 sampledPixels=new Uint8ClampedArray([12,48,86,255]);
 await chat.attachImage(mapImage,mapOptions);assert.match(nodes.get('ebiCount').textContent,/첨부 2\/8/);assert.equal(nodes.get('ebiText').value,'배치 확인');

 chat.clear();assert.equal(panel.hidden,true);

 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 const instructions=[{id:'instruction-a',role:'admin',job_id:'job-a',text:'첫 지시',created_at:'2026-11-07T04:00:00Z'}];
 const snapshot=(state,{id='job-a',messageId='instruction-a',parentJobId=null,messages=instructions,questions=[]}={})=>({
  messages,connection:{connected:true,label:'시험 Codex'},
  job:{id,kind:'conversation',status:state==='draft_submitted'?'draft':state==='needs_info'?'needs_info':'awaiting_external',report_version:'v1',proposal_id:state==='draft_submitted'?'proposal':null,questions,
   execution:{state,job_id:id,message_id:messageId,parent_job_id:parentJobId,updated_at:'2026-11-07T04:03:00Z',retryable:['failed','interrupted'].includes(state),runner_online:state!=='offline'}},
  dispatch:{automatic:true,runner:{phase:'working'},retryable:true},
 });
 let data=snapshot('waiting'),read=async()=>data,write,postCount=0,refreshCount=0;
 const api=(path,options)=>{
  if(!path.endsWith('/chat'))return Promise.resolve({});
  if(options?.method==='POST'){postCount++;return write(JSON.parse(options.body));}
  return read(path,options);
 };
 const mount=()=>{chat=createEbiChat({api,toast:()=>{},onWorkChange:()=>{refreshCount++;}});chat.mount(new Element());chat.report(report('accepted'),'시험 승인자');};
 const node=id=>nodes.get(id),status=()=>node('ebiStatus').textContent;
 const reload=async()=>{node('ebiRetry').onclick();await settle();};
 const active=()=>node('ebiLog').children.filter(child=>child.dataset.activeInstruction);
 const ids=()=>node('ebiLog').children.map(child=>child.dataset.messageId);
 mount();await settle();
 assert.equal(status(),'작업 대기','an online worker working on another job cannot start this instruction');
 const originalInstruction=active()[0];
 data=snapshot('received');await reload();assert.equal(status(),'작업 접수');
 data=snapshot('working');await reload();assert.equal(status(),'Codex 작업 중');
 assert.equal(active()[0],originalInstruction,'lifecycle polls preserve the same message bubble');
 assert.equal(refreshCount,0,'lease-only transitions update chat without refreshing the map');
 for(const [state,label] of [['needs_info','보완 필요'],['draft_submitted','초안 제출'],['failed','작업 실패'],['interrupted','작업 중단'],['offline','작업자 오프라인'],['cancelled','작업 취소'],['applied','지도 반영 완료']]){
  data=snapshot(state,{questions:state==='needs_info'?['좌측 끝을 확인해 주세요.']:[]});await reload();assert.equal(status(),label);
  assert.equal(node('ebiRetryWork').hidden,!['failed','interrupted'].includes(state));
  if(state==='needs_info')assert.equal(node('ebiQuestions').children[0].textContent,'좌측 끝을 확인해 주세요.');
  if(state==='applied')assert.equal(node('ebiText').disabled,true);
 }
 const reply={id:'answer-a',role:'agent',job_id:'job-a',text:'좌측 끝을 확인해 주세요.',created_at:'2026-11-07T04:04:00Z'};
 data=snapshot('needs_info',{messages:[...instructions,reply,reply],questions:[reply.text]});await reload();
 assert.deepEqual(ids(),['instruction-a','answer-a']);
 assert.equal(node('ebiQuestions').hidden,true,'a saved reply is not duplicated as a status question');

 data=snapshot('waiting');data.job.execution.job_id='other-job';await reload();
 assert.equal(status(),'작업 대기');assert(!node('ebiDispatch').textContent.includes('Codex 작업 중'));
 read=async()=>{throw Error('연결 시험');};await reload();
 assert.equal(status(),'작업 상태 확인 지연');assert.match(node('ebiSyncError').textContent,/연결 시험/);

 const pending=[];
 read=(path,{signal})=>new Promise(resolve=>pending.push({path,signal,resolve}));
 node('ebiRetry').onclick();
 chat.report({report:{...report('accepted').report,id:'other-report'}},'시험 승인자');
 chat.report(report('accepted'),'시험 승인자');
 assert.equal(pending.length,3);assert(pending[0].signal.aborted&&pending[1].signal.aborted);
 pending[2].resolve(snapshot('working'));await settle();
 pending[0].resolve(snapshot('draft_submitted'));pending[1].resolve(snapshot('offline'));await settle();
 assert.equal(status(),'Codex 작업 중','an aborted response cannot overwrite a reselected report');

 let sentId;
 write=async body=>{
  sentId=body.request_id;
  const followup={id:sentId,role:'admin',job_id:'job-b',text:body.text,created_at:'2026-11-07T04:05:00Z'};
  data=snapshot('waiting',{id:'job-b',messageId:sentId,parentJobId:'job-a',messages:[...instructions,reply,followup]});
  throw Error('저장 응답 유실');
 };
 read=async()=>data;
 node('ebiText').value='우측을 한 칸 더 넓혀 주세요.';node('ebiText').oninput();
 node('ebiForm').onsubmit({preventDefault(){}});await settle();
 assert.equal(postCount,1);assert.equal(node('ebiText').value,'우측을 한 칸 더 넓혀 주세요.');
 await reload();
 assert.equal(postCount,1,'finding the saved request does not send it again');
 assert.equal(node('ebiText').value,'');assert.match(node('ebiPhase').textContent,/저장된 지시/);
 assert.deepEqual(ids(),['instruction-a','answer-a',sentId]);
 assert.equal(active()[0].dataset.messageId,sentId);
 assert.equal(active()[0].children[0].children.at(-1).textContent,'현재 보완 지시');
 chat.clear();mount();await settle();
 assert.equal(status(),'작업 대기');assert.equal(active()[0].dataset.messageId,sentId);assert.equal(postCount,1);
 chat.clear();
 const oldVersion='2026-11-07T04:00:00.000Z',batchVersion='2026-11-07T04:01:00.000Z';
 data=snapshot('received');data.job.report_version=batchVersion;
 let batchRefreshes=0;
 chat=createEbiChat({api,toast:()=>{},onWorkChange:()=>{
  batchRefreshes++;
  chat.report({report:{...report('accepted').report,updated_at:batchVersion}},'시험 승인자');
 }});
 chat.mount(new Element());
 chat.report({report:{...report('review').report,updated_at:oldVersion}},'시험 승인자');await settle();
 assert.equal(batchRefreshes,1,'The first chat snapshot refreshes a report just adopted by a batch');
 data=snapshot('working');data.job.report_version=batchVersion;
 await reload();assert.equal(status(),'Codex 작업 중');assert.equal(batchRefreshes,1);
 console.log('PASS: authoritative lifecycle states, stale polls, instruction linkage, saved-request recovery, message deduplication and reload');
}finally{chat?.stop();globalThis.document=nativeDocument;globalThis.createImageBitmap=nativeBitmap;}
