import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import server from '../server/index.js';
import {sampleProject,daejeonProject,validateProject,coordinate} from '../src/model.js';
import {stationProject} from '../src/model.js';
import {stations} from '../src/stations.js';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')))db.exec(readFileSync('drizzle/'+f,'utf8'));
const prepare=sql=>{
 let values=[];
 return {
  bind(...v){values=v;return this;},
  async first(){return db.prepare(sql).get(...values)||null;},
  async all(){return {results:db.prepare(sql).all(...values)};},
  async run(){return {meta:db.prepare(sql).run(...values)};}
 };
};
const files=new Map(),env={DB:{prepare},UPLOADS:{async put(id,a){files.set(id,a)},async get(id){return files.has(id)?{body:files.get(id)}:null;}}};
let cookie='';const call=(p,method='GET',body,owner=cookie,origin='http://editor.test')=>server.fetch(new Request('http://editor.test'+p,{method,headers:{Cookie:owner,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
assert.equal(validateProject(daejeonProject()).site_id,'S201801');
const other=stationProject({...stations[1],id:'S209999',name:'가상 연결 검증역',centre:[128,36,60],floors:['B1','1F'],heights:{B1:55,'1F':60},default_floor:'1F'});assert.equal(validateProject(other).site_id,'S209999');
assert.equal((await call('/api/projects','POST',{project:stationProject(stations[0])})).status,423);assert.equal(db.prepare('SELECT count(*) AS n FROM editor_projects').get().n,0);
const project=sampleProject();project.points.push({id:'lift-4',name:'4층 접속',role:'connection',floor:'4F',position:coordinate(-20,10,68.37)});project.connections[0].point_ids.push('lift-4');project.routes.push({id:'multi-floor',name:'N:N 시험',point_ids:['lift-2','lift-4','lift-3']});validateProject(project);
assert.throws(()=>validateProject({...project,site_id:'S202103'}));assert.throws(()=>validateProject({...project,tileset_url:'https://example.com/seoul.json'}));
assert.equal((await call('/api/projects','POST',{project},'','http://outside.test')).status,403);
let res=await call('/api/projects','POST',{project});assert.equal(res.status,201);cookie=res.headers.get('set-cookie').split(';')[0];const saved=await res.json(),id=saved.id;
assert.equal((await call('/api/projects/'+id,'GET',null,'')).status,404);
res=await call('/api/projects/'+id,'PUT',{project,revision:0,shared:true});assert.equal(res.status,200);
assert.equal((await call('/api/projects/'+id,'PUT',{project,revision:0,shared:true})).status,409);
assert.equal((await (await call('/api/projects/'+id,'GET',null,'')).json()).canEdit,false);
assert.equal((await call('/api/projects/'+id,'PUT',{project,revision:1,shared:true},'')).status,403);
assert.equal((await call('/api/projects/'+id,'PUT',{project:{...project,site_id:'S202103'},revision:1,shared:true})).status,423);
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);res=await server.fetch(new Request('http://editor.test/api/projects/'+id+'/files',{method:'POST',headers:{Cookie:cookie,Origin:'http://editor.test'},body:png}),env);assert.equal(res.status,201);const file=await res.json();assert.deepEqual(new Uint8Array(await (await call(file.url,'GET',null,'')).arrayBuffer()),png);
const invalid=structuredClone(project);invalid.observations.push({id:'bad',origin_id:'entry-east',date:'2026-07-01',hour:12,arrivals:1,departures:1,value_class:'estimated',method:''});assert.throws(()=>validateProject(invalid));
invalid.observations[0].method='시간 구성비 추정';invalid.observations[0].date='2026-02-30';assert.throws(()=>validateProject(invalid));
const badArea=structuredClone(project);badArea.points.find(p=>p.role==='via').area=[coordinate(0,0),coordinate(1,0),coordinate(0,1)];assert.throws(()=>validateProject(badArea));
console.log('PASS: Generic station model, N:N floors, route references, server persistence, owner isolation, public read-only, revision conflicts, upload access, estimate validation.');db.close();
