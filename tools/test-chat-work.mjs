import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encode,decode} from 'fast-png';
import {zipSync} from 'fflate';
import server from '../server/index.js';
import {d1Adapter} from './sqlite-adapter.mjs';

// Exercise the real Worker endpoints with isolated, memory-only D1/R2.
// A chat must not call a model provider, wake a dot, or publish a map change.
const db=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
let putHook=null;
const files=new Map(),env={DB:d1Adapter(db),APPROVERS:'채팅 승인자:chat-password-8,별도 승인자:other-password-8',UPLOADS:{
 async put(key,body){files.set(key,body);if(putHook)await putHook(key);},
 async delete(key){files.delete(key);},
 async get(key){return files.has(key)?{body:files.get(key)}:null;}
}};
const nativeDate=globalThis.Date,nativeFetch=globalThis.fetch;
let clock=nativeDate.now(),networkAttempts=0,rpcId=0;
globalThis.Date=class extends nativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const station='S202103',position=[126.9706,37.5539,36.2],principalA='sites-chat-dot-a',principalB='sites-chat-dot-b';
globalThis.fetch=async url=>{
 const path=String(url);
 if(path.endsWith('/approved-facades.json'))return new Response(JSON.stringify({replacements:[{is_active:true,image_url:'/chat-fixture.png',replacement_width_px:64,replacement_height_px:32,current_store_name:'채팅 검증 매장',slot:{slot_alias:'CHAT-S01',floor:'2F',longitude:position[0],latitude:position[1],height_m:position[2],camera_heading_deg:90,surface_width_m:2,surface_height_m:1}}]}));
 if(path.endsWith('/catalog.json'))return new Response(JSON.stringify({facilities:[],endpoints:[]}));
 networkAttempts++;throw Error('External network is forbidden in the chat fixture');
};
const width=32,height=24,pixels=new Uint8Array(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([x*7,y*9,(x+y)*4,255],(y*width+x)*4);
const photo=encode({width,height,data:pixels,channels:4,depth:8}),utf8=new TextEncoder();
const structure={name:'대화 검증 키오스크',floor:'2F',position,size:[1.2,.6,2],heading:90,color:'#cccccc',dimension_basis:'measured'};
const quad=[[0,0],[1,0],[1,1],[0,1]];
function seed(){
 const id=crypto.randomUUID(),ids=[crypto.randomUUID(),crypto.randomUUID()],stamp=new Date().toISOString();
 db.prepare('INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,station,'2F',JSON.stringify(position),'new','채팅 증거용 키오스크 제보','review','fixture','[]',stamp,stamp);
 for(const [index,pid] of ids.entries()){
  files.set('report/'+pid,photo);
  db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid,id,'image/png',photo.length,width,height,index?'left':'front',stamp);
 }
 return {id,ids};
}
const report=id=>db.prepare('SELECT * FROM reports WHERE id=?').get(id);
const job=id=>db.prepare('SELECT * FROM report_jobs WHERE id=?').get(id);
const proposalCount=id=>db.prepare('SELECT count(*) AS n FROM proposals WHERE report_ids=?').get(JSON.stringify([id])).n;
const layer=()=>JSON.parse(db.prepare('SELECT body FROM station_layers WHERE station_key=?').get(station)?.body||'{}');
const chatPath=id=>'/api/console/reports/'+id+'/chat';
const plan=ids=>({kind:'structure',name:'대화 검증 키오스크',summary:'대화와 증거를 반영한 비공개 초안',confidence:.95,questions:[],hide_ids:[],faces:ids.map((photo_id,index)=>({side:index?'left':'front',photo_id,quad,privacy_reviewed:true,people:[]}))});
function call(path,{method='GET',body,raw,jar='',principal,origin='http://chat.test',extra={},ctx}={}){
 return server.fetch(new Request('http://chat.test'+path,{method,headers:{Origin:origin,...(jar?{Cookie:jar}:{}),...(principal?{'oai-authenticated-user-id':principal}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})}),env,ctx);
}
async function login(name,password){const r=await call('/api/console/login',{method:'POST',body:{name,password}});assert.equal(r.status,200,await r.clone().text());return r.headers.get('set-cookie').split(';')[0];}
async function rpc(method,params={},options={}){
 const id=++rpcId,r=await call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id,method,params},extra:{Accept:'application/json, text/event-stream'},...options});
 const payload=await r.json();if(r.ok){assert.equal(payload.jsonrpc,'2.0');assert.equal(payload.id,id);}return {status:r.status,payload};
}
const tool=(name,args={},principal=principalA,extra={})=>rpc('tools/call',{name,arguments:args},{principal,...extra});
const isDenied=r=>r.status>=400||Boolean(r.payload.error)||!r.payload.result||r.payload.result.isError===true;
const denied=r=>assert(isDenied(r),'MCP request unexpectedly succeeded');
function data(r){assert(!isDenied(r),'MCP failed: '+JSON.stringify(r.payload.error||r.payload));const v=r.payload.result;return v.structuredContent||JSON.parse(v.content.find(c=>c.type==='text').text);}
async function pair(jar,principal){
 const r=await call('/api/console/dots-link',{method:'POST',jar,principal,body:{confirm:true}});assert.equal(r.status,201,await r.clone().text());
 const issued=await r.json();return data(await tool('toolkit_connect_agent',{code:issued.code},principal));
}
async function createWork(r,jar){
 const response=await call('/api/console/ai-work',{method:'POST',jar,body:{report_id:r.id,report_version:report(r.id).updated_at,request_id:crypto.randomUUID(),operation_approved:true,engine:'dots',kind:'structure',structure}});
 assert.equal(response.status,202,await response.clone().text());return (await response.json()).job;
}
async function readChat(id,jar){const r=await call(chatPath(id),{jar});assert.equal(r.status,200,await r.clone().text());const v=await r.json();assert.equal(v.report_id,id);assert(Array.isArray(v.messages));assert.equal(v.dispatch.automatic,false);return v;}
async function sendAdmin(id,jar,text,attachment_ids=[],request_id=crypto.randomUUID()){
 const r=await call(chatPath(id),{method:'POST',jar,body:{request_id,text,attachment_ids}});assert(r.ok,await r.clone().text());return {response:r,value:await r.json(),request_id};
}
async function upload(id,jar,name,mime,raw){return call(chatPath(id)+'/files',{method:'POST',jar,raw,extra:{'Content-Type':mime,'X-File-Name':encodeURIComponent(name)}});}
function uploaded(v){return v.file||v.attachment||v;}
const findMessage=(v,text)=>v.messages.find(m=>m.text===text);
function checkNoSecrets(v){const text=JSON.stringify(v);assert(!text.includes('code_hash'));assert(!text.includes('principal_id'));assert(!text.includes('chat-password'));}

