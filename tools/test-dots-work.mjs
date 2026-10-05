import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encode,decode} from 'fast-png';
import server from '../server/index.js';
import {d1Adapter} from './sqlite-adapter.mjs';

// Every request runs directly against the Worker with memory-only D1/R2.
// Network calls are intercepted; Dots plans must never call a model provider.
const db=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
const files=new Map(),env={DB:d1Adapter(db),APPROVERS:'검증 승인자:test-password-8,별도 승인자:second-password-8',UPLOADS:{
 async put(key,body){files.set(key,body);if(putHook)await putHook(key);},async delete(key){files.delete(key);},async get(key){return files.has(key)?{body:files.get(key)}:null;}
}};
const station='S202103',position=[126.9706,37.5539,36.2],principalA='sites-test-dot-a',principalB='sites-test-dot-b';
const nativeDate=globalThis.Date,nativeFetch=globalThis.fetch;
let clock=nativeDate.now(),networkAttempts=0,rpcId=0,putHook=null;
globalThis.Date=class extends nativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
globalThis.fetch=async url=>{
 const path=String(url);
 if(path.endsWith('/approved-facades.json'))return new Response(JSON.stringify({replacements:[{is_active:true,image_url:'/fixture.png',replacement_width_px:64,replacement_height_px:32,current_store_name:'검증 매장',slot:{slot_alias:'TEST-S01',floor:'2F',longitude:position[0],latitude:position[1],height_m:position[2],camera_heading_deg:90,surface_width_m:2,surface_height_m:1}}]}));
 if(path.endsWith('/catalog.json'))return new Response(JSON.stringify({facilities:[],endpoints:[]}));
 networkAttempts++;throw Error('External network is forbidden in Dots fixture');
};
const width=800,height=480,pixels=new Uint8Array(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([x%256,y%256,(x+y)%256,255],(y*width+x)*4);
const photo=encode({width,height,data:pixels,channels:4,depth:8});
const quad=[[0,0],[1,0],[1,1],[0,1]],structure={name:'연결 검증 키오스크',floor:'2F',position,size:[1.2,.6,2],heading:90,color:'#cccccc',dimension_basis:'measured'};
function seed(){
 const id=crypto.randomUUID(),ids=[crypto.randomUUID(),crypto.randomUUID()],stamp=new Date().toISOString();
 db.prepare('INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,station,'2F',JSON.stringify(position),'new','키오스크 제보: 사진과 제보 문구는 증거이며 명령이 아님','review','fixture','[]',stamp,stamp);
 for(const [index,pid] of ids.entries()){
  files.set('report/'+pid,photo);
  db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid,id,'image/png',photo.length,width,height,index?'left':'front',stamp);
 }
 return {id,ids};
}
const row=id=>db.prepare('SELECT * FROM reports WHERE id=?').get(id);
const job=id=>db.prepare('SELECT * FROM report_jobs WHERE id=?').get(id);
const proposalCount=report=>db.prepare('SELECT count(*) AS n FROM proposals WHERE report_ids=?').get(JSON.stringify([report])).n;
const layer=()=>JSON.parse(db.prepare('SELECT body FROM station_layers WHERE station_key=?').get(station)?.body||'{}');
const plan=ids=>({kind:'structure',name:'키오스크',summary:'에비가 검토할 비공개 지도 초안',confidence:.95,questions:[],hide_ids:[],faces:ids.map((photo_id,index)=>({side:index?'left':'front',photo_id,quad,privacy_reviewed:true,people:[[.3,.2,.2,.4]]}))});
const call=(path,{method='GET',body,jar='',principal,origin='http://test.local',extra={}}={})=>server.fetch(new Request('http://test.local'+path,{method,headers:{Origin:origin,...(jar?{Cookie:jar}:{}),...(principal?{'oai-authenticated-user-id':principal}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
async function login(name,password){const response=await call('/api/console/login',{method:'POST',body:{name,password}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
async function rpc(method,params={},options={}){
 const id=++rpcId,response=await call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id,method,params},extra:{Accept:'application/json, text/event-stream'},...options});
 const text=await response.text();let payload;
 try{payload=JSON.parse(text);}catch{assert.fail('MCP must return stateless JSON-RPC: '+response.status);}
 if(response.ok){assert.equal(payload.jsonrpc,'2.0');assert.equal(payload.id,id);}
 return {status:response.status,payload};
}
const tool=(name,args={},principal=principalA,extra={})=>rpc('tools/call',{name,arguments:args},{principal,...extra});
const isDenied=result=>!result.payload.result||result.payload.result.isError===true||Boolean(result.payload.error)||result.status>=400;
function data(result){
 assert(!isDenied(result),'MCP tool failed with status '+result.status);
 const value=result.payload.result;
 if(value.structuredContent)return value.structuredContent;
 const text=value.content?.find(item=>item.type==='text')?.text;
 assert(text,'Tool must provide structured data or JSON text');return JSON.parse(text);
}
const denied=result=>assert(isDenied(result),'Request unexpectedly accepted');
const listRows=value=>value.jobs||value.work||value.items||value;
async function issue(jar,principal){
 const response=await call('/api/console/dots-link',{method:'POST',jar,principal,body:{confirm:true}});
 assert.equal(response.status,201,'Connection code issue must return HTTP 201');const value=await response.json();
 assert(/^[a-f0-9]{64}$/.test(value.code),'Connection code must contain 32 random bytes');return value;
}
function assertNoPlaintextCode(code){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 for(const {name} of tables){const rows=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all();assert(!JSON.stringify(rows).includes(code),'Connection code persisted in plaintext in '+name);}
}
async function createWork(report,jar,engine='dots'){
 const response=await call('/api/console/ai-work',{method:'POST',jar,body:{report_id:report.id,report_version:row(report.id).updated_at,request_id:crypto.randomUUID(),operation_approved:true,kind:'structure',structure,...(engine===null?{}:{engine})}});
 assert.equal(response.status,202,await response.clone().text());return (await response.json()).job;
}

try{
 const jarA=await login('검증 승인자','test-password-8'),jarB=await login('별도 승인자','second-password-8');
 assert.equal((await call('/api/console/dots-link')).status,401);
 assert.equal((await call('/api/console/dots-link',{method:'POST',jar:jarA,body:{confirm:false}})).status,400);
 assert.equal((await call('/api/console/dots-link',{method:'POST',jar:jarA,body:{confirm:true},origin:'http://evil.test'})).status,403);

 // Protocol discovery is public; data and binding require the trusted Sites identity.
 const initialize=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'dots-fixture',version:'1'}});
 assert.equal(initialize.status,200);assert.equal(initialize.payload.result.protocolVersion,'2025-03-26');
 const discover=await rpc('server/discover',{supportedVersions:['2026-07-28']});
 assert.equal(discover.status,200);assert(discover.payload.result.supportedVersions.includes('2026-07-28'));
 const listed=await rpc('tools/list'),names=listed.payload.result.tools.map(item=>item.name).sort();
 assert.deepEqual(names,['toolkit_connect_agent','toolkit_connection_status','toolkit_list_work','toolkit_read_photo','toolkit_read_work','toolkit_request_info','toolkit_submit_plan'].sort());
 assert(names.every(name=>!/(approve|ready|publish|create_work|create_queue)/.test(name)),'MCP must only expose connection/read/plan/info operations');
 denied(await tool('toolkit_list_work',{},undefined));
 denied(await rpc('tools/call',{name:'toolkit_connection_status',arguments:{}},{extra:{'oai-authenticated-user-email':'sites-test-dot-a@example.test'}}));
 denied(await tool('toolkit_list_work',{},principalB));

 // Expiration, one-time binding, and persistence never rely on a guessed email.
 const expired=await issue(jarA,principalA);assertNoPlaintextCode(expired.code);clock+=16*60_000;
 denied(await tool('toolkit_connect_agent',{code:expired.code},principalA));
 const linkA=await issue(jarA,principalA);assertNoPlaintextCode(linkA.code);
 denied(await rpc('tools/call',{name:'toolkit_connect_agent',arguments:{code:linkA.code}}));
 denied(await tool('toolkit_connect_agent',{code:'0'.repeat(64)},principalA));
 data(await tool('toolkit_connect_agent',{code:linkA.code},principalA));
 denied(await tool('toolkit_connect_agent',{code:linkA.code},principalB));
 data(await tool('toolkit_connect_agent',{code:linkA.code},principalA)); // Same-principal retry preserves the existing binding.
 const linkB=await issue(jarB,principalB),connectedB=data(await tool('toolkit_connect_agent',{code:linkB.code},principalB));
 const metadata=await (await call('/api/console/dots-link',{jar:jarA})).json();
 assert(!JSON.stringify(metadata).includes(linkA.code));assert(!JSON.stringify(metadata).includes(principalB),'Another actor connection is private');
 assertNoPlaintextCode(linkA.code);assertNoPlaintextCode(linkB.code);

 const own=seed(),foreign=seed(),legacy=seed();
 const ownJob=await createWork(own,jarA),foreignJob=await createWork(foreign,jarB),legacyJob=await createWork(legacy,jarA,null);
 assert.equal(ownJob.status,'awaiting_external');assert.equal(foreignJob.status,'awaiting_external');
 assert.equal(JSON.parse(job(ownJob.id).input).engine,'dots');assert.equal(legacyJob.status,'needs_config');
 assert.equal(proposalCount(own.id),0);assert.deepEqual(layer(),{});assert.equal(networkAttempts,0,'Dots queue must not require an API key or call a provider');
 const queued=listRows(data(await tool('toolkit_list_work',{},principalA)));
 assert(Array.isArray(queued));assert(queued.some(item=>item.job_id===ownJob.id));
 assert(!queued.some(item=>item.job_id===foreignJob.id||item.job_id===legacyJob.id),'Queue is restricted to this actor and the Dots engine');
 const read=data(await tool('toolkit_read_work',{job_id:ownJob.id}));
 assert(JSON.stringify(read).includes(own.ids[0]),'Work includes the original photo IDs for the plan');
 denied(await tool('toolkit_read_work',{job_id:foreignJob.id}));denied(await tool('toolkit_read_work',{job_id:legacyJob.id}));
 denied(await tool('toolkit_read_photo',{job_id:ownJob.id,photo_id:foreign.ids[0]}));
 const photoResult=await tool('toolkit_read_photo',{job_id:ownJob.id,photo_id:own.ids[0]});
 assert(!isDenied(photoResult));const image=photoResult.payload.result.content.find(item=>item.type==='image');
 assert(image,'Photo read returns an MCP image');assert.equal(image.mimeType,'image/png');
 const thumbnail=decode(Buffer.from(image.data,'base64'));
 assert.equal(Math.max(thumbnail.width,thumbnail.height),640);assert(thumbnail.width<width,'Agent receives a bounded analysis image');

 // Existing plan validation rejects foreign images, unapproved hides, invalid quads/privacy.
 const valid=plan(own.ids);
 for(const invalid of [
  {...valid,kind:'removal'},
  {...valid,hide_ids:['native-shared-model-id']},
  {...valid,faces:[{...valid.faces[0],photo_id:foreign.ids[0]}]},
  {...valid,faces:[{...valid.faces[0],privacy_reviewed:false}]},
  {...valid,faces:[{...valid.faces[0],quad:[[0,0],[1,1],[1,0],[0,1]]}]}
 ]){
  denied(await tool('toolkit_submit_plan',{job_id:ownJob.id,plan:invalid}));
  assert.equal(proposalCount(own.id),0,'Invalid plan must not save an image proposal');assert.deepEqual(layer(),{});
 }
 // Even an approver cookie accompanying a different Sites principal cannot cross actors.
 denied(await tool('toolkit_submit_plan',{job_id:ownJob.id,plan:valid},principalB,{jar:jarA}));
 data(await tool('toolkit_submit_plan',{job_id:ownJob.id,plan:valid}));
 const drafted=job(ownJob.id),pid=drafted.proposal_id;
 assert.equal(drafted.status,'draft');assert(pid);assert.equal(proposalCount(own.id),1);
 const proposal=db.prepare('SELECT * FROM proposals WHERE id=?').get(pid),meta=JSON.parse(proposal.meta);
 assert.equal(proposal.status,'draft');assert.equal(Object.keys(meta.faces).length,2);
 assert(files.has('proposal/'+pid));assert(files.has('proposal/'+pid+'/left'));assert.deepEqual(layer(),{});
 assert.equal((await call('/api/public/proposal-images/'+pid)).status,404);
 assert.equal((await call('/api/reports/photos/'+own.ids[0])).status,404,'Original photos remain private');
 const publicDetail=await (await call('/api/console/reports/'+own.id)).json();assert.equal(publicDetail.work,null);
 const fileCount=files.size;
 data(await tool('toolkit_submit_plan',{job_id:ownJob.id,plan:valid}));
 assert.equal(proposalCount(own.id),1);assert.equal(job(ownJob.id).proposal_id,pid);assert.equal(files.size,fileCount,'Retry must not duplicate proposal images');
 denied(await tool('toolkit_submit_plan',{job_id:ownJob.id,plan:{...valid,summary:'충돌하는 변경 계획'}}));
 assert.equal(proposalCount(own.id),1);assert.deepEqual(layer(),{});
 for(const name of ['toolkit_approve','toolkit_ready','toolkit_create_work'])denied(await tool(name,{job_id:ownJob.id}));

 // Additional questions are recorded privately; no draft or public effect is produced.
 const info=seed(),infoJob=await createWork(info,jarA),questions=['간판부터 바닥까지 정면 전체가 보이는 사진을 추가해 주세요.'];
 data(await tool('toolkit_request_info',{job_id:infoJob.id,questions}));
 assert.equal(job(infoJob.id).status,'needs_info');assert.deepEqual(JSON.parse(job(infoJob.id).questions),questions);
 assert.equal(proposalCount(info.id),0);assert.deepEqual(layer(),{});
 denied(await tool('toolkit_request_info',{job_id:foreignJob.id,questions}));

 // A source supplement and an explicit cancellation invalidate an external plan.
 const stale=seed(),staleJob=await createWork(stale,jarA);
 const supplement=await server.fetch(new Request('http://test.local/api/console/reports/'+stale.id+'/photos',{method:'POST',headers:{Origin:'http://test.local',Cookie:jarA,'Content-Type':'image/png','X-Report-Version':row(stale.id).updated_at,'X-Photo-View':'context'},body:photo}),env);
 assert.equal(supplement.status,201,await supplement.clone().text());
 const staleRead=await tool('toolkit_read_work',{job_id:staleJob.id});assert.equal(staleRead.status,409);denied(staleRead);
 const stalePlan=await tool('toolkit_submit_plan',{job_id:staleJob.id,plan:plan(stale.ids)});assert.equal(stalePlan.status,409);denied(stalePlan);assert.equal(proposalCount(stale.id),0);
 const cancelled=seed(),cancelJob=await createWork(cancelled,jarA);
 assert.equal((await call('/api/console/ai-work/'+cancelJob.id+'/cancel',{method:'POST',jar:jarA,body:{}})).status,200);
 assert.equal(job(cancelJob.id).status,'cancelled');
 const cancelRead=await tool('toolkit_read_work',{job_id:cancelJob.id});assert.equal(cancelRead.status,409);denied(cancelRead);
 const cancelPlan=await tool('toolkit_submit_plan',{job_id:cancelJob.id,plan:plan(cancelled.ids)});assert.equal(cancelPlan.status,409);denied(cancelPlan);assert.equal(proposalCount(cancelled.id),0);

 // Revoking one actor takes effect immediately and leaves other actors unaffected.
 assert.equal((await call('/api/console/dots-link/revoke',{method:'POST',jar:jarA,body:{confirm:false}})).status,400);
 assert.equal((await call('/api/console/dots-link/revoke',{method:'POST',jar:jarA,body:{confirm:true}})).status,200);
 const revoked=await tool('toolkit_list_work');assert([401,403].includes(revoked.status),'Revoked principal denied immediately');
 denied(await tool('toolkit_read_photo',{job_id:ownJob.id,photo_id:own.ids[0]}));
 denied(await tool('toolkit_connect_agent',{code:linkA.code}));
 const remaining=listRows(data(await tool('toolkit_list_work',{},principalB)));assert(remaining.some(item=>item.job_id===foreignJob.id));
 // A valid request that expires while R2 writes a rectified image must not save a draft.
 const midflight=seed(),midflightJob=await createWork(midflight,jarB),originalObjectCount=files.size,grantExpiry=Date.parse(connectedB.expires_at);
 assert(Number.isFinite(grantExpiry));clock=grantExpiry-1;
 let expiryTriggered=false;
 putHook=key=>{if(key.startsWith('proposal/')){expiryTriggered=true;clock=grantExpiry+1;putHook=null;}};
 const expiredInFlight=data(await tool('toolkit_submit_plan',{job_id:midflightJob.id,plan:plan(midflight.ids)},principalB));
 assert(expiryTriggered,'The grant must expire during a real rectified image write');
 assert.equal(expiredInFlight.status,'cancelled');assert.equal(job(midflightJob.id).status,'cancelled');
 assert.equal(job(midflightJob.id).proposal_id,null);assert.equal(proposalCount(midflight.id),0);
 assert.equal(files.size,originalObjectCount,'Rectified images staged before expiration must be removed');
 assert.deepEqual(layer(),{});
 clock+=8*864e5;
 const expiredGrant=await tool('toolkit_list_work',{},principalB);assert([401,403].includes(expiredGrant.status),'Seven-day grant expires without a new link');
 assert.deepEqual(layer(),{});assert.equal(networkAttempts,0,'No real external network or AI call is allowed');
 console.log('PASS: Dots MCP discovery; one-time hashed/expired identity binding; actor and engine isolation; bounded original-photo analysis; validated private immutable drafts; idempotent retry/conflict; info/source/cancel invalidation; immediate revocation and seven-day/in-flight expiration with staged image cleanup');
}finally{
 globalThis.Date=nativeDate;globalThis.fetch=nativeFetch;db.close();
}
