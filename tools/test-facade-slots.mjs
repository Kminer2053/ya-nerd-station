import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encode,decode} from 'fast-png';
import server from '../server/index.js';
import {stations} from '../src/stations.js';
import {facadeSlotReview,planeFromFields} from '../src/console/facade-slot.js';
import {validateSlot} from '../server/facade-slots.js';
import {parseWorkPlan} from '../server/work-plan.js';
import {DAEJEON_CANDIDATES} from '../src/daejeon-candidates.js';
import {d1Adapter} from './sqlite-adapter.mjs';

// Real Worker/MCP routes and atomic D1 batches; synthetic photos, no model/network.
const db=new DatabaseSync(':memory:');
for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
const objects=new Map(),env={DB:d1Adapter(db),APPROVERS:'면 승인자:plane-password-8,다른 승인자:other-password-8',UPLOADS:{async put(k,b){objects.set(k,b);},async get(k){return objects.has(k)?{body:objects.get(k)}:null;},async delete(k){objects.delete(k);}}};
const station=stations.find(s=>!['S202103','S201801'].includes(s.id)),floor=station.default_floor,position=[station.centre[0],station.centre[1],station.heights[floor]],principal='synthetic-slot-principal';
const width=32,height=16,data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set([Math.floor(i/4)%255,100,180,255],i);
const photo=encode({width,height,data,channels:4,depth:8}),quad=[[0,0],[1,0],[1,1],[0,1]],checks={confirm:true,geometry_checked:true,privacy_checked:true,preview_checked:true,effects_checked:true};
const report=id=>db.prepare('SELECT * FROM reports WHERE id=?').get(id);
const job=id=>db.prepare('SELECT * FROM report_jobs WHERE id=?').get(id);
const layer=(key=station.id)=>JSON.parse(db.prepare('SELECT body FROM station_layers WHERE station_key=?').get(key)?.body||'{}');
let jarA,jarB,rpcId=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Network forbidden in facade plane tests');};
function call(path,{method='GET',body,jar=jarA,origin='http://plane.test',principal:who}={}){return server.fetch(new Request('http://plane.test'+path,{method,headers:{Origin:origin,...(jar?{Cookie:jar}:{}),...(who?{'oai-authenticated-user-id':who}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);}
const post=(path,body,options={})=>call(path,{method:'POST',body,...options});
async function ok(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function denied(response,status){assert.equal(response.status,status,await response.clone().text());}
async function login(name,password){const r=await post('/api/console/login',{name,password},{jar:''});await ok(r);return r.headers.get('set-cookie').split(';')[0];}
function seed(status='review',site={id:station.id,floor,position}){
 const id=crypto.randomUUID(),photo_id=crypto.randomUUID(),stamp=new Date().toISOString();
 db.prepare('INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,site.id,site.floor,JSON.stringify(site.position),'facade','공개 사진 시설 정면 검증',status,'fixture','[]',stamp,stamp);
 db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,created_at) VALUES (?,?,?,?,?,?,?,?)').run(photo_id,id,'image/png',photo.length,width,height,'front',stamp);objects.set('report/'+photo_id,photo);return {id,photo_id};
}
function registration(r,changes={}){
 return {request_id:crypto.randomUUID(),report_version:report(r.id).updated_at,slot:planeFromFields(floor,{name:'대합실 사진 시설 정면',longitude:position[0],latitude:position[1],bottom:position[2],width:4,height:2,heading:90,basis:'estimated',pixelWidth:'64',pixelHeight:'32'}),source_photo_ids:[r.photo_id],evidence:'사진의 출입문 폭과 지도에서 확인한 면 위치를 비교한 추정',uncertainty:'실측 전으로 폭과 방향에 오차가 있을 수 있음',geometry_checked:true,...changes};
}
const register=(r,v=registration(r),options={})=>post('/api/console/reports/'+r.id+'/facade-slot',v,options);
async function tool(name,args,who=principal){
 const response=await post('/mcp',{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}},{jar:'',principal:who}),v=await response.json();
 return {response,value:v,failed:!response.ok||Boolean(v.error)||!v.result||v.result.isError===true};
}
function result(r){assert.equal(r.failed,false,JSON.stringify(r.value));return r.value.result.structuredContent||JSON.parse(r.value.result.content.find(c=>c.type==='text').text);}
async function start(r){return ok(await post('/api/console/reports/'+r.id+'/chat',{request_id:crypto.randomUUID(),start:true,confirm:true,report_version:report(r.id).updated_at,text:'확인한 면에 사진을 보정해 주세요. 추정 규격을 유지하세요.',attachment_ids:[]}),201);}
const plan=(r,alias)=>({kind:'facade',facade_alias:alias,name:'사진 시설',summary:'검증된 면에 맞춘 사진 정면 보정 · 실측 전 추정',confidence:.95,questions:[],hide_ids:[],faces:[{side:'front',photo_id:r.photo_id,quad,privacy_reviewed:true,people:[]}]});
async function draft(r,alias){const c=await start(r),j=c.job;const reading=result(await tool('toolkit_read_work',{job_id:j.id}));assert(reading.facade_candidates.some(s=>s.alias===alias));const saved=result(await tool('toolkit_submit_plan',{job_id:j.id,plan:plan(r,alias)}));assert.equal(saved.status,'draft');return saved.proposal_id;}
async function published(key=station.id){return ok(await call('/api/public/station?key='+key,{jar:''}));}
try{
 jarA=await login('면 승인자','plane-password-8');jarB=await login('다른 승인자','other-password-8');
 const paired=await ok(await post('/api/console/dots-link',{confirm:true},{principal}),201);result(await tool('toolkit_connect_agent',{code:paired.code}));
 assert.deepEqual((await published()).slots,[]);
 const r=seed(),foreign=seed(),body=registration(r);
 for(const s of stations)for(const f of s.floors){const p=[s.centre[0],s.centre[1],s.heights[f]],testReport={type:'facade',station_key:s.id,floor:f,position:JSON.stringify(p)},testSlot={...body,slot:planeFromFields(f,{name:'합성 면 검증',longitude:p[0],latitude:p[1],bottom:p[2],width:4,height:2,heading:90,basis:'measured',pixelWidth:'64',pixelHeight:'32'})};assert.equal(validateSlot(testSlot,testReport).geometry.position[2],p[2]+1,s.id+' has a valid floor-relative photographic plane');}
 assert.equal(body.slot.position[2],position[2]+1,'A 2m plane rises 1m from the reported floor to its centre');
 await denied(await register(r,body,{jar:''}),401);
 await denied(await register(r,body,{origin:'http://evil.test'}),403);
 for(const patch of [
  {slot:{...body.slot,floor:'INVALID'}},
  {slot:{...body.slot,position:[position[0]+.01,position[1],position[2]+1]}},
  {slot:{...body.slot,position:[...position.slice(0,2),position[2]+30]}},
  {slot:{...body.slot,position:[...position.slice(0,2),position[2]-5.01]}},
  {slot:{...body.slot,heading:360}},
  {slot:{...body.slot,surface:[0,2]}},
  {slot:{...body.slot,px:[4096,4096]}},
  {slot:{...body.slot,px:[64,64]}},
  {slot:{...body.slot,dimension_basis:'exact-from-photo'}},
  {slot:{...body.slot,alias:'STATIC-SLOT'}},
  {evidence:''},{uncertainty:''},{geometry_checked:false},
  {source_photo_ids:[foreign.photo_id]},
 ])await denied(await register(r,{...body,...patch}),400);
 assert.equal(db.prepare('SELECT count(*) n FROM facade_slots').get().n,0);
 const saved=await ok(await register(r,body),201),alias=saved.slot.alias;
 assert.match(alias,/^REG-[a-f0-9-]{36}$/);assert.deepEqual(saved.slot.position,body.slot.position);
 assert.equal((await ok(await register(r,body))).slot.alias,alias,'Exact registration retry is idempotent');
 await denied(await register(r,{...body,evidence:'다른 근거'}),409);
 await denied(await register(r,body,{jar:jarB}),409);
 await denied(await register(r,{...body,request_id:crypto.randomUUID()}),409,'Old report versions cannot register another plane');
 assert.deepEqual((await published()).slots,[]);assert.deepEqual((await published()).overlays,[]);
 const own=await ok(await call('/api/console/station?key='+station.id+'&report_id='+r.id));assert(own.slots.some(s=>s.alias===alias&&s.registration));
 const other=await ok(await call('/api/console/station?key='+station.id+'&report_id='+r.id,{jar:jarB}));assert.equal(other.slots.length,0);
 await denied(await call('/api/console/station?key='+station.id+'&report_id='+r.id,{jar:''}),401);
 const anonymous=await ok(await call('/api/console/reports/'+r.id,{jar:''}));assert.equal(anonymous.facade_slots,null);assert(!JSON.stringify(anonymous).includes(alias));
 // Adopting a reviewed report retains this approver's confirmation, with a new version.
 await ok(await post('/api/console/reports/'+r.id+'/decision',{status:'accepted'}));
 assert.equal(db.prepare('SELECT report_version FROM facade_slots WHERE alias=?').get(alias).report_version,report(r.id).updated_at);
 const conversation=await start(r),j=job(conversation.job.id),work=result(await tool('toolkit_read_work',{job_id:j.id})),candidate=work.facade_candidates.find(s=>s.alias===alias);
 assert(candidate?.pending_registration);assert.equal(candidate.dimension_basis,'estimated');assert.equal(candidate.evidence,body.evidence);
 assert.equal(db.prepare('SELECT report_version FROM facade_slots WHERE alias=?').get(alias).report_version,j.report_version);
 assert.equal(result(await tool('toolkit_read_facade_reference',{job_id:j.id,alias})).available,false);
 assert((await tool('toolkit_submit_plan',{job_id:j.id,plan:plan(r,'REG-'+crypto.randomUUID())})).failed);
 result(await tool('toolkit_request_info',{job_id:j.id,questions:['공개할 사진 면이 맞나요?']}));
 const followup=await ok(await post('/api/console/reports/'+r.id+'/chat',{request_id:crypto.randomUUID(),text:'네. 등록한 면과 추정 규격을 유지해 주세요.',attachment_ids:[]}),201),child=followup.job;
 assert.notEqual(child.id,j.id);assert(JSON.parse(job(child.id).input).facade_aliases.includes(alias));
 const submitted=result(await tool('toolkit_submit_plan',{job_id:child.id,plan:plan(r,alias)})),pid=submitted.proposal_id;
 assert.equal(submitted.status,'draft');assert.equal((await published()).slots.length,0);assert.equal((await published()).overlays.length,0);
 const row=db.prepare('SELECT * FROM proposals WHERE id=?').get(pid),target=JSON.parse(row.target);assert.deepEqual(target.slot.position,body.slot.position);assert.equal(target.slot.dimension_basis,'estimated');
 const decoded=decode(objects.get('proposal/'+pid));assert.equal(decoded.width,64);assert.equal(decoded.height,32);
 const anonDraft=await ok(await call('/api/console/reports/'+r.id,{jar:''}));assert(!JSON.stringify(anonDraft).includes(alias));assert(!JSON.stringify(anonDraft).includes(body.evidence));
 const otherDraft=await ok(await call('/api/console/reports/'+r.id,{jar:jarB}));assert(!JSON.stringify(otherDraft.proposals).includes(body.evidence));assert(!JSON.stringify(otherDraft.proposals).includes(alias));
 assert(!JSON.stringify(otherDraft.work).includes(alias),'Other approvers cannot read a private plane through job history');
 assert(!JSON.stringify(await ok(await call('/api/console/proposals',{jar:jarB}))).includes(alias),'The console proposal index also protects private planes');
 await denied(await call('/api/console/ai-work/'+child.id,{jar:jarB}),404);
 await denied(await call('/api/console/proposal-images/'+pid,{jar:jarB}),404);
 await denied(await post('/api/console/proposals/'+pid+'/approve',checks,{jar:jarB}),403);
 await denied(await post('/api/console/proposals/'+pid+'/approve',{...checks,privacy_checked:false}),400);
 assert.equal(db.prepare('SELECT status FROM facade_slots WHERE alias=?').get(alias).status,'draft');
 // An unrelated approved asset and facade survive the one-key publication.
 const sentinel={assets:{preserve:{id:'preserve',name:'기존 승인 구조물',position,size:[1,1,1],floor}},facades:{'LEGACY-PLANE':{front:'/keep.png',slot:{name:'기존면',floor,position,heading:0,surface:[2,1],px:[64,32]}}}};
 db.prepare('INSERT INTO station_layers (station_key,revision,body,updated_at) VALUES (?,1,?,?)').run(station.id,JSON.stringify(sentinel),new Date().toISOString());
 db.exec("CREATE TRIGGER facade_slot_test_rollback BEFORE INSERT ON station_layers WHEN NEW.body LIKE '%"+alias+"%' BEGIN SELECT RAISE(ABORT,'synthetic atomic rollback'); END");
 await denied(await post('/api/console/proposals/'+pid+'/approve',checks),400);
 assert.equal(db.prepare('SELECT status FROM facade_slots WHERE alias=?').get(alias).status,'draft','Failed layer update rolls plane activation back');assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(pid).status,'draft');assert.deepEqual(layer(),sentinel);
 db.exec('DROP TRIGGER facade_slot_test_rollback');
 const approvals=await Promise.all([post('/api/console/proposals/'+pid+'/approve',checks),post('/api/console/proposals/'+pid+'/approve',checks)]);assert.deepEqual(approvals.map(r=>r.status).sort(),[200,409],'Concurrent approvals activate the plane exactly once');
 assert.equal(db.prepare('SELECT status FROM facade_slots WHERE alias=?').get(alias).status,'approved');
 assert.deepEqual(layer().assets,sentinel.assets);assert.deepEqual(layer().facades['LEGACY-PLANE'],sentinel.facades['LEGACY-PLANE']);
 const pub=await published(),publicPlane=pub.slots.find(s=>s.alias===alias),overlay=pub.overlays.find(s=>s.alias===alias);
 assert.deepEqual(publicPlane.surface,[4,2]);assert.deepEqual(publicPlane.px,[64,32]);assert.equal(publicPlane.dimension_basis,'estimated');assert.deepEqual(overlay.position,body.slot.position);
 assert.equal(overlay.position[2]-overlay.surface[1]/2,position[2],'Rendered lower edge remains on the reported floor');
 for(const secret of [body.evidence,body.uncertainty,r.photo_id,'registration','report_version','source_photo_ids','면 승인자'])assert(!JSON.stringify(pub).includes(secret));
 assert.equal((await call(overlay.image,{jar:''})).status,200);
 await denied(await post('/api/console/proposals/'+pid+'/approve',checks),409);
 await denied(await post('/api/console/import-facade',{station_key:station.id,slot:{...body.slot,alias}}),409);
 // Future reports can reuse the now-public immutable plane without another registration.
 const next=seed(),nextPid=await draft(next,alias);assert.equal(JSON.parse(db.prepare('SELECT target FROM proposals WHERE id=?').get(nextPid).target).before,overlay.image,'Follow-up comparison uses the currently approved image');await ok(await post('/api/console/proposals/'+nextPid+'/approve',checks));
 assert.equal((await published()).overlays.find(s=>s.alias===alias).image,'/api/public/proposal-images/'+nextPid);
 assert.deepEqual((await published()).slots.find(s=>s.alias===alias),publicPlane);assert.deepEqual(layer().assets,sentinel.assets);
 // Candidate/version changes cannot be approved, even if an old draft is retained.
 const stale=seed(),staleSlot=await ok(await register(stale),201),stalePid=await draft(stale,staleSlot.slot.alias);
 db.prepare("UPDATE facade_slots SET report_version='changed' WHERE alias=?").run(staleSlot.slot.alias);
 await denied(await post('/api/console/proposals/'+stalePid+'/approve',checks),409);assert(!(await published()).slots.some(s=>s.alias===staleSlot.slot.alias));
 const changed=seed(),changedSlot=await ok(await register(changed),201),changedPid=await draft(changed,changedSlot.slot.alias);
 db.prepare("UPDATE reports SET updated_at='changed' WHERE id=?").run(changed.id);
 await denied(await post('/api/console/proposals/'+changedPid+'/approve',checks),409);assert(!(await published()).slots.some(s=>s.alias===changedSlot.slot.alias));
 // The existing manual rectification path shares the same private registration and final claim.
 const manual=seed('accepted'),manualBody=registration(manual);manualBody.slot.dimension_basis='measured';manualBody.evidence='합성 fixture에서 확인한 4m × 2m 기준 치수';manualBody.uncertainty='합성 치수이며 현장 측정 사실을 주장하지 않음';const manualSlot=await ok(await register(manual,manualBody),201),manualImage=encode({width:64,height:32,data:new Uint8Array(64*32*4).fill(255),channels:4,depth:8});
 const manualDraft=await ok(await post('/api/console/proposals',{kind:'facade',report_id:manual.id,report_version:report(manual.id).updated_at,target:{alias:manualSlot.slot.alias},image:'data:image/png;base64,'+Buffer.from(manualImage).toString('base64'),meta:{photo:manual.photo_id,quad:[[0,0],[32,0],[32,16],[0,16]],people:true}}),201);
 assert.equal(manualDraft.status,'draft');assert(!(await published()).slots.some(s=>s.alias===manualSlot.slot.alias));
 await denied(await post('/api/console/proposals/'+manualDraft.id+'/approve',{confirm:true}),409);
 await ok(await post('/api/console/proposals/'+manualDraft.id+'/ready',checks));
 await denied(await post('/api/console/proposals/'+manualDraft.id+'/approve',{}),409);
 await ok(await post('/api/console/proposals/'+manualDraft.id+'/approve',{confirm:true}));
 assert.equal((await published()).slots.find(s=>s.alias===manualSlot.slot.alias).dimension_basis,'measured');

 // Reposition and expand the real Daejeon StoryWay anchor along its existing wall.
 // All photos, approvals and layer writes below are synthetic and in memory.
 const dj='S201801',story=DAEJEON_CANDIDATES.slots.find(s=>s.alias==='F03_WL05-S04'),petit=DAEJEON_CANDIDATES.slots.find(s=>s.alias==='F03_WL05-S06'),site={id:dj,floor:story.floor,position:story.position};
 const resize=seed('review',site),oldManual=seed('accepted',site),nSlots=db.prepare('SELECT count(*) n FROM facade_slots').get().n;
 const imageUrl=(w,h)=>'data:image/png;base64,'+Buffer.from(encode({width:w,height:h,data:new Uint8Array(w*h*4).fill(255),channels:4,depth:8})).toString('base64');
 const legacyProposal=await ok(await post('/api/console/proposals',{kind:'facade',report_id:oldManual.id,target:{alias:story.alias},image:imageUrl(...story.px),meta:{photo:oldManual.photo_id}}),201);
 const imported=await ok(await post('/api/console/import-facade',{station_key:dj,slot:{...petit,px:[64,64]},image:imageUrl(64,64)}),201);
 const before=layer(dj),initial=await published(dj),conversation2=await start(resize),job2=conversation2.job.id,work2=result(await tool('toolkit_read_work',{job_id:job2}));
 assert.equal(initial.slots.find(s=>s.alias===story.alias).position[0],story.position[0]);
 assert.equal(work2.facade_candidates.find(s=>s.alias===story.alias).can_reframe,true);
 assert(work2.plan_schema.properties.facade_reframe);
 const change={right_m:2.5,up_m:0,width_m:6,height_m:4.54,source_photo_ids:[resize.photo_id],evidence:'합성 사진에서 스토리웨이 오른쪽 벽면을 기준으로 검증',uncertainty:'세 패널 너비는 추정이며 벽의 깊이 차이는 현장 확인 필요'};
 const initialPlan={...plan(resize,story.alias),facade_reframe:change};
 for(const invalid of [
  {...change,right_m:-5,width_m:4}, // existing Petit Box
  {...change,right_m:10,width_m:6}, // centre fits, right corner outside the report
  {...change,source_photo_ids:[foreign.photo_id]},
  {...change,heading:90},
  {...change,evidence:''},
 ]){
  const rejected=await tool('toolkit_submit_plan',{job_id:job2,plan:{...initialPlan,facade_reframe:invalid}});
  assert(rejected.failed,JSON.stringify(rejected.value));assert.equal(job(job2).status,'awaiting_external');
 }
 assert.throws(()=>parseWorkPlan(JSON.stringify(initialPlan),{kind:'conversation',input:work2.input,slot:story,photos:work2.photos,candidates:[],report:{...report(resize.id),station_key:'S202103'}}),/서울역/);
 assert.throws(()=>parseWorkPlan(JSON.stringify(initialPlan),{kind:'conversation',input:work2.input,slot:{...story,registration:{id:'draft'}},photos:work2.photos,candidates:[],report:report(resize.id)}),/등록 대기/);
 const draft2=result(await tool('toolkit_submit_plan',{job_id:job2,plan:initialPlan}));
 assert.equal(draft2.status,'draft');assert.equal(result(await tool('toolkit_submit_plan',{job_id:job2,plan:initialPlan})).proposal_id,draft2.proposal_id);
 const firstId=draft2.proposal_id,own2=await ok(await call('/api/console/reports/'+resize.id)),review2=own2.proposals.find(p=>p.id===firstId),angle=story.heading*Math.PI/180;
 assert.deepEqual(review2.target.slot.surface,[6,4.54]);assert.deepEqual(review2.target.slot.px,[1024,775]);
 assert.equal(review2.target.slot.heading,story.heading);assert.equal(review2.target.slot.floor,'3F');
 const [lon,lat,alt]=review2.target.slot.position,east=(lon-story.position[0])*111320*Math.cos(story.position[1]*Math.PI/180),north=(lat-story.position[1])*111320;
 assert(Math.abs(-Math.cos(angle)*east+Math.sin(angle)*north-2.5)<1e-7);
 assert(Math.abs(Math.sin(angle)*east+Math.cos(angle)*north)<1e-7);assert.equal(alt,story.position[2]);
 assert.match(facadeSlotReview(review2),/오른쪽 2\.5m/);assert(facadeSlotReview(review2).includes(change.uncertainty));
 const rectified=decode(objects.get('proposal/'+firstId));assert.deepEqual([rectified.width,rectified.height],[1024,775]);
 assert.deepEqual(layer(dj),before);assert.deepEqual(await published(dj),initial);
 assert.equal(db.prepare('SELECT count(*) n FROM facade_slots').get().n,nSlots,'No manual plane registration is needed');
 for(const jar of ['',jarB]){const detail=await ok(await call('/api/console/reports/'+resize.id,{jar}));assert.equal(detail.proposals[0].image,null);assert(!JSON.stringify(detail.proposals).includes(change.evidence));}
 assert(!JSON.stringify(await ok(await call('/api/console/proposals',{jar:jarB}))).includes(change.evidence));
 await denied(await call('/api/console/proposal-images/'+firstId,{jar:jarB}),404);
 await denied(await call('/api/public/proposal-images/'+firstId,{jar:''}),404);
 await denied(await post('/api/console/proposals/'+firstId+'/approve',checks,{jar:jarB}),403);
 await denied(await post('/api/console/proposals/'+firstId+'/reject',{reason:'권한 검증'},{jar:jarB}),409);
 await denied(await post('/api/console/proposals/'+firstId+'/approve',{...checks,preview_checked:false}),400);
 const nextChat=await ok(await post('/api/console/reports/'+resize.id+'/chat',{request_id:crypto.randomUUID(),text:'배치와 규격은 두고 사진만 바꿔 주세요.',attachment_ids:[]}),201),child2=nextChat.job.id;
 const reread=result(await tool('toolkit_read_work',{job_id:child2}));
 assert.deepEqual(reread.input.revision_baseline.facade_reframe,review2.target.facade_reframe);
 assert.deepEqual(reread.input.revision_baseline.slot,review2.target.slot);
 await denied(await post('/api/console/proposals/'+firstId+'/approve',checks),409);
 const store=async(w,h)=>result(await tool('toolkit_store_draft_artifact',{job_id:child2,request_id:crypto.randomUUID(),source_photo_ids:[resize.photo_id],image:imageUrl(w,h),provenance:{method:'rectified',evidence:'합성 사진 경계 시험',uncertainty:'운영 이미지 아님',privacy_reviewed:true}}));
 const oldSize=await store(...story.px),withArtifact=id=>({...initialPlan,faces:[{side:'front',artifact_id:id}]});
 const mismatch=await tool('toolkit_submit_plan',{job_id:child2,plan:withArtifact(oldSize.artifact_id)});
 assert(mismatch.failed);assert.match(JSON.stringify(mismatch.value),/1024×775/);assert.equal(job(child2).status,'awaiting_external');
 const exact=await store(...review2.target.slot.px),replacement=result(await tool('toolkit_submit_plan',{job_id:child2,plan:withArtifact(exact.artifact_id)}));
 assert.equal(replacement.status,'draft');const id2=replacement.proposal_id;
 assert.deepEqual(JSON.parse(db.prepare('SELECT target FROM proposals WHERE id=?').get(id2).target).slot,review2.target.slot);

 // An approved neighbour appearing after draft creation prevents publication.
 const conflictingId=crypto.randomUUID(),conflictingAlias='REG-'+conflictingId;
 db.prepare("INSERT INTO facade_slots (id,alias,station_key,report_id,actor,report_version,status,geometry,source_photo_ids,evidence,uncertainty,created_at) VALUES (?,?,?,?,?,?,'approved',?,?,?,?,?)").run(conflictingId,conflictingAlias,dj,resize.id,'synthetic',report(resize.id).updated_at,JSON.stringify({...review2.target.slot,name:'다른 승인 면'}),'[]','synthetic','synthetic',new Date().toISOString());
 await denied(await post('/api/console/proposals/'+id2+'/approve',checks),409);assert.deepEqual(layer(dj),before);
 db.prepare('DELETE FROM facade_slots WHERE id=?').run(conflictingId);
 await ok(await post('/api/console/proposals/'+id2+'/approve',checks));
 const after=await published(dj),display=after.overlays.filter(s=>s.alias===story.alias);
 assert.equal(display.length,1);assert.deepEqual(display[0].position,review2.target.slot.position);assert.deepEqual(display[0].surface,[6,4.54]);assert.equal(display[0].heading,story.heading);
 assert.deepEqual(after.slots.find(s=>s.alias===story.alias).position,display[0].position);
 assert.deepEqual(layer(dj).facades[petit.alias],before.facades[petit.alias]);assert.equal(before.facades[petit.alias].proposal,imported.id);
 assert.deepEqual(DAEJEON_CANDIDATES.slots.find(s=>s.alias===story.alias).surface,[1.46,4.54],'Bundled map data stays unchanged');
 assert(!JSON.stringify(after).includes(change.evidence));assert(!JSON.stringify(await ok(await call('/api/console/reports/'+resize.id,{jar:''}))).includes(change.evidence));
 assert.equal((await call(display[0].image,{jar:''})).status,200);
 await denied(await post('/api/console/proposals/'+legacyProposal.id+'/approve',{}),409);
 await denied(await post('/api/console/import-facade',{station_key:dj,slot:story,image:imageUrl(...story.px)}),409);
 assert.deepEqual((await published(dj)).overlays.find(s=>s.alias===story.alias),display[0]);
 const reuse=seed('review',site),reuseId=await draft(reuse,story.alias),reuseTarget=JSON.parse(db.prepare('SELECT target FROM proposals WHERE id=?').get(reuseId).target);
 assert.equal(reuseTarget.before,display[0].image);assert.deepEqual(reuseTarget.slot.position,display[0].position);
 await ok(await post('/api/console/proposals/'+reuseId+'/approve',checks));
 assert.deepEqual((await published(dj)).slots.find(s=>s.alias===story.alias).position,display[0].position);
 assert.equal(network,0);
 console.log('PASS: private plane registration, owner/photo/version scope, same-wall Daejeon reframe, private preview and exact-pixel image, neighbour/approval guards, atomic publication, and immutable reuse');
}finally{globalThis.fetch=originalFetch;db.close();}
