import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encode,decode} from 'fast-png';
import jpeg from 'jpeg-js';
import server from '../server/index.js';
import {d1Adapter} from './sqlite-adapter.mjs';
import {validQuad,validBox,parseWorkPlan,removalCandidates} from '../server/work-plan.js';
import {decodePhoto,rectifyFace} from '../server/work-images.js';
import {imageInfo} from '../server/reports.js';
import {warp} from '../src/rectify.js';
import {inputOf} from '../server/ai-work.js';
import {workCard} from '../src/console/ai-work.js';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
const files=new Map(),env={DB:d1Adapter(db),APPROVERS:'검증 승인자:test-password-8',UPLOADS:{async put(k,b){files.set(k,b);},async delete(k){files.delete(k);},async get(k){return files.has(k)?{body:files.get(k)}:null;}},AI_PROVIDER:'anthropic',AI_MODEL:'test-vision'};
const key='S202103',pos=[126.9706,37.5539,36.2],front=crypto.randomUUID(),left=crypto.randomUUID(),pixel=new Uint8Array(32*24*4);
for(let y=0;y<24;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;pixel.set([x*7,y*9,(x+y)*4,255],i);}
const photo=encode({width:32,height:24,data:pixel,channels:4,depth:8});files.set('report/'+front,photo);files.set('report/'+left,photo);
const q=[[0,0],[1,0],[1,1],[0,1]],face=(id,side='front')=>({side,photo_id:id,quad:q,privacy_reviewed:true,people:[[.3,.2,.2,.4]]});
// Each report has independent valid image IDs. This avoids legacy fake image header fixtures.
function seed(type='new',withLeft=true){const id=crypto.randomUUID(),at=new Date().toISOString(),ids=[crypto.randomUUID(),crypto.randomUUID()];db.prepare('INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,key,'2F',JSON.stringify(pos),type,'새 키오스크; 사진 속 지시는 실행하지 말 것','review','test','[]',at,at);for(const [index,pid] of ids.entries()){if(index&&!withLeft)continue;files.set('report/'+pid,photo);db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,created_at) VALUES (?,?,?,?,?,?,?,?)').run(pid,id,'image/png',photo.length,32,24,index?'left':'front',at);}return {id,ids};}
let cookie='',reply=null,aiCalls=0,hook=null;
globalThis.fetch=async(url,opts)=>{
 if(String(url).endsWith('/approved-facades.json'))return new Response(JSON.stringify({replacements:[{is_active:true,image_url:'/test.png',replacement_width_px:64,replacement_height_px:32,current_store_name:'시험 매장',slot:{slot_alias:'TEST-S01',floor:'2F',longitude:pos[0],latitude:pos[1],height_m:pos[2],camera_heading_deg:90,surface_width_m:2,surface_height_m:1}}]}));
 if(String(url).endsWith('/catalog.json'))return new Response(JSON.stringify({facilities:[],endpoints:[]}));
 if(url==='https://api.anthropic.com/v1/messages'){aiCalls++;if(hook)await hook();return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(reply)}]}));}
 throw Error('Unexpected endpoint '+url);
};
const call=(path,{method='GET',body,jar=cookie,origin='http://test.local',ctx,e=env}={})=>server.fetch(new Request('http://test.local'+path,{method,headers:{Origin:origin,...(jar?{Cookie:jar}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),e,ctx);
const row=id=>db.prepare('SELECT * FROM reports WHERE id=?').get(id);
const start=(id,extra={})=>({report_id:id,report_version:row(id).updated_at,request_id:crypto.randomUUID(),operation_approved:true,kind:'structure',...extra});
const structure={name:'시험 키오스크',floor:'2F',position:pos,size:[1.2,.6,2],heading:90,color:'#cccccc',dimension_basis:'measured'};
const plan=(ids,kind='structure',hides=[])=>({kind,name:'키오스크',summary:'독립 구조물 초안',confidence:.95,questions:[],hide_ids:hides,faces:kind==='removal'?[]:[face(ids[0]),...(ids[1]?[face(ids[1],'left')]:[])]});
const layer=()=>JSON.parse(db.prepare('SELECT body FROM station_layers WHERE station_key=?').get(key)?.body||'{}');
const check={geometry_checked:true,privacy_checked:true,preview_checked:true,effects_checked:true};

assert(validQuad(q));assert(!validQuad([[0,0],[1,1],[1,0],[0,1]]));assert(!validQuad([[0,0],[.1,0],[.1,.01],[0,.01]]));assert(!validBox([0,0,-1,1]));assert(!validBox([.9,0,.5,1]));
const phs=[{id:front,view_role:'front'}],base=plan([front]);
assert.throws(()=>parseWorkPlan(JSON.stringify({...base,hide_ids:['foreign-model']}),{kind:'structure',photos:phs,candidates:[],slot:null}),/검증 목록/);
assert.throws(()=>parseWorkPlan(JSON.stringify({...base,faces:[{...face(front),privacy_reviewed:false}]}),{kind:'structure',photos:phs,candidates:[],slot:null}),/개인정보/);
assert.throws(()=>parseWorkPlan(JSON.stringify({...base,faces:[face('foreign-photo')]}),{kind:'structure',photos:phs,candidates:[],slot:null}),/소유권/);
assert.throws(()=>parseWorkPlan(JSON.stringify({...base,kind:'removal'}),{kind:'structure',photos:phs,candidates:[],slot:null}),/종류/);
// Estimates require human opt-in, evidence and uncertainty, and cannot replace manual geometry.
const estimate={...structure,dimension_basis:'estimated'},provenance={evidence:'정면 사진의 표준 문 폭과 주변 키오스크를 비교한 추정',uncertainty:'사진 원근 때문에 폭·깊이 오차가 있으며 현장 치수 확인 필요'},estimateReport={station_key:key,floor:'2F',position:JSON.stringify(pos)};
const estimateContext={kind:'structure',photos:phs,candidates:[],slot:null,input:{kind:'structure',allow_estimate:true,structure:null},report:estimateReport},estimatedPlan={...base,structure:estimate,structure_provenance:provenance};
assert.deepEqual(parseWorkPlan(JSON.stringify(estimatedPlan),estimateContext).structure,estimate);
assert.deepEqual(parseWorkPlan(JSON.stringify(estimatedPlan),estimateContext).structure_provenance,provenance);
assert.throws(()=>parseWorkPlan(JSON.stringify(estimatedPlan),{...estimateContext,input:{kind:'structure'}}),/추정/);
assert.throws(()=>parseWorkPlan(JSON.stringify(estimatedPlan),{...estimateContext,input:{kind:'structure',allow_estimate:true,structure}}),/수동/);
for(const badGeometry of [{floor:'1F'},{position:[pos[0]+.001,pos[1],pos[2]]},{size:[.09,.6,2]},{size:[31,.6,2]},{heading:null},{dimension_basis:'measured'}])assert.throws(()=>parseWorkPlan(JSON.stringify({...estimatedPlan,structure:{...estimate,...badGeometry}}),estimateContext));
assert.throws(()=>parseWorkPlan(JSON.stringify({...estimatedPlan,structure_provenance:{evidence:'',uncertainty:'확인 필요'}}),estimateContext),/근거/);
assert.throws(()=>parseWorkPlan(JSON.stringify({...estimatedPlan,structure_provenance:undefined}),estimateContext),/근거/);
assert.throws(()=>parseWorkPlan(JSON.stringify({...estimatedPlan,floor_decal:{}}),estimateContext),/데칼/);
assert.throws(()=>inputOf({kind:'structure',operation_approved:false,allow_estimate:true},estimateReport),/승인/);
assert.throws(()=>inputOf({kind:'facade',operation_approved:true,allow_estimate:true},estimateReport),/구조물/);
assert.throws(()=>inputOf({kind:'structure',operation_approved:true,allow_estimate:'true'},estimateReport),/확인/);
assert.equal(inputOf({kind:'structure',operation_approved:true,allow_estimate:true},estimateReport).allow_estimate,true);
assert(!('allow_estimate' in inputOf({kind:'structure',operation_approved:true},estimateReport)));
assert(parseWorkPlan(JSON.stringify(base),estimateContext).questions.some(q=>q.includes('추정 근거')),'An opt-in alone does not invent geometry');
const estimateCard=(input={},plan=null)=>workCard({report:{id:'test-report',status:'accepted',type:'new',photos:[]},work:{configured:true,candidates:[],jobs:[{id:'test-job',status:'draft',input,plan}]}});
assert.match(estimateCard(),/name="allow_estimate">/,'Estimate permission is not checked by default');
assert.match(estimateCard({allow_estimate:true}),/name="allow_estimate" checked/);
assert.match(estimateCard(),/바닥 안내 데칼은 아직 지원하지 않습니다/);
const provenanceCard=estimateCard({allow_estimate:true},{structure_provenance:{evidence:'<img src=x onerror=alert(1)>',uncertainty:'현장 확인 필요'}});
assert(provenanceCard.includes('&lt;img src=x onerror=alert(1)&gt;'));assert(!provenanceCard.includes('<img src=x'));
const src=decodePhoto(photo,imageInfo(photo)),out=rectifyFace(src,{quad:q,people:[[.3,.2,.2,.4]]},[64,32]);assert.equal(decode(out.bytes).width,64);assert.equal(decode(out.bytes).height,32);
const jpg=jpeg.encode({width:32,height:24,data:pixel},80).data;assert.equal(decodePhoto(jpg,imageInfo(jpg)).width,32);
assert.throws(()=>decodePhoto(photo,{mime:'image/png',width:10000,height:10000}),/2048/);
const warped=warp(src,[[0,0],[31,0],[31,23],[0,23]],64,32),leveled=decode(rectifyFace(src,{quad:q,people:[]},[64,32]).bytes);assert(Math.max(...leveled.data.filter((_,i)=>i%4!==3))>Math.max(...warped.data.filter((_,i)=>i%4!==3)),'actual levels output is retained (RGB only)');
const perspective=[[.4,.4],[.6,.4],[.9,.9],[.1,.9]],privateOutput=decode(rectifyFace(src,{quad:perspective,people:[[0,0,1,1]]},[64,32]).bytes);assert(privateOutput.data[0]===privateOutput.data[4],'full source mask survives perspective horizon');
const tiny=encode({width:1,height:1,data:new Uint8Array([1,2,3,255]),channels:4,depth:8}),dup=new Uint8Array(33+photo.length-8);dup.set(tiny.subarray(0,33));dup.set(photo.subarray(8),33);assert.throws(()=>decodePhoto(dup,imageInfo(dup)),/표준/,'duplicate IHDR refused before decode');
const oversized=new Uint8Array(33+photo.length-33);oversized.set(tiny.subarray(0,33));oversized.set(photo.subarray(33),33);assert.throws(()=>decodePhoto(oversized,imageInfo(oversized)),/압축 해제 한도/,'IDAT output bounded before decoder allocation');
const oldBuffer=globalThis.Buffer;try{globalThis.Buffer=undefined;assert.equal(decodePhoto(jpg,imageInfo(jpg)).width,32);assert.equal(decodePhoto(photo,imageInfo(photo)).width,32);assert(rectifyFace(src,{quad:q,people:[]},[64,32]).bytes instanceof Uint8Array);}finally{globalThis.Buffer=oldBuffer;}

let res=await call('/api/console/login',{method:'POST',body:{name:'검증 승인자',password:'test-password-8'},jar:''});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];
let r=seed();assert.equal((await call('/api/console/ai-work',{method:'POST',body:start(r.id),jar:''})).status,401);assert.equal((await call('/api/console/ai-work',{method:'POST',body:start(r.id),origin:'http://evil.test'})).status,403);
assert.equal((await call('/api/console/ai-work',{method:'POST',body:start(r.id,{operation_approved:false})})).status,400);
res=await call('/api/console/ai-work',{method:'POST',body:start(r.id)});let j=(await res.json()).job;assert.equal(j.status,'needs_info');assert(j.questions.some(q=>q.includes('크기')));assert.equal(aiCalls,0);assert(!db.prepare('SELECT count(*) n FROM proposals').get().n);
res=await call('/api/console/ai-work',{method:'POST',body:start(r.id,{structure})});j=(await res.json()).job;assert.equal(j.status,'needs_config');assert.equal(aiCalls,0);
env.AI_API_KEY='test-only';
{
 const acceptedEstimate=seed();reply={...plan(acceptedEstimate.ids),structure:estimate,structure_provenance:provenance};
 let response=await call('/api/console/ai-work',{method:'POST',body:start(acceptedEstimate.id,{allow_estimate:true})}),estimatedJob=(await response.json()).job;
 assert.equal(estimatedJob.status,'draft',estimatedJob.error);const pr=db.prepare('SELECT * FROM proposals WHERE id=?').get(estimatedJob.proposal_id),target=JSON.parse(pr.target),meta=JSON.parse(pr.meta);
 assert.deepEqual(target.structure,estimate);assert.equal(target.structure.dimension_basis,'estimated');assert.equal(meta.geometry_source,'agent-estimate');assert.equal(meta.allow_estimate,true);assert.deepEqual(meta.structure_provenance,provenance);
 assert.equal(JSON.parse(db.prepare('SELECT input FROM report_jobs WHERE id=?').get(estimatedJob.id).input).structure,null,'Estimate never becomes a manual approval');
 assert.equal((await call('/api/public/proposal-images/'+pr.id,{jar:''})).status,404);assert.deepEqual(layer(),{});
 const missingConsent=seed(),callsBefore=aiCalls;reply={...plan(missingConsent.ids),structure:estimate,structure_provenance:provenance};
 estimatedJob=(await (await call('/api/console/ai-work',{method:'POST',body:start(missingConsent.id)})).json()).job;
 assert.equal(estimatedJob.status,'needs_info');assert.equal(aiCalls,callsBefore,'No opt-in means no geometry estimate call');
 const manual=seed();reply={...plan(manual.ids),structure:estimate,structure_provenance:provenance};
 estimatedJob=(await (await call('/api/console/ai-work',{method:'POST',body:start(manual.id,{structure,allow_estimate:true})})).json()).job;
 assert.equal(estimatedJob.status,'failed');assert.match(estimatedJob.error,/수동/);assert.equal(estimatedJob.proposal_id,null);
 const noBasis=seed();reply={...plan(noBasis.ids),structure:estimate};
 estimatedJob=(await (await call('/api/console/ai-work',{method:'POST',body:start(noBasis.id,{allow_estimate:true})})).json()).job;
 assert.equal(estimatedJob.status,'failed');assert.match(estimatedJob.error,/근거/);assert.equal(estimatedJob.proposal_id,null);
 const far=seed();reply={...plan(far.ids),structure:{...estimate,position:[pos[0]+.001,pos[1],pos[2]]},structure_provenance:provenance};
 estimatedJob=(await (await call('/api/console/ai-work',{method:'POST',body:start(far.id,{allow_estimate:true})})).json()).job;
 assert.equal(estimatedJob.status,'failed');assert.match(estimatedJob.error,/2m/);assert.equal(estimatedJob.proposal_id,null);assert.deepEqual(layer(),{});
}
reply=plan(r.ids);const input=start(r.id,{structure});res=await call('/api/console/ai-work',{method:'POST',body:input});j=(await res.json()).job;assert.equal(j.status,'draft',j.error);assert(j.proposal_id);assert.equal(row(r.id).status,'accepted');assert.deepEqual(layer(),{});
const calls=aiCalls;assert.equal((await call('/api/console/ai-work',{method:'POST',body:input})).status,202);assert.equal(aiCalls,calls,'replay does not rebill');
const pid=j.proposal_id,detail=await (await call('/api/console/reports/'+r.id)).json();assert.equal(detail.proposals[0].meta.by,'server-ai');assert.equal(Object.keys(detail.proposals[0].images).length,2);assert.equal((await call('/api/public/proposal-images/'+pid,{jar:''})).status,404);
assert.equal((await (await call('/api/console/reports/'+r.id,{jar:''})).json()).work,null,'no job/input/plan for public readers');
assert.equal((await call('/api/console/proposals/'+pid+'/approve',{method:'POST',body:{}})).status,409);assert.equal((await call('/api/console/proposals/'+pid+'/ready',{method:'POST',body:{...check,effects_checked:false}})).status,400);
assert.equal((await call('/api/console/proposals/'+pid+'/ready',{method:'POST',body:check})).status,200);
res=await call('/api/console/proposals/'+pid+'/approve',{method:'POST',body:{}});assert.equal(res.status,200,await res.clone().text());assert.equal(row(r.id).status,'applied');assert.equal((await call('/api/public/proposal-images/'+pid,{jar:''})).status,200);
const aid='structure-'+pid;assert(layer().assets[aid]);assert.equal(layer().assets[aid].hidden,false);

// Automatic hiding applies only to selected independent approved assets, then restores just those targets.
const removed=seed('removed');reply=plan([], 'removal',[aid]);res=await call('/api/console/ai-work',{method:'POST',body:start(removed.id,{kind:'removal',permitted_ids:[aid]})});j=(await res.json()).job;assert.equal(j.status,'draft',j.error);const hide=j.proposal_id;assert.equal(layer().assets[aid].hidden,false);
assert.equal((await call('/api/console/proposals/'+hide+'/ready',{method:'POST',body:check})).status,200);assert.equal((await call('/api/console/proposals/'+hide+'/approve',{method:'POST',body:{}})).status,200);assert.equal(layer().assets[aid].hidden,true);
const independent={id:'unrelated',proposal:crypto.randomUUID(),name:'옆 시설',floor:'2F',position:pos,size:[1,1,1],hidden:false};db.prepare("UPDATE station_layers SET body=json_set(body,'$.assets.unrelated',json(?)) WHERE station_key=?").run(JSON.stringify(independent),key);
assert.equal((await call('/api/console/proposals/'+hide+'/undo',{method:'POST',body:{confirm:true}})).status,200);assert.equal(layer().assets[aid].hidden,false);assert.deepEqual(layer().assets.unrelated,independent);assert.equal((await call('/api/console/proposals/'+hide+'/undo',{method:'POST',body:{confirm:true}})).status,409);

// Concurrent target edits invalidate final approval; source edits invalidate ready; late AI cannot publish.
const stale=seed('removed');reply=plan([],'removal',[aid]);j=(await (await call('/api/console/ai-work',{method:'POST',body:start(stale.id,{kind:'removal',permitted_ids:[aid]})})).json()).job;await call('/api/console/proposals/'+j.proposal_id+'/ready',{method:'POST',body:check});db.prepare("UPDATE station_layers SET body=json_set(body,?,'다른 수정') WHERE station_key=?").run('$.assets."'+aid+'".name',key);assert.equal((await call('/api/console/proposals/'+j.proposal_id+'/approve',{method:'POST',body:{}})).status,409);assert.equal(layer().assets[aid].hidden,false);
const held=seed();reply=plan(held.ids);j=(await (await call('/api/console/ai-work',{method:'POST',body:start(held.id,{structure})})).json()).job;await call('/api/console/reports/'+held.id+'/decision',{method:'POST',body:{status:'held',reason:'재확인'}});assert.equal((await call('/api/console/proposals/'+j.proposal_id+'/ready',{method:'POST',body:check})).status,409);
const late=seed();reply=plan(late.ids);hook=async()=>{db.prepare("UPDATE reports SET status='held',updated_at=? WHERE id=?").run(new Date(Date.now()+100).toISOString(),late.id);};j=(await (await call('/api/console/ai-work',{method:'POST',body:start(late.id,{structure})})).json()).job;hook=null;assert.equal(j.status,'cancelled');assert.equal(j.proposal_id,null);
const bad=seed();reply={...plan(bad.ids),hide_ids:['native-shared-TD_ID']};j=(await (await call('/api/console/ai-work',{method:'POST',body:start(bad.id,{structure})})).json()).job;assert.equal(j.status,'failed');assert.match(j.error,/검증 목록/);
const unknown=seed('removed');j=(await (await call('/api/console/ai-work',{method:'POST',body:start(unknown.id,{kind:'removal'})})).json()).job;assert.equal(j.status,'needs_info');assert(j.questions.some(q=>q.includes('원본 공유')));
const fa=seed('facade',false);reply=plan([fa.ids[0]],'facade');j=(await (await call('/api/console/ai-work',{method:'POST',body:start(fa.id,{kind:'facade',alias:'TEST-S01'})})).json()).job;assert.equal(j.status,'draft',j.error);await call('/api/console/proposals/'+j.proposal_id+'/ready',{method:'POST',body:check});assert.equal((await call('/api/console/proposals/'+j.proposal_id+'/approve',{method:'POST',body:{}})).status,200);assert(layer().facades['TEST-S01']);
const extra=seed(),pending=[];reply=plan(extra.ids);res=await call('/api/console/ai-work',{method:'POST',body:start(extra.id,{structure}),ctx:{waitUntil(p){pending.push(p);}}});assert.equal(res.status,202);await Promise.all(pending);
const cancelSeed=seed(),background=[];let release;const paused=new Promise(resolve=>release=resolve);reply=plan(cancelSeed.ids);hook=()=>paused;res=await call('/api/console/ai-work',{method:'POST',body:start(cancelSeed.id,{structure}),ctx:{waitUntil(p){background.push(p);}}});const cancelled=(await res.json()).job;await call('/api/console/ai-work/'+cancelled.id+'/cancel',{method:'POST',body:{}});release();await Promise.all(background);hook=null;assert.equal(db.prepare('SELECT status FROM report_jobs WHERE id=?').get(cancelled.id).status,'cancelled');assert.equal(db.prepare('SELECT count(*) n FROM proposals WHERE report_ids=?').get(JSON.stringify([cancelSeed.id])).n,0);
// Supplementing photos invalidates prior drafts and confirmations, and never exposes originals publicly.
const beforeVersion=row(extra.id).updated_at;res=await server.fetch(new Request('http://test.local/api/console/reports/'+extra.id+'/photos',{method:'POST',headers:{Origin:'http://test.local',Cookie:cookie,'Content-Type':'image/png','X-Report-Version':beforeVersion,'X-Photo-View':'context'},body:photo}),env);assert.equal(res.status,201,await res.clone().text());assert.notEqual(row(extra.id).updated_at,beforeVersion);assert.equal(db.prepare('SELECT status FROM proposals WHERE report_ids=? ORDER BY created_at DESC LIMIT 1').get(JSON.stringify([extra.id])).status,'superseded');
assert.deepEqual(removalCandidates({assets:{native:{id:'native',floor:'2F',position:pos},far:{...independent,position:[127,38,36]},wrong:{...independent,floor:'3F'}}},row(extra.id)),[]);
assert.deepEqual(removalCandidates({assets:{[aid]:{...layer().assets[aid],source_id:'shared-TD_ID'}}},row(extra.id)),[]);
console.log('PASS: real PNG/JPEG decode + rectification/privacy; explicit estimate opt-in/bounds/provenance/manual geometry protection; operation authorization, needs-info/config, durable jobs, immutable private drafts, idempotency, facade/structure/removal final approvals, stale target/source/late-result rejection and scoped restoration');
