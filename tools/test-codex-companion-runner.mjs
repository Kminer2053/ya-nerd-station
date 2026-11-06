import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {runnerAgentTool} from '../server/agent-runner.js';
import {d1Adapter} from './sqlite-adapter.mjs';
import {run,parseArgs,jsonValue,REQUIRED_TOOLS,WORKER_PERMISSION_PROFILE} from './codex-draft-worker.mjs';
import {RUNNER_TOOLS,CompanionSession} from './codex-companion-session.mjs';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
const folder=await mkdtemp(path.join(tmpdir(),'station-companion-')),env={DB:d1Adapter(db)},link={id:randomUUID(),actor:'companion-test'},principal='synthetic-principal',report=randomUUID(),at=new Date().toISOString(),later=new Date(Date.now()+86400000).toISOString();
db.prepare('INSERT INTO agent_links (id,actor,code_hash,principal_id,label,created_at,code_expires_at,expires_at,redeemed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(link.id,link.actor,'synthetic',principal,'test',at,later,later,at);
db.prepare("INSERT INTO reports (id,station_key,type,status,reporter_hash,history,created_at,updated_at) VALUES (?,'S202103','other','accepted','synthetic','[]',?,?)").run(report,at,at);
let current;
function enqueue(){const job=randomUUID(),anchor=randomUUID();db.prepare("INSERT INTO work_messages (id,report_id,actor,role,text,created_at) VALUES (?,?,?,'admin','질문부터 해주세요',?)").run(anchor,report,link.actor,at);db.prepare("INSERT INTO report_jobs (id,report_id,station_key,kind,status,report_version,actor,input,created_at,updated_at) VALUES (?,?,'S202103','conversation','awaiting_external',?,?,?,?,?)").run(job,report,at,link.actor,JSON.stringify({engine:'dots',chat_message_id:anchor}),at,at);current=job;return job;}
const requests=[],logs=[],controller=new AbortController();let turns=0;
const raw=v=>({structuredContent:v});
async function ordinary(name,args){const job=args.job_id&&db.prepare('SELECT * FROM report_jobs WHERE id=?').get(args.job_id);switch(name){
 case 'toolkit_connection_status':return raw({connected:true,can_approve:false});
 case 'toolkit_read_work':return raw({job_id:job.id,report_id:report,status:job.status,photos:[],kind:'conversation',plan_schema:{type:'object'}});
 case 'toolkit_read_conversation':return raw({report_id:report,current_job_id:current,connection:{connected:true},messages:[]});
 case 'toolkit_request_info':db.prepare("UPDATE report_jobs SET status='needs_info',questions=? WHERE id=? AND status='awaiting_external'").run(JSON.stringify(args.questions),job.id);return raw({status:'needs_info',can_approve:false});
 default:throw Error('unexpected mock model operation '+name);
}}
async function mcp(name,args){return RUNNER_TOOLS.includes(name)?runnerAgentTool(name,args,env,link,principal,{execute:ordinary}):ordinary(name,args);}
const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;const waiting=new Map();let buffer='',next=500;
child.stdin=new Writable({write(bytes,_enc,done){buffer+=bytes;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line)void handle(JSON.parse(line));}done();}});
child.kill=signal=>{queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0,signal);});return true;};
async function handle(m){
 if(!m.method){waiting.get(m.id)?.(m.result);waiting.delete(m.id);return;}requests.push(m);
 const reply=result=>child.stdout.write(JSON.stringify({id:m.id,result})+'\n');
 try{switch(m.method){
  case 'initialized':return;
  case 'initialize':return reply({});
  case 'model/list':return reply({data:[{id:'synthetic',model:'synthetic-model',isDefault:true,inputModalities:['text','image']}]});
  case 'thread/start':return reply({thread:{id:m.params.dynamicTools?'model':'control'},activePermissionProfile:m.params.permissions?{id:m.params.permissions}:null,runtimeWorkspaceRoots:m.params.runtimeWorkspaceRoots||[]});
  case 'permissionProfile/list':return reply({data:[{id:WORKER_PERMISSION_PROFILE,allowed:true}]});
  case 'config/read':return reply({config:{}});
  case 'mcpServerStatus/list':return reply({data:[{name:'synthetic-toolkit',tools:Object.fromEntries([...REQUIRED_TOOLS,...RUNNER_TOOLS].map(name=>[name,{name}]))}]});
  case 'mcpServer/tool/call':return reply(await mcp(m.params.tool,m.params.arguments));
  case 'turn/interrupt':return reply({});
  case 'turn/start':{
   turns++;assert(db.prepare('SELECT started_at FROM agent_runner_leases WHERE job_id=?').get(current)?.started_at,'server begin CAS occurs before model turn');reply({turn:{id:'turn-'+turns}});
   const id=next++,result=new Promise(resolve=>waiting.set(id,resolve));child.stdout.write(JSON.stringify({id,method:'item/tool/call',params:{threadId:'model',turnId:'turn-'+turns,tool:'station_request_info',arguments:{questions:['촬영 시점은 언제인가요?']}}})+'\n');assert.equal((await result).success,true);
   child.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'model',turn:{id:'turn-'+turns,status:'completed'}}})+'\n');return;
  }
  default:throw Error('unexpected appserver method '+m.method);
 }}catch(error){child.stdout.write(JSON.stringify({id:m.id,error:{code:-32603,message:error.message}})+'\n');}
}
try{
 assert.equal(parseArgs(['--companion','--watch']).companion,true);assert.throws(()=>parseArgs(['--companion','--job',randomUUID()]));assert.throws(()=>parseArgs(['--report',randomUUID()]));
 assert.throws(()=>jsonValue({isError:true,content:[{type:'text',text:'생성 이미지가 대상 규격(606×1024 px)과 다릅니다.'}]}),/606×1024/,'model receives actionable validation feedback');
 const first=enqueue();let second;
 const options={...parseArgs(['--companion','--watch','--workspace',folder]),rpcTimeoutMs:1000,timeoutMs:3000};
 const result=await run(options,{signal:controller.signal,spawnImpl:()=>child,spawnSyncImpl:()=>({status:0,stdout:'synthetic capability'}),runtimeReadRootsImpl:async()=>[],probeFilesystemImpl:async()=>({}),log:v=>{logs.push(v);if(v.event==='finished'&&v.job_id===first)second=enqueue();else if(v.event==='idle')controller.abort();}});
 assert.equal(result.status,'interrupted');assert.equal(turns,2);assert.equal(db.prepare('SELECT status FROM report_jobs WHERE id=?').get(second).status,'needs_info');
 assert.equal(requests.filter(r=>r.method==='mcpServer/tool/call'&&r.params.tool==='toolkit_runner_begin').length,2);
 assert(!requests.some(r=>r.method==='mcpServer/tool/call'&&r.params.tool==='toolkit_request_info'),'job operations always use lease envelope');
 const state=JSON.parse(await readFile(path.join(folder,'companion.json'),'utf8'));assert(!state.pending);assert(!JSON.stringify(logs).includes('lease_token'));
 // Simulate host dying after the model start acknowledgement. The same identity
 // resumes its claim, but cannot begin the model a second time.
 const third=enqueue(),hostCall=(name,args)=>mcp(name,args),session=new CompanionSession({call:hostCall,jsonValue,workspace:folder});await session.start();assert.equal((await session.claim()).job_id,third);await session.begin();clearInterval(session.timer);
 const recovered=new CompanionSession({call:hostCall,jsonValue,workspace:folder});await recovered.start();assert.equal(await recovered.claim(),null);assert.equal(db.prepare('SELECT outcome FROM agent_runner_leases WHERE job_id=?').get(third).outcome,'interrupted');await recovered.close();
 console.log('PASS companion integration: mock model + real D1 runner queue; question → child → question, scoped RPC, begin-before-turn, restart no duplicate, actionable image error');
}finally{controller.abort();db.close();await rm(folder,{recursive:true,force:true});}
