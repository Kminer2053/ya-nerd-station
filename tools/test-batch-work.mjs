import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {encode} from 'fast-png';
import {batchConsoleApi,runDueBatches} from '../server/batch-work.js';
import {d1Adapter} from './sqlite-adapter.mjs';
import server from '../server/index.js';
import {runnerAgentTool} from '../server/agent-runner.js';
import {chatDetail,chatConsoleApi} from '../server/work-chat.js';
import {structurePixels} from '../src/reports.js';
const RealDate=Date;let clock=Date.now();globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync('drizzle/'+f,'utf8'));
function fixture(){
 const sqlite=new DatabaseSync(':memory:');for(const sql of migrations)sqlite.exec(sql);const db=d1Adapter(sqlite),env={DB:db,APPROVERS:'batch-a:test-password-a,batch-b:test-password-b',UPLOADS:{}};
 const at=new Date().toISOString(),until=new Date(clock+864e5).toISOString();
 for(const actor of ['batch-a','batch-b'])sqlite.prepare('INSERT INTO agent_links (id,actor,code_hash,principal_id,label,created_at,code_expires_at,expires_at,redeemed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),actor,randomUUID(),'synthetic-'+actor,'test',at,until,until,at);
 const helpers={stationData:async()=>({slots:[]}),imageInfo:()=>{throw Error('unexpected image decoding');}};
 const report=({station='S202103',status='review',floor='2F',position=[126.9706,37.5539,36.2]}={})=>{const id=randomUUID();sqlite.prepare("INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,'synthetic evidence',?,'synthetic','[]',?,?)").run(id,station,floor,JSON.stringify(position),'other',status,at,at);return id;};
 const api=async(v,actor='batch-a')=>{const r=await batchConsoleApi(new Request('https://synthetic.test/api/console/batch-work',{method:v?'POST':'GET'}),env,{...helpers,me:{approver:actor},json:(data,status=200)=>Response.json(data,{status}),body:async()=>v});return {status:r.status,data:await r.json()};};
 const run=(report_ids,extra={})=>({action:'run',request_id:randomUUID(),report_ids,notes:'실제 사진을 먼저 확인',confirm:true,...extra});
 const drain=actor=>runDueBatches(env,actor||'batch-a',helpers);
 return {sqlite,env,db,report,api,run,drain};
}
const fixtures=[];const make=()=>{const f=fixture();fixtures.push(f);return f;};
try{
 const f=make(),ids=[f.report(),f.report()],stale=f.report(),busy=f.report(),otherBusy=f.report(),closed=f.report({status:'applied'}),noFloor=f.report({floor:null});
 const at=new Date().toISOString();for(const [report,actor,status] of [[busy,'batch-a','needs_info'],[otherBusy,'batch-b','draft']])f.sqlite.prepare("INSERT INTO report_jobs (id,report_id,station_key,kind,status,report_version,actor,input,created_at,updated_at) VALUES (?,?,'S202103','conversation',?,?,?, ?,?,?)").run(randomUUID(),report,status,at,actor,JSON.stringify({engine:'dots'}),at,at);
 const request=f.run([...ids,stale,busy,otherBusy,closed,noFloor]);assert.equal((await f.api(request)).status,202);assert.equal((await f.api({...request,report_ids:[...request.report_ids].reverse()})).status,202);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM batch_items').get().n,5);await assert.rejects(f.api({...request,report_ids:[ids[0]]}),/다른 일괄/);await assert.rejects(f.api(request,'batch-b'),/다른 일괄/);
 f.sqlite.prepare('UPDATE reports SET updated_at=? WHERE id=?').run(new Date(clock+1).toISOString(),stale);
 await Promise.all([f.drain(),f.drain()]);await f.drain();
 assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM batch_items WHERE status='queued'").get().n,2);assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM batch_items WHERE status='skipped'").get().n,3);
 assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM report_jobs WHERE actor='batch-a' AND status='awaiting_external'").get().n,2);assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM report_jobs WHERE actor='batch-b' AND status='draft'").get().n,1,'other operator work is preserved');
 assert.equal((await f.api(undefined,'batch-b')).data.runs.length,0);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM proposals').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM station_layers').get().n,0,'batch only starts private work');
 const cancel=f.run([f.report()]);await f.api(cancel);await f.api({action:'cancel',run_id:cancel.request_id,confirm:true},'batch-b');assert.equal(f.sqlite.prepare('SELECT status FROM batch_items WHERE run_id=?').get(cancel.request_id).status,'pending');await f.api({action:'cancel',run_id:cancel.request_id,confirm:true});await f.drain();assert.equal(f.sqlite.prepare('SELECT status FROM batch_items WHERE run_id=?').get(cancel.request_id).status,'cancelled');

 // 200-item selection advances without running/billing the first 200 jobs.
 const cap=make();for(let i=0;i<201;i++)cap.report();const capFirst=cap.run(undefined,{station_key:'S202103'}),capSecond=cap.run(undefined,{station_key:'S202103'});await cap.api(capFirst);await cap.api(capSecond);assert.equal(cap.sqlite.prepare('SELECT count(*) AS n FROM batch_items WHERE run_id=?').get(capFirst.request_id).n,200);assert.equal(cap.sqlite.prepare('SELECT count(*) AS n FROM batch_items WHERE run_id=?').get(capSecond.request_id).n,1);

 // Parent run plus children are one D1 transaction, including injected failure.
 const atomic=make(),atomicRequest=atomic.run([atomic.report()]);const originalBatch=atomic.env.DB.batch;atomic.env.DB={...atomic.db,batch:statements=>originalBatch([...statements,atomic.db.prepare('INSERT INTO nonexistent_batch_table VALUES (1)')])};await assert.rejects(atomic.api(atomicRequest));assert.equal(atomic.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,0);assert.equal(atomic.sqlite.prepare('SELECT count(*) AS n FROM batch_items').get().n,0);atomic.env.DB=atomic.db;await atomic.api(atomicRequest);assert.equal(atomic.sqlite.prepare('SELECT count(*) AS n FROM batch_items').get().n,1);

 const concurrent=make(),originalCandidate=concurrent.report();
 const sameRequest=concurrent.run(undefined,{station_key:'S202103'});
 let firstWrite,finishFirst,notifyFirst;
 const firstAtWrite=new Promise(resolve=>{notifyFirst=resolve;});
 concurrent.env.DB={...concurrent.db,async batch(statements){
  if(!firstWrite){
   firstWrite=statements;
   return new Promise(resolve=>{finishFirst=resolve;notifyFirst();});
  }
  finishFirst(await concurrent.db.batch(firstWrite));
  return concurrent.db.batch(statements);
 }};
 const firstRun=concurrent.api(sameRequest);
 await firstAtWrite;
 concurrent.report();
 await Promise.all([firstRun,concurrent.api(sameRequest)]);
 assert.deepEqual(concurrent.sqlite.prepare('SELECT report_id FROM batch_items').all().map(item=>item.report_id),[originalCandidate]);

 const schedule=make();for(let i=0;i<5;i++)schedule.report();const settings={action:'schedule',enabled:true,interval_minutes:15,station_key:'S202103',notes:'예약 사진 검토',confirm:true};await assert.rejects(schedule.api({...settings,interval_minutes:14}),/15분/);await assert.rejects(schedule.api({...settings,confirm:false}),/범위/);await schedule.api(settings);await schedule.drain();assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,0);clock+=15*60000;await Promise.all([schedule.drain(),schedule.drain()]);assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,1,'same due tick is materialized once');assert(schedule.sqlite.prepare('SELECT next_run_at FROM batch_schedules').get().next_run_at>new Date().toISOString());
 await schedule.api({...settings,enabled:false});assert.equal(schedule.sqlite.prepare("SELECT count(*) AS n FROM batch_items WHERE status='pending'").get().n,0);const runs=schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n;clock+=15*60000;await schedule.drain();assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,runs);

 const disconnected=make(),pending=disconnected.run([disconnected.report()]);await disconnected.api(pending);disconnected.sqlite.prepare("UPDATE agent_links SET revoked_at=? WHERE actor='batch-a'").run(new Date().toISOString());await disconnected.drain();assert.equal(disconnected.sqlite.prepare('SELECT status FROM batch_items').get().status,'pending');await assert.rejects(disconnected.api(disconnected.run([disconnected.report()])),/연결/);disconnected.env.APPROVERS='';assert.equal((await disconnected.api()).status,401);

 // Cancellation wins before the guarded item claim, even if the poll selected it.
 const race=make(),raceRequest=race.run([race.report()]);await race.api(raceRequest);let cancelled=false;race.env.DB={...race.db,prepare(sql){const q=race.db.prepare(sql);if(sql.startsWith("UPDATE batch_items SET status='enqueuing'")){const run=q.run.bind(q);q.run=async()=>{if(!cancelled){cancelled=true;race.sqlite.prepare("UPDATE batch_items SET status='cancelled' WHERE run_id=? AND status='pending'").run(raceRequest.request_id);}return run();};}return q;}};await race.drain();assert.equal(race.sqlite.prepare('SELECT count(*) AS n FROM report_jobs').get().n,0);assert.equal(race.sqlite.prepare('SELECT status FROM batch_items').get().status,'cancelled');

 // A disable racing with a previously-read due schedule cannot create new work.
 const disableRace=make();disableRace.report();await disableRace.api(settings);clock+=15*60000;let disabled=false;disableRace.env.DB={...disableRace.db,batch:async statements=>{if(!disabled){disabled=true;disableRace.sqlite.prepare('UPDATE batch_schedules SET enabled=0').run();}return disableRace.db.batch(statements);}};await disableRace.drain();assert.equal(disableRace.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,0);

 // Crash after chat.start but before item ack recovers the saved message/job.
 const recovered=make(),recoverRequest=recovered.run([recovered.report()]);await recovered.api(recoverRequest);await recovered.drain();const saved=recovered.sqlite.prepare('SELECT id,job_id FROM batch_items').get();recovered.sqlite.prepare("UPDATE batch_items SET status='enqueuing',job_id=NULL,updated_at=? WHERE id=?").run(new Date(clock-120001).toISOString(),saved.id);await recovered.drain();assert.equal(recovered.sqlite.prepare('SELECT job_id FROM batch_items').get().job_id,saved.job_id);assert.equal(recovered.sqlite.prepare('SELECT count(*) AS n FROM report_jobs').get().n,1);
 // Exercise real MCP claims, questions, and final private drafts for two reports in one run.
 const work=make(),station='S201801',position=[127.43459,36.33223,60.34];
 const reportIds=[work.report({station,position}),work.report({station,position})];
 const files=new Map();
 work.env.UPLOADS={async put(key,bytes){files.set(key,bytes);},async get(key){return files.has(key)?{body:files.get(key)}:null;},async delete(key){files.delete(key);}};
 const png=(width,height)=>encode({width,height,data:new Uint8Array(width*height*4).fill(255),channels:4,depth:8});
 const photo=png(64,32),photoIds=new Map();
 for(const reportId of reportIds){
  const photoId=randomUUID();
  photoIds.set(reportId,photoId);
  files.set('report/'+photoId,photo);
  work.sqlite.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,view_role,created_at) VALUES (?,?,?,?,?,?,?,?)')
   .run(photoId,reportId,'image/png',photo.length,64,32,'front',new Date().toISOString());
 }
 const queued=work.run(reportIds,{station_key:station});
 const getRun=async()=> (await work.api()).data.runs.find(run=>run.id===queued.request_id);
 const principal='synthetic-batch-a',link=work.sqlite.prepare("SELECT * FROM agent_links WHERE actor='batch-a'").get();
 const invoke=async(name,args)=>{
  const response=await server.fetch(new Request('https://synthetic.test/mcp',{
   method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','oai-authenticated-user-id':principal},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),
  }),work.env);
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(Boolean(data.error||data.result?.isError),false,JSON.stringify(data.result?.content));
  return data.result.structuredContent;
 };
 const scoped=work.report({station,status:'accepted'}),scopedRunner=randomUUID(),generalRunner=randomUUID();
 work.sqlite.prepare("INSERT INTO report_jobs (id,report_id,station_key,kind,status,report_version,actor,input,created_at,updated_at) VALUES (?, ?, ?, 'conversation', 'needs_info', ?, 'batch-a', ?, ?, ?)").run(randomUUID(),scoped,station,new Date().toISOString(),JSON.stringify({engine:'dots'}),new Date().toISOString(),new Date().toISOString());
 await work.api(queued);
 assert.equal((await work.api()).data.worker_status,'offline');
 await invoke('toolkit_runner_register',{runner_id:scopedRunner,label:'한 제보 전용',report_id:scoped});
 assert.equal((await work.api()).data.worker_status,'single-report');
 let prepares=0;
 await runnerAgentTool('toolkit_runner_claim',{runner_id:scopedRunner,request_id:randomUUID(),lease_token:'a'.repeat(64)},work.env,link,principal,{beforeClaim:async()=>{prepares++;await work.drain();}});
 assert.equal(prepares,0,'one-report runner cannot drain other batch reports');
 assert.equal((await getRun()).counts.pending,2);
 await invoke('toolkit_runner_register',{runner_id:generalRunner,label:'여러 제보 작업자'});
 assert.equal((await work.api()).data.worker_status,'online');
 for(const digit of ['b','c']){
  const token=digit.repeat(64);
  const {job}=await invoke('toolkit_runner_claim',{runner_id:generalRunner,request_id:randomUUID(),lease_token:token});
  assert(reportIds.includes(job.report_id));
  const lease={runner_id:generalRunner,job_id:job.job_id,lease_token:token};
  const execution=async()=> (await chatDetail(work.env,job.report_id,'batch-a')).job.execution;
  assert.equal((await execution()).state,'received');
  assert.equal((await getRun()).counts.received,1);
  assert((await execution()).message_id,'state is anchored to the specific saved batch instruction');
  assert.equal((await chatDetail(work.env,job.report_id,'batch-b')).job,null);
  await invoke('toolkit_runner_begin',lease);
  assert.equal((await execution()).state,'working');
  assert.equal((await getRun()).counts.working,1);
  await invoke('toolkit_runner_execute',{...lease,tool:'toolkit_request_info',arguments:{job_id:job.job_id,questions:['실제 치수 사진이 있을까요?']}});
  await invoke('toolkit_runner_finish',{...lease,outcome:'needs_info'});
  assert.equal((await execution()).state,'needs_info');
 }
 assert.equal((await getRun()).counts.needs_info,2);
 assert.deepEqual(new Set((await getRun()).items.map(item=>item.report_id)),new Set(reportIds));
 const structure={name:'합성 검증 안내대',floor:'2F',position,size:[2,.6,1],heading:90,color:'#cccccc',dimension_basis:'estimated'};
 const image='data:image/png;base64,'+Buffer.from(png(...structurePixels(structure.size))).toString('base64');
 const provenance={method:'rectified',evidence:'합성 정면 사진에 맞춘 비공개 초안',uncertainty:'실측하지 않은 테스트용 추정',privacy_reviewed:true};
 const drafts=new Map();
 for(const [index,reportId] of reportIds.entries()){
  const previous=(await chatDetail(work.env,reportId,'batch-a')).job.id;
  const follow=await chatConsoleApi(new Request('https://synthetic.test/api/console/reports/'+reportId+'/chat',{method:'POST'}),work.env,null,{
   json:(data,status)=>Response.json(data,{status}),me:{approver:'batch-a'},
   body:async()=>({request_id:randomUUID(),text:'이 사진의 가로 폭은 2미터입니다.',attachment_ids:[]}),
   audit:async()=>{},
  });
  const next=(await follow.json()).job;
  assert.equal(next.execution.parent_job_id,previous);
  assert.equal(next.execution.state,'waiting');
  const item=(await getRun()).items.find(item=>item.report_id===reportId);
  assert.equal(item.job_id,previous);
  assert.equal(item.current_job_id,next.id);
  assert.equal(item.state,'waiting','batch follows its report revision instead of displaying the old cancelled job');
  const token=['d','e'][index].repeat(64);
  const {job}=await invoke('toolkit_runner_claim',{runner_id:generalRunner,request_id:randomUUID(),lease_token:token});
  assert.equal(job.job_id,next.id);
  const lease={runner_id:generalRunner,job_id:next.id,lease_token:token};
  const execute=(tool,args)=>invoke('toolkit_runner_execute',{...lease,tool,arguments:{job_id:next.id,...args}});
  await invoke('toolkit_runner_begin',lease);
  const artifact=await execute('toolkit_store_draft_artifact',{request_id:randomUUID(),source_photo_ids:[photoIds.get(reportId)],image,provenance});
  const plan={kind:'structure',structure,structure_provenance:{evidence:provenance.evidence,uncertainty:provenance.uncertainty},confidence:.95,questions:[],hide_ids:[],faces:[{side:'front',artifact_id:artifact.artifact_id}]};
  const submitted=await execute('toolkit_submit_plan',{plan});
  assert.equal(submitted.status,'draft');
  const finished=await invoke('toolkit_runner_finish',{...lease,outcome:'draft'});
  assert.equal(finished.outcome,'draft');
  const proposal=work.sqlite.prepare('SELECT report_ids,status,meta FROM proposals WHERE id=?').get(submitted.proposal_id);
  assert.deepEqual(JSON.parse(proposal.report_ids),[reportId]);
  assert.equal(proposal.status,'draft');
  assert.equal(JSON.parse(proposal.meta).faces.front.artifact_id,artifact.artifact_id);
  assert(files.has('proposal/'+submitted.proposal_id));
  assert.equal((await server.fetch(new Request('https://synthetic.test/api/public/proposal-images/'+submitted.proposal_id),work.env)).status,404);
  drafts.set(reportId,submitted.proposal_id);
 }
 const completed=await getRun();
 assert.equal(completed.counts.draft_submitted,2);
 assert.deepEqual(new Map(completed.items.map(item=>[item.report_id,item.proposal_id])),drafts);
 assert.equal(new Set(drafts.values()).size,2);
 assert.equal(work.sqlite.prepare('SELECT count(*) AS n FROM station_layers').get().n,0);
 assert(!JSON.stringify(await getRun()).includes('token_hash'));
 console.log('PASS batch real chat and MCP with memory D1/R2: two sequential questions and private artifact-backed drafts, scoped workers, manual/interval, idempotency, cancellation, no approval');
}finally{globalThis.Date=RealDate;for(const f of fixtures)f.sqlite.close();}