try{
 const jarA=await login('채팅 승인자','chat-password-8'),jarB=await login('별도 승인자','other-password-8');
 const linkA=await pair(jarA,principalA);await pair(jarB,principalB);
 const own=seed(),foreign=seed(),unassigned=seed();
 const ownJob=await createWork(own,jarA),foreignJob=await createWork(foreign,jarB);
 assert.equal(ownJob.status,'awaiting_external');
 assert.equal((await call(chatPath(own.id))).status,401,'Anonymous cannot read private chat');
 assert.equal((await call(chatPath(own.id),{method:'POST',body:{request_id:crypto.randomUUID(),text:'익명',attachment_ids:[]}})).status,401);
 assert.equal((await call(chatPath(own.id),{method:'POST',jar:jarA,origin:'http://evil.test',body:{request_id:crypto.randomUUID(),text:'외부 출처',attachment_ids:[]}})).status,403);
 let ownChat=await readChat(own.id,jarA);checkNoSecrets(ownChat);assert.equal(ownChat.connection.connected,true);
 const originalJobs=db.prepare('SELECT count(*) AS n FROM report_jobs').get().n;
 await sendAdmin(unassigned.id,jarA,'아직 에비에게 맡기지 않은 메모');
 const unassignedChat=await readChat(unassigned.id,jarA);assert.equal(unassignedChat.job,null);assert(findMessage(unassignedChat,'아직 에비에게 맡기지 않은 메모'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM report_jobs').get().n,originalJobs,'A chat message does not authorize a new assignment');
 { // Chat-first consent starts a bounded Dots assignment without a kind/dimension form.
 const conversational=seed(),request_id=crypto.randomUUID(),startBody={request_id,start:true,confirm:true,report_version:report(conversational.id).updated_at,text:'키오스크 간판과 받침을 포함해 사진으로 추정해 주세요. 뒤쪽 벽과 배너는 제외하세요.',attachment_ids:[]};
 let started=await call(chatPath(conversational.id),{method:'POST',jar:jarA,body:{...startBody,confirm:false}});assert.equal(started.status,409);
 started=await call(chatPath(conversational.id),{method:'POST',jar:jarA,body:startBody});assert.equal(started.status,201,await started.clone().text());
 const conversation=await started.json(),cj=job(conversation.job.id),ci=JSON.parse(cj.input);assert.equal(cj.kind,'conversation');assert.equal(ci.engine,'dots');assert.equal(ci.allow_estimate,true);assert.equal(ci.structure,null);assert.deepEqual(ci.allowed_kinds,['facade','structure','removal']);assert(ci.facade_aliases.includes('CHAT-S01'));assert.equal(cj.report_version,report(conversational.id).updated_at);assert.equal(report(conversational.id).status,'accepted');
 const startedCount=db.prepare('SELECT count(*) AS n FROM report_jobs').get().n;
 started=await call(chatPath(conversational.id),{method:'POST',jar:jarA,body:startBody});assert.equal(started.status,200);assert.equal(db.prepare('SELECT count(*) AS n FROM report_jobs').get().n,startedCount);
 const cw=data(await tool('toolkit_read_work',{job_id:cj.id}));assert.equal(cw.required_information.length,0);assert(cw.facade_candidates.some(s=>s.alias==='CHAT-S01'));assert(cw.instructions.includes('DO NOT ask the administrator to operate forms'));
 const inferred={...plan(conversational.ids),structure:{...structure,dimension_basis:'estimated'},structure_provenance:{evidence:'사진의 간판·받침 비례를 기준으로 추정',uncertainty:'절대 척도가 없어 실측과 다를 수 있음'}};
 denied(await tool('toolkit_submit_plan',{job_id:cj.id,plan:{...inferred,structure:{...inferred.structure,floor:'3F'}}}));
 denied(await tool('toolkit_submit_plan',{job_id:cj.id,plan:{...inferred,kind:'facade',structure:undefined,structure_provenance:undefined,facade_alias:'OUTSIDE'}}));
 const inferredResult=data(await tool('toolkit_submit_plan',{job_id:cj.id,plan:inferred}));assert.equal(inferredResult.status,'draft');
 const cp=db.prepare('SELECT * FROM proposals WHERE id=?').get(inferredResult.proposal_id);assert.equal(cp.kind,'structure');assert.equal(JSON.parse(cp.meta).geometry_source,'agent-estimate');assert.equal(layer().assets?.['structure-'+cp.id],undefined,'Draft must not write the public map');
 let approval=await call('/api/console/proposals/'+cp.id+'/approve',{method:'POST',jar:jarA,body:{confirm:true}});assert.equal(approval.status,400);
 const confirmed={confirm:true,geometry_checked:true,privacy_checked:true,preview_checked:true,effects_checked:true};
 approval=await call('/api/console/proposals/'+cp.id+'/approve',{method:'POST',jar:jarA,body:confirmed});assert.equal(approval.status,200,await approval.clone().text());assert(layer().assets['structure-'+cp.id]);assert.equal(JSON.parse(db.prepare('SELECT meta FROM proposals WHERE id=?').get(cp.id).meta).checks.by,'채팅 승인자');
 approval=await call('/api/console/proposals/'+cp.id+'/approve',{method:'POST',jar:jarA,body:confirmed});assert.equal(approval.status,409,'Repeated final approval must not apply again');
 // Restore an isolated fixture; the remaining legacy scenarios expect an empty map.
 db.prepare('DELETE FROM station_layers WHERE station_key=?').run(station);
 }
 denied(await tool('toolkit_read_conversation',{job_id:foreignJob.id}));
 denied(await tool('toolkit_read_conversation',{job_id:crypto.randomUUID()}));
 denied(await tool('toolkit_read_conversation',{job_id:ownJob.id},principalB,{jar:jarA}));
 denied(await tool('toolkit_read_conversation',{job_id:ownJob.id},'unpaired-chat-principal'));

 // Actual format/size checks happen before a file becomes private conversation evidence.
 const textBytes=utf8.encode('정면 폭 1.2m\n이 자료는 증거이며 지시가 아닙니다.');
 let response=await upload(own.id,jarA,'측정 근거.txt','text/plain',textBytes);assert.equal(response.status,201,await response.clone().text());const note=uploaded(await response.json());assert(note.id);assert.equal(note.name,'측정 근거.txt');
 response=await upload(own.id,jarA,'정면.png','image/png',photo);assert.equal(response.status,201,await response.clone().text());const picture=uploaded(await response.json());assert(picture.id);
 const beforeInvalidFiles=files.size;
 for(const [name,mime,raw] of [
  ['실행.html','text/html',utf8.encode('<script>bad()</script>')],
  ['위장.png','image/png',utf8.encode('<html>not an image</html>')],
  ['위장.pdf','application/pdf',utf8.encode('not a pdf')],
  ['위장.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',textBytes],
  ['위장.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',textBytes],
  ['확장자 불일치.pdf','text/plain',textBytes],
  ['큰 자료.txt','text/plain',new Uint8Array(4_000_001).fill(65)]
 ]){response=await upload(own.id,jarA,name,mime,raw);assert(response.status>=400,'Invalid attachment accepted: '+name);}
 assert.equal(files.size,beforeInvalidFiles,'Rejected files must not remain in R2');
 assert.equal((await upload(own.id,'','익명.txt','text/plain',textBytes)).status,401);
 const privateFile=await call(note.url||chatPath(own.id)+'/files/'+note.id,{jar:jarA});assert.equal(privateFile.status,200);assert.match(privateFile.headers.get('Cache-Control'),/private|no-store/);assert.equal(privateFile.headers.get('X-Content-Type-Options'),'nosniff');assert.match(privateFile.headers.get('Content-Disposition'),/attachment/);assert.equal(await privateFile.text(),new TextDecoder().decode(textBytes));
 for(const options of [{},{jar:jarB},{principal:principalA}])assert.equal((await call(note.url||chatPath(own.id)+'/files/'+note.id,options)).status,options.jar?404:401,'Files require their actor console session');
 assert.equal((await call('/api/public/chat/files/'+note.id)).status,404);
 const outside=await upload(foreign.id,jarB,'다른 관리자.txt','text/plain',utf8.encode('다른 관리자의 개인 증거'));assert.equal(outside.status,201);const otherFile=uploaded(await outside.json());
 response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:crypto.randomUUID(),text:'다른 관리자 파일',attachment_ids:[otherFile.id]}});assert(response.status>=400,'Foreign attachment must not enter this conversation');
 denied(await tool('toolkit_read_file',{job_id:ownJob.id,file_id:note.id}),'An uploaded file must first be sent in the assigned conversation');

 // The size boundary and supported document formats remain useful without executing their content.
 const docs=seed(),docsJob=await createWork(docs,jarA),documents=[];
 const documentFixtures=[
  ['현장 메모.md','text/markdown',utf8.encode('# 현장\n정면 문구 검증')],
  ['실측.csv','text/csv',utf8.encode('항목,미터\n정면폭,1.2')],
  ['측정.json','application/json',utf8.encode('{"width_m":1.2}')],
  ['참고.pdf','application/pdf',utf8.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')],
  ['검토.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',zipSync({'[Content_Types].xml':utf8.encode('<Types/>'),'word/document.xml':utf8.encode('<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>문서 본문 검증</w:t></w:r></w:p></w:body></w:document>')})],
  ['실측.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',zipSync({'[Content_Types].xml':utf8.encode('<Types/>'),'xl/sharedStrings.xml':utf8.encode('<sst><si><t>정면폭 검증</t></si></sst>'),'xl/worksheets/sheet1.xml':utf8.encode('<worksheet><sheetData><row><c><v>1.2</v></c></row></sheetData></worksheet>')})],
  ['용량 경계.txt','text/plain',new Uint8Array(4_000_000).fill(65)]
 ];
 for(const [name,mime,bytes] of documentFixtures){response=await upload(docs.id,jarA,name,mime,bytes);assert.equal(response.status,201,await response.clone().text());const file=uploaded(await response.json());assert.equal(file.mime,mime);assert.equal(file.size,bytes.length);documents.push(file);}
 await sendAdmin(docs.id,jarA,'첨부된 참고 문서를 근거로 읽어 주세요.',documents.map(f=>f.id));const documentJob=(await readChat(docs.id,jarA)).job;
 for(const file of documents){
  const read=await tool('toolkit_read_file',{job_id:documentJob.id,file_id:file.id});assert(!isDenied(read),file.name+' cannot be read');
  if(file.mime==='application/pdf'){assert(read.payload.result.content.some(c=>c.type==='resource'&&c.resource.mimeType==='application/pdf')||JSON.stringify(data(read)).match(/미지원|지원하지|읽지 못|unsupported/i),'PDF must return a typed resource or an explicit extraction limitation');}
  else{const content=data(read);assert.equal(content.mime,file.mime);assert.equal(typeof content.text,'string');assert(content.text.length<=80000,'Text output must be bounded');if(file.name==='검토.docx')assert(content.text.includes('문서 본문 검증'));if(file.name==='실측.xlsx')assert(content.text.includes('정면폭 검증'));if(file.name==='용량 경계.txt')assert.equal(content.truncated,true);}
 }
 assert.equal(job(docsJob.id).status,'cancelled');

 // A message retry preserves one message and one child job; conflicting reuse fails.
 const adminText='첨부한 정면 사진과 측정 근거를 확인해 주세요.';
 const sent=await sendAdmin(own.id,jarA,adminText,[note.id,picture.id]);
 ownChat=await readChat(own.id,jarA);const firstAdmin=findMessage(ownChat,adminText);assert(firstAdmin);assert(firstAdmin.id);assert.equal(firstAdmin.attachments.length,2);assert.deepEqual(firstAdmin.attachments.map(f=>f.id).sort(),[note.id,picture.id].sort());
 const current=ownChat.job;assert(current?.id);assert.notEqual(current.id,ownJob.id);assert.equal(current.status,'awaiting_external');
 const childInput=JSON.parse(job(current.id).input);assert.equal(childInput.parent_job_id,ownJob.id);assert.equal(childInput.chat_message_id,firstAdmin.id);assert.deepEqual(childInput.chat_file_ids.sort(),[note.id,picture.id].sort());assert(childInput.chat_context);
 assert.equal(job(ownJob.id).status,'cancelled');
 const messageCount=ownChat.messages.length,jobCount=db.prepare('SELECT count(*) AS n FROM report_jobs').get().n;
 await sendAdmin(own.id,jarA,adminText,[note.id,picture.id],sent.request_id);
 ownChat=await readChat(own.id,jarA);assert.equal(ownChat.messages.length,messageCount);assert.equal(ownChat.job.id,current.id);assert.equal(db.prepare('SELECT count(*) AS n FROM report_jobs').get().n,jobCount);
 response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:sent.request_id,text:'충돌하는 수정',attachment_ids:[]}});assert.equal(response.status,409);
 response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:crypto.randomUUID(),text:'x'.repeat(12001),attachment_ids:[]}});assert(response.status>=400);
 response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:crypto.randomUUID(),text:'첨부 수 초과',attachment_ids:Array(9).fill(note.id)}});assert(response.status>=400);
 for(const attachment_ids of [{},'not-an-array',123]){response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:crypto.randomUUID(),text:'잘못된 첨부 목록',attachment_ids}});assert.equal(response.status,400,'Non-array attachment input is a client error, not a server failure');}
 const otherActorChat=await readChat(own.id,jarB);assert(!JSON.stringify(otherActorChat).includes(adminText));assert(!JSON.stringify(otherActorChat).includes(note.id));assert.equal(otherActorChat.job,null,'Another actor sees only its own independent chat');
 const conversation=data(await tool('toolkit_read_conversation',{job_id:ownJob.id}));assert.equal(conversation.current_job_id,current.id);assert(findMessage(conversation,adminText));checkNoSecrets(conversation);
 const textRead=data(await tool('toolkit_read_file',{job_id:current.id,file_id:note.id}));assert(JSON.stringify(textRead).includes('정면 폭 1.2m'));
 const imageRead=await tool('toolkit_read_file',{job_id:current.id,file_id:picture.id});assert(!isDenied(imageRead));const image=imageRead.payload.result.content.find(c=>c.type==='image');assert(image);assert.equal(image.mimeType,'image/png');assert(Math.max(decode(Buffer.from(image.data,'base64')).width,decode(Buffer.from(image.data,'base64')).height)<=640);
 denied(await tool('toolkit_read_file',{job_id:current.id,file_id:otherFile.id}));
 denied(await tool('toolkit_read_file',{job_id:foreignJob.id,file_id:note.id},principalB));
 const agentText='사진과 치수를 확인했습니다. 초안 준비를 이어가겠습니다.',agentRequest=crypto.randomUUID();
 data(await tool('toolkit_send_message',{job_id:current.id,text:agentText,request_id:agentRequest,after_message_id:firstAdmin.id}));
 ownChat=await readChat(own.id,jarA);assert(findMessage(ownChat,agentText));const afterAgentCount=ownChat.messages.length;
 data(await tool('toolkit_send_message',{job_id:current.id,text:agentText,request_id:agentRequest,after_message_id:firstAdmin.id}));assert.equal((await readChat(own.id,jarA)).messages.length,afterAgentCount);
 const conflict=await tool('toolkit_send_message',{job_id:current.id,text:'중복 ID의 다른 내용',request_id:agentRequest,after_message_id:firstAdmin.id});assert.equal(conflict.status,409);denied(conflict);
 denied(await tool('toolkit_send_message',{job_id:foreignJob.id,text:'다른 관리자에게 송신',request_id:crypto.randomUUID(),after_message_id:firstAdmin.id}));

 // A newer administrator message invalidates an agent's old conversation anchor and draft.
 await sendAdmin(own.id,jarA,'정면 간판 색상을 다시 확인해 주세요.');const revised=await readChat(own.id,jarA);assert.notEqual(revised.job.id,current.id);
 const staleSend=await tool('toolkit_send_message',{job_id:current.id,text:'이전 문맥의 답변',request_id:crypto.randomUUID(),after_message_id:firstAdmin.id});assert.equal(staleSend.status,409);denied(staleSend);
 const wrongAnchor=await tool('toolkit_send_message',{job_id:revised.job.id,text:'최신 작업의 이전 답변 대상',request_id:crypto.randomUUID(),after_message_id:firstAdmin.id});assert.equal(wrongAnchor.status,409);denied(wrongAnchor);
 const stalePlan=await tool('toolkit_submit_plan',{job_id:current.id,plan:plan(own.ids)});assert.equal(stalePlan.status,409);denied(stalePlan);assert.equal(proposalCount(own.id),0);

 // Editing the conversation after a completed private draft supersedes that draft.
 data(await tool('toolkit_submit_plan',{job_id:revised.job.id,plan:plan(own.ids)}));
 const drafted=job(revised.job.id);assert.equal(drafted.status,'draft');assert(drafted.proposal_id);
 await sendAdmin(own.id,jarA,'초안의 정면 문구를 다시 확인해 주세요.');const afterDraft=await readChat(own.id,jarA);
 assert.notEqual(afterDraft.job.id,drafted.id);assert.equal(JSON.parse(job(afterDraft.job.id).input).parent_job_id,drafted.id);assert.equal(job(drafted.id).status,'cancelled');
 assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(drafted.proposal_id).status,'superseded');
 assert.equal((await call('/api/public/proposal-images/'+drafted.proposal_id)).status,404,'Superseding a draft never publishes its image');
 denied(await tool('toolkit_submit_plan',{job_id:drafted.id,plan:plan(own.ids)}));

 // A needs-info reply opens a scoped child job with the same full conversation history.
 const info=seed(),infoJob=await createWork(info,jarA),question='정면 전체 사진의 촬영 시점을 알려 주세요.';
 data(await tool('toolkit_request_info',{job_id:infoJob.id,questions:[question]}));assert.equal(job(infoJob.id).status,'needs_info');
 await sendAdmin(info.id,jarA,'오늘 오전 10시에 촬영했습니다.');const answered=await readChat(info.id,jarA);assert.equal(answered.job.status,'awaiting_external');assert.notEqual(answered.job.id,infoJob.id);assert.equal(JSON.parse(job(answered.job.id).input).parent_job_id,infoJob.id);
 const continued=data(await tool('toolkit_read_conversation',{job_id:infoJob.id}));assert.equal(continued.current_job_id,answered.job.id);assert(findMessage(continued,'오늘 오전 10시에 촬영했습니다.'));assert(continued.messages.some(m=>m.text.includes(question)),'The question must remain visible when its reply creates a child job');

 // A message arriving during actual image staging cannot save an obsolete proposal.
 const race=seed(),raceJob=await createWork(race,jarA);await sendAdmin(race.id,jarA,'이 사진으로 비공개 초안을 만들어 주세요.');const raceCurrent=(await readChat(race.id,jarA)).job;
 let raced=false;const objectsBefore=files.size;
 putHook=async key=>{if(key.startsWith('proposal/')){putHook=null;raced=true;assert.equal(job(raceCurrent.id).status,'running');await sendAdmin(race.id,jarA,'작업 중 새 확인사항이 생겼습니다. 잠시 보류하고 대화를 읽어 주세요.');}};
 const raceResult=await tool('toolkit_submit_plan',{job_id:raceCurrent.id,plan:plan(race.ids)});assert(raced,'Concurrent chat must arrive during real image staging');
 assert.equal(proposalCount(race.id),0,'Stale image processing must not save a draft');assert.equal(job(raceCurrent.id).proposal_id,null);assert.equal(files.size,objectsBefore,'Stale staged images are cleaned up');
 assert(isDenied(raceResult)||data(raceResult).status==='cancelled','Stale submission cannot report a completed draft');
 assert.equal(job(raceJob.id).status,'cancelled');
 const afterRace=await readChat(race.id,jarA);assert.notEqual(afterRace.job.id,raceCurrent.id);assert.equal(afterRace.job.status,'awaiting_external');assert.equal(JSON.parse(job(afterRace.job.id).input).parent_job_id,raceCurrent.id);assert.equal(job(raceCurrent.id).status,'cancelled');

 // Parallel sends preserve both messages and assign the last message as current work.
 const parallel=seed(),parallelJob=await createWork(parallel,jarA),parallelTexts=['동시 전송 첫 번째 확인사항','동시 전송 두 번째 확인사항'];
 await Promise.all(parallelTexts.map(text=>sendAdmin(parallel.id,jarA,text)));
 const parallelChat=await readChat(parallel.id,jarA);for(const text of parallelTexts)assert(findMessage(parallelChat,text));
 const latestParallelAdmin=parallelChat.messages.filter(m=>m.role==='admin').at(-1),parallelInput=JSON.parse(job(parallelChat.job.id).input);
 assert.equal(parallelChat.job.status,'awaiting_external');assert.equal(parallelInput.chat_message_id,latestParallelAdmin.id,'Concurrent sends cannot leave the current job on an older chat anchor');assert.equal(job(parallelJob.id).status,'cancelled');

 // Hard storage and message quotas reject writes without abandoned R2 objects.
 const quotaReport=seed(),fakeFiles=[];
 for(let i=0;i<80;i++){const id=crypto.randomUUID();fakeFiles.push(id);db.prepare('INSERT INTO work_files (id,report_id,actor,name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)').run(id,quotaReport.id,'채팅 승인자','한도 검증 '+i+'.txt','text/plain',1,new Date().toISOString());}
 const beforeQuota=files.size;
 response=await upload(quotaReport.id,jarA,'81번째.txt','text/plain',utf8.encode('한도 초과'));assert.equal(response.status,429);assert.equal(files.size,beforeQuota);assert.equal(db.prepare('SELECT count(*) AS n FROM work_files WHERE report_id=?').get(quotaReport.id).n,80);
 for(const id of fakeFiles)db.prepare('DELETE FROM work_files WHERE id=?').run(id);
 const storageSentinel=crypto.randomUUID();db.prepare('INSERT INTO work_files (id,report_id,actor,name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)').run(storageSentinel,quotaReport.id,'채팅 승인자','저장 한도 검증.txt','text/plain',10_000_000,new Date().toISOString());
 env.REPORT_STORAGE_MB=10;
 response=await upload(quotaReport.id,jarA,'저장 공간 초과.txt','text/plain',utf8.encode('한도 초과'));assert.equal(response.status,429);assert.equal(files.size,beforeQuota);assert.equal(db.prepare('SELECT count(*) AS n FROM work_files WHERE report_id=?').get(quotaReport.id).n,1);
 delete env.REPORT_STORAGE_MB;db.prepare('DELETE FROM work_files WHERE id=?').run(storageSentinel);
 const messageQuota=db.prepare('SELECT count(*) AS n FROM work_messages WHERE actor=? AND created_at>?').get('채팅 승인자',new Date(Date.now()-864e5).toISOString()).n;
 for(let i=messageQuota;i<240;i++)db.prepare('INSERT INTO work_messages (id,report_id,actor,role,text,attachment_ids,created_at) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(),quotaReport.id,'채팅 승인자','system','일일 한도 검증 자료','[]',new Date().toISOString());
 const beforeLimitedMessages=db.prepare('SELECT count(*) AS n FROM work_messages').get().n,beforeLimitedJobs=db.prepare('SELECT count(*) AS n FROM report_jobs').get().n;
 response=await call(chatPath(own.id),{method:'POST',jar:jarA,body:{request_id:crypto.randomUUID(),text:'일일 메시지 한도 초과',attachment_ids:[]}});assert.equal(response.status,429);assert.equal(db.prepare('SELECT count(*) AS n FROM work_messages').get().n,beforeLimitedMessages);assert.equal(db.prepare('SELECT count(*) AS n FROM report_jobs').get().n,beforeLimitedJobs);
 await sendAdmin(own.id,jarA,adminText,[note.id,picture.id],sent.request_id);assert.equal(db.prepare('SELECT count(*) AS n FROM work_messages').get().n,beforeLimitedMessages,'An exact retry is still safe at the daily limit');

 // Immediate revocation/expiration applies to every new conversation and file read/write.
 assert.equal((await call('/api/console/dots-link/revoke',{method:'POST',jar:jarA,body:{confirm:true}})).status,200);
 for(const [name,args] of [['toolkit_read_conversation',{job_id:revised.job.id}],['toolkit_read_file',{job_id:revised.job.id,file_id:note.id}],['toolkit_send_message',{job_id:revised.job.id,text:'해제 후 송신',request_id:crypto.randomUUID(),after_message_id:findMessage(revised,'정면 간판 색상을 다시 확인해 주세요.').id}]])denied(await tool(name,args));
 assert.equal((await readChat(own.id,jarA)).connection.connected,false);
 clock=Date.parse(linkA.expires_at)+8*864e5;denied(await tool('toolkit_read_conversation',{job_id:foreignJob.id},principalB));
 assert.deepEqual(layer(),{});assert.equal(networkAttempts,0,'Conversation work must not call external delivery or a model provider');
 const discover=await rpc('server/discover');assert(!discover.payload.result.capabilities.events,'Chat must not advertise an unsafe automatic wakeup transport');
 console.log('PASS: private per-actor chat; bounded validated attachments and scoped MCP reads; idempotent and concurrent child jobs; draft supersession and in-flight rejection; needs-info continuation; hard quotas; revocation/expiration; no public map writes or automatic wakeup');
}finally{
 globalThis.Date=nativeDate;globalThis.fetch=nativeFetch;db.close();
}
