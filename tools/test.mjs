import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import server from '../server/index.js';
import {sampleProject,daejeonProject,validateProject,approvedImageReference,coordinate} from '../src/model.js';
import {stationProject} from '../src/model.js';
import {stations,saveLocked,validateStation} from '../src/stations.js';
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
const localImage='http://127.0.0.1:4197/api/public/proposal-images/42b4d759-b3dc-4e35-85d8-c0b37019e8c3',imageProject=sampleProject();imageProject.assets[0].facades={front:localImage};assert.throws(()=>validateProject(imageProject),/파사드 이미지/);imageProject.assets[0].facades.front=approvedImageReference(localImage,'http://127.0.0.1:4197');assert.equal(imageProject.assets[0].facades.front,'/api/public/proposal-images/42b4d759-b3dc-4e35-85d8-c0b37019e8c3');validateProject(imageProject);assert.equal(approvedImageReference('http://outside.test/photo.png','http://127.0.0.1:4197'),'http://outside.test/photo.png');const malformedParts=structuredClone(imageProject);malformedParts.assets[0].parts=[{id:'invalid',type:'plane',vertices:[],texture:'front',uv:[]}];assert.throws(()=>validateProject(malformedParts),/평면/);

const frozenPath='/data/jury-frozen/images/'+('a'.repeat(64))+'.png';
for(const host of ['127.0.0.1','localhost']){const fixture=sampleProject();fixture.assets[0].facades={front:'http://'+host+':4210'+frozenPath};validateProject(fixture);}
for(const invalid of ['http://127.0.0.1:4197'+frozenPath,'http://127.0.0.1:4211'+frozenPath,'http://127.0.0.1.evil.test:4210'+frozenPath,'http://user@127.0.0.1:4210'+frozenPath,'http://127.0.0.1:4210/api/files/image','http://127.0.0.1:4210'+frozenPath+'?cache=1','http://127.0.0.1:4210'+frozenPath+'#image','http://127.0.0.1:4210/data/jury-frozen/images/../private.png','http://127.0.0.1:4210'+frozenPath.replace('.png','.jpg')]){const fixture=sampleProject();fixture.assets[0].facades={front:invalid};assert.throws(()=>validateProject(fixture),/파사드 이미지/,invalid);}
const other=stationProject({...stations[1],id:'S209999',name:'가상 연결 검증역',centre:[128,36,60],floors:['B1','1F'],heights:{B1:55,'1F':60},default_floor:'1F'});assert.equal(validateProject(other).site_id,'S209999');
const baselineStations=JSON.stringify(stations),stationDrafts=[];assert.equal(stations.length,46);assert.equal(new Set(stations.map(s=>s.id)).size,46);assert.equal(new Set(stations.map(s=>s.name)).size,46);
for(const station of stations){validateStation(station);const draft=stationProject(station);assert.equal(saveLocked(draft),false);validateProject(draft);assert.equal(draft.station.default_floor,station.default_floor);assert.deepEqual(draft.station.heights,station.heights);const created=await call('/api/projects','POST',{project:draft},'');assert.equal(created.status,201,station.name);const saved=await created.json(),jar=created.headers.get('set-cookie').split(';')[0];assert.equal(saved.shared,false);assert.equal((await (await call('/api/projects/'+saved.id,'GET',null,jar)).json()).project.site_id,station.id);assert.equal((await call('/api/projects/'+saved.id,'GET',null,'')).status,404);stationDrafts.push({...saved,jar});}
assert.equal(JSON.stringify(stations),baselineStations);assert.equal(db.prepare('SELECT count(*) AS n FROM station_layers').get().n,0);
const seoul=stationDrafts.find(s=>s.project.site_id==='S202103'),seoulDraft=structuredClone(seoul.project);seoulDraft.name='서울역 개인 저장 검증';assert.equal((await call('/api/projects/'+seoul.id,'PUT',{project:seoulDraft,revision:0,shared:false},seoul.jar)).status,200);assert.equal((await (await call('/api/projects/'+seoul.id,'GET',null,seoul.jar)).json()).project.name,seoulDraft.name);assert.equal((await call('/api/projects/'+seoul.id,'PUT',{project:seoulDraft,revision:1,shared:false},stationDrafts[1].jar)).status,404);assert.equal((await call('/api/projects/'+seoul.id,'PUT',{project:seoulDraft,revision:0,shared:false},seoul.jar)).status,409);
const pngPhoto=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const seoulUpload=await server.fetch(new Request('http://editor.test/api/projects/'+seoul.id+'/files',{method:'POST',headers:{Cookie:seoul.jar,Origin:'http://editor.test'},body:pngPhoto}),env);assert.equal(seoulUpload.status,201);const seoulImage=await seoulUpload.json();assert.equal((await call(seoulImage.url,'GET',null,seoul.jar)).status,200);assert.equal((await call(seoulImage.url,'GET',null,'')).status,404);assert.equal((await call(seoulImage.url,'GET',null,stationDrafts[1].jar)).status,404);
const rejectedUpload=await server.fetch(new Request('http://editor.test/api/projects/'+seoul.id+'/files',{method:'POST',headers:{Cookie:stationDrafts[1].jar,Origin:'http://editor.test'},body:pngPhoto}),env);assert.equal(rejectedUpload.status,404);assert.equal((await call('/api/seoul/snapshot','POST',{},seoul.jar)).status,423);assert.equal(db.prepare('SELECT count(*) AS n FROM station_layers').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM proposals').get().n,0);

const project=sampleProject();project.points.push({id:'lift-4',name:'4층 접속',role:'connection',floor:'4F',position:coordinate(-20,10,68.37)});project.connections[0].point_ids.push('lift-4');project.routes.push({id:'multi-floor',name:'N:N 시험',point_ids:['lift-2','lift-4','lift-3']});validateProject(project);
assert.throws(()=>validateProject({...project,site_id:'S202103'}));assert.throws(()=>validateProject({...project,tileset_url:'https://example.com/seoul.json'}));
assert.equal((await call('/api/projects','POST',{project},'','http://outside.test')).status,403);
let res=await call('/api/projects','POST',{project});assert.equal(res.status,201);cookie=res.headers.get('set-cookie').split(';')[0];const saved=await res.json(),id=saved.id;
assert.equal((await call('/api/projects/'+id,'GET',null,'')).status,404);
res=await call('/api/projects/'+id,'PUT',{project,revision:0,shared:true});assert.equal(res.status,200);
assert.equal((await call('/api/projects/'+id,'PUT',{project,revision:0,shared:true})).status,409);
assert.equal((await (await call('/api/projects/'+id,'GET',null,'')).json()).canEdit,false);
assert.equal((await call('/api/projects/'+id,'PUT',{project,revision:1,shared:true},'')).status,403);
assert.equal((await call('/api/projects/'+id,'PUT',{project:{...project,site_id:'S202103'},revision:1,shared:true})).status,400);
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);res=await server.fetch(new Request('http://editor.test/api/projects/'+id+'/files',{method:'POST',headers:{Cookie:cookie,Origin:'http://editor.test'},body:png}),env);assert.equal(res.status,201);const file=await res.json();assert.deepEqual(new Uint8Array(await (await call(file.url,'GET',null,'')).arrayBuffer()),png);
const invalid=structuredClone(project);invalid.observations.push({id:'bad',origin_id:'entry-east',date:'2026-07-01',hour:12,arrivals:1,departures:1,value_class:'estimated',method:''});assert.throws(()=>validateProject(invalid));
invalid.observations[0].method='시간 구성비 추정';invalid.observations[0].date='2026-02-30';assert.throws(()=>validateProject(invalid));
const badArea=structuredClone(project);badArea.points.find(p=>p.role==='via').area=[coordinate(0,0),coordinate(1,0),coordinate(0,1)];assert.throws(()=>validateProject(badArea));
console.log('PASS: 46 station draft create/reload, Seoul private edit/upload, owner isolation and no public map mutation; Generic station model, N:N floors, route references, server persistence, owner isolation, public read-only, revision conflicts, upload access, estimate validation.');db.close();
