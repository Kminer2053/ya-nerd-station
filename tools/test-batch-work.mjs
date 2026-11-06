import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {batchConsoleApi,runDueBatches} from '../server/batch-work.js';
import {d1Adapter} from './sqlite-adapter.mjs';
const RealDate=Date;let clock=Date.now();globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync('drizzle/'+f,'utf8'));
function fixture(){
 const sqlite=new DatabaseSync(':memory:');for(const sql of migrations)sqlite.exec(sql);const db=d1Adapter(sqlite),env={DB:db,APPROVERS:'batch-a:test-password-a,batch-b:test-password-b',UPLOADS:{}};
 const at=new Date().toISOString(),until=new Date(clock+864e5).toISOString();
 for(const actor of ['batch-a','batch-b'])sqlite.prepare('INSERT INTO agent_links (id,actor,code_hash,principal_id,label,created_at,code_expires_at,expires_at,redeemed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),actor,randomUUID(),'synthetic-'+actor,'test',at,until,until,at);
 const helpers={stationData:async()=>({slots:[]}),imageInfo:()=>{throw Error('unexpected image decoding');}};
 const report=({station='S202103',status='review',floor='2F'}={})=>{const id=randomUUID();sqlite.prepare("INSERT INTO reports (id,station_key,floor,position,type,description,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,'synthetic evidence',?,'synthetic','[]',?,?)").run(id,station,floor,JSON.stringify([126.9706,37.5539,36.2]),'other',status,at,at);return id;};
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

 const schedule=make();for(let i=0;i<5;i++)schedule.report();const settings={action:'schedule',enabled:true,interval_minutes:15,station_key:'S202103',notes:'예약 사진 검토',confirm:true};await assert.rejects(schedule.api({...settings,interval_minutes:14}),/15분/);await assert.rejects(schedule.api({...settings,confirm:false}),/범위/);await schedule.api(settings);await schedule.drain();assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,0);clock+=15*60000;await Promise.all([schedule.drain(),schedule.drain()]);assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,1,'same due tick is materialized once');assert(schedule.sqlite.prepare('SELECT next_run_at FROM batch_schedules').get().next_run_at>new Date().toISOString());
 await schedule.api({...settings,enabled:false});assert.equal(schedule.sqlite.prepare("SELECT count(*) AS n FROM batch_items WHERE status='pending'").get().n,0);const runs=schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n;clock+=15*60000;await schedule.drain();assert.equal(schedule.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,runs);

 const disconnected=make(),pending=disconnected.run([disconnected.report()]);await disconnected.api(pending);disconnected.sqlite.prepare("UPDATE agent_links SET revoked_at=? WHERE actor='batch-a'").run(new Date().toISOString());await disconnected.drain();assert.equal(disconnected.sqlite.prepare('SELECT status FROM batch_items').get().status,'pending');await assert.rejects(disconnected.api(disconnected.run([disconnected.report()])),/연결/);disconnected.env.APPROVERS='';assert.equal((await disconnected.api()).status,401);

 // Cancellation wins before the guarded item claim, even if the poll selected it.
 const race=make(),raceRequest=race.run([race.report()]);await race.api(raceRequest);let cancelled=false;race.env.DB={...race.db,prepare(sql){const q=race.db.prepare(sql);if(sql.startsWith("UPDATE batch_items SET status='enqueuing'")){const run=q.run.bind(q);q.run=async()=>{if(!cancelled){cancelled=true;race.sqlite.prepare("UPDATE batch_items SET status='cancelled' WHERE run_id=? AND status='pending'").run(raceRequest.request_id);}return run();};}return q;}};await race.drain();assert.equal(race.sqlite.prepare('SELECT count(*) AS n FROM report_jobs').get().n,0);assert.equal(race.sqlite.prepare('SELECT status FROM batch_items').get().status,'cancelled');

 // A disable racing with a previously-read due schedule cannot create new work.
 const disableRace=make();disableRace.report();await disableRace.api(settings);clock+=15*60000;let disabled=false;disableRace.env.DB={...disableRace.db,batch:async statements=>{if(!disabled){disabled=true;disableRace.sqlite.prepare('UPDATE batch_schedules SET enabled=0').run();}return disableRace.db.batch(statements);}};await disableRace.drain();assert.equal(disableRace.sqlite.prepare('SELECT count(*) AS n FROM batch_runs').get().n,0);

 // Crash after chat.start but before item ack recovers the saved message/job.
 const recovered=make(),recoverRequest=recovered.run([recovered.report()]);await recovered.api(recoverRequest);await recovered.drain();const saved=recovered.sqlite.prepare('SELECT id,job_id FROM batch_items').get();recovered.sqlite.prepare("UPDATE batch_items SET status='enqueuing',job_id=NULL,updated_at=? WHERE id=?").run(new Date(clock-120001).toISOString(),saved.id);await recovered.drain();assert.equal(recovered.sqlite.prepare('SELECT job_id FROM batch_items').get().job_id,saved.job_id);assert.equal(recovered.sqlite.prepare('SELECT count(*) AS n FROM report_jobs').get().n,1);
 console.log('PASS batch real chat + memory D1: manual/interval, atomic/idempotent scope, concurrent drains, actor isolation, stale/busy skips, 200+ pagination, cancellation, revoked auth, no approval');
}finally{globalThis.Date=RealDate;for(const f of fixtures)f.sqlite.close();}
