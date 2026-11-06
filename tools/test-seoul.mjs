import {DatabaseSync} from 'node:sqlite';
import server from '../server/index.js';
import {d1Adapter} from './sqlite-adapter.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
import {adaptSeoulSnapshot} from '../src/seoul-snapshot.js';
import {validateProject} from '../src/model.js';
const root=new URL('../../service/',import.meta.url);
if(!fs.existsSync(new URL('server/data/workbench-seed.json',root))){console.log('SKIP: optional private Seoul fixture unavailable');process.exit(0);}
const j=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const s={revision:334,register:j('server/data/workbench-seed.json').data,catalog:j('public/data/experience/catalog.json'),graph:j('public/data/experience/walk-graph.json'),facades:j('public/data/jury-frozen/approved-facades.json'),methodology:j('public/data/experience/methodology.json'),validation_points:j('server/data/validation.json').points};
const before=JSON.stringify(s),p=adaptSeoulSnapshot(s,'http://127.0.0.1:4196');
const points=new Map(p.points.map(x=>[x.id,x]));
for(const r of p.routes)for(let i=1;i<r.point_ids.length;i++){const [a,b]=r.point_ids.slice(i-1,i+1);if(points.get(a).floor!==points.get(b).floor)assert.ok(p.connections.some(c=>(c.path||c.point_ids).includes(a)&&(c.path||c.point_ids).includes(b)),r.name);}
validateProject(p);assert.equal(p.connections.length,84);assert.equal(p.routes.length,28);assert.equal(p.facilities.length,281);assert.equal(p.origins.length,53);assert.equal(p.observations.length,1488);assert.equal(p.points.filter(v=>v.role==='origin').length,8);
const modified=structuredClone(p);modified.points[0].name='임시 변경';validateProject(modified);assert.equal(JSON.stringify(s),before);
const sourceOriginName=s.register.origins[0].name,draftOriginName=p.origins[0].name;p.origins[0].name='개인 초안 원점명';assert.equal(s.register.origins[0].name,sourceOriginName);assert.equal(p.source_register.origins[0].name,sourceOriginName);p.origins[0].name=draftOriginName;
const db=new DatabaseSync(':memory:');for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const images=new Map(),env={DB:d1Adapter(db),UPLOADS:{async put(key,value){images.set(key,value);},async get(key){return images.has(key)?{body:images.get(key)}:null;}}};
let jar='';const call=(url,{method='GET',body,cookie=jar,image}={})=>server.fetch(new Request('http://seoul.test'+url,{method,headers:{Origin:'http://seoul.test',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:image?{body:image}:{})}),env);
try{
 let response=await call('/api/projects',{method:'POST',body:{project:p}});assert.equal(response.status,201);jar=response.headers.get('set-cookie').split(';')[0];const saved=await response.json();assert.equal(saved.shared,false);assert.equal(saved.project.site_id,'S202103');
 const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');response=await call('/api/projects/'+saved.id+'/files',{method:'POST',image:photo});assert.equal(response.status,201);const image=await response.json();
 const updated=structuredClone(saved.project);updated.name='서울역 · 저장 후 다시 연 개인 초안';updated.assets[0].facades.front=image.url;response=await call('/api/projects/'+saved.id,{method:'PUT',body:{project:updated,revision:0,shared:false}});assert.equal(response.status,200);
 const reloaded=await (await call('/api/projects/'+saved.id)).json();assert.equal(reloaded.project.name,updated.name);assert.equal(reloaded.project.assets[0].facades.front,image.url);assert.equal(reloaded.project.connections.length,84);assert.equal(reloaded.project.facilities.length,281);
 assert.equal((await call('/api/projects/'+saved.id,{cookie:''})).status,404);assert.equal((await call(image.url,{cookie:''})).status,404);assert.equal((await call(image.url)).status,200);assert.equal((await call('/api/projects/'+saved.id,{method:'PUT',cookie:'nerd-owner='+crypto.randomUUID(),body:{project:updated,revision:1,shared:true}})).status,404);
 assert.equal((await call('/api/projects/'+saved.id,{method:'PUT',body:{project:updated,revision:1,shared:true}})).status,200);const publicCopy=await (await call('/api/projects/'+saved.id,{cookie:''})).json();assert.equal(publicCopy.canEdit,false);const copiedResponse=await call('/api/projects',{method:'POST',cookie:'',body:{project:publicCopy.project}});assert.equal(copiedResponse.status,201);const copied=await copiedResponse.json(),copyCookie=copiedResponse.headers.get('set-cookie').split(';')[0];assert.notEqual(copied.id,saved.id);assert.equal(copied.shared,false);assert.equal((await call('/api/projects/'+copied.id,{cookie:''})).status,404);assert.equal((await (await call('/api/projects/'+copied.id,{cookie:copyCookie})).json()).canEdit,true);assert.equal((await call('/api/projects/'+saved.id,{method:'PUT',cookie:'',body:{project:updated,revision:2,shared:true}})).status,403);
 assert.equal(db.prepare('SELECT count(*) AS n FROM station_layers').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM proposals').get().n,0);assert.equal(JSON.stringify(s),before);
 console.log('PASS: full Seoul personal draft save/reload/upload, owner isolation, shared read-only, source immutability and no operational map mutation; N:N stops and route references');
}finally{db.close();}
