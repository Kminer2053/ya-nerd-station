import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {stationProject,validateProject} from '../src/model.js';
import {stations} from '../src/stations.js';
import {importApprovedFacadeDrafts,resizeDraftParts} from '../src/approved-facade-drafts.js';
import {structureSlot} from '../src/console/structure.js';
import server from '../server/index.js';
import {d1Adapter} from './sqlite-adapter.mjs';
const busan=stations.find(s=>s.id==='S201807'),original=stationProject(busan),alias='REG-42b4d759-b3dc-4e35-85d8-c0b37019e8c3',image='/api/public/proposal-images/16b3c75b-5f60-43de-9446-3a0bf204a4ed';
const overlay={alias,name:'부산역 승인 정면',floor:busan.default_floor,position:[...busan.centre.slice(0,2),busan.heights[busan.default_floor]+1.5],heading:0,surface:[4,3],px:[1024,768],dimension_basis:'estimated',dimension_evidence:'사진 속 출입문을 기준으로 한 추정',dimension_uncertainty:'현장 확인 전',image,at:'2026-11-06'};
const before=JSON.stringify({original,overlay}),draft=importApprovedFacadeDrafts(original,[overlay],{origin:'http://127.0.0.1:4197'}),asset=draft.assets[0];
assert.equal(draft.assets.length,1);assert.equal(draft.overlays.length,0);assert.equal(asset.id,alias);assert.equal(asset.source_id,undefined);assert.equal(asset.source_record,undefined);assert.equal(asset.proposal,undefined);assert.equal(asset.heading,180);assert.equal(asset.position[2],overlay.position[2]-1.5);assert.equal(asset.parts.length,1);assert.equal(asset.parts[0].type,'plane');validateProject(draft);
assert.equal(asset.approved_facade.slot.position[2],overlay.position[2]);assert.equal(asset.approved_facade.slot.dimension_basis,'estimated');assert.equal(asset.approved_facade.evidence,overlay.dimension_evidence);
for(const heading of [0,37,90,180,359]){
 const current={...overlay,heading},a=importApprovedFacadeDrafts(original,[current],{origin:'http://127.0.0.1:4197'}).assets[0],slot=structureSlot(a),normal=heading*Math.PI/180,k=111320*Math.cos(overlay.position[1]*Math.PI/180);
 assert.equal(slot.heading,heading);assert(Math.abs(slot.position[0]-(overlay.position[0]+Math.sin(normal)*.05/k))<1e-12);assert(Math.abs(slot.position[1]-(overlay.position[1]+Math.cos(normal)*.05/111320))<1e-12);assert.equal(slot.position[2],overlay.position[2]);
 // Preserve both vertex placement and left-to-right UV order, not just center.
 const rad=-a.heading*Math.PI/180,world=([x,y,z])=>[a.position[0]+(x*Math.cos(rad)-y*Math.sin(rad))/k,a.position[1]+(x*Math.sin(rad)+y*Math.cos(rad))/111320,a.position[2]+z],vertices=a.parts[0].vertices.map(world);
 for(const [index,sign,z]of [[0,1,overlay.position[2]-1.5],[1,-1,overlay.position[2]-1.5],[2,-1,overlay.position[2]+1.5],[3,1,overlay.position[2]+1.5]]){const expected=[overlay.position[0]+(Math.cos(normal)*sign*2+Math.sin(normal)*.05)/k,overlay.position[1]+(-Math.sin(normal)*sign*2+Math.cos(normal)*.05)/111320,z];vertices[index].forEach((n,i)=>assert(Math.abs(n-expected[i])<1e-10));}
}
const updated=structuredClone(draft),a=updated.assets[0],oldSize=[...a.size];a.size=[6,.2,4];a.parts=resizeDraftParts(a.parts,oldSize,a.size);a.position[0]+=.00001;a.facades.front='/api/files/598a66b7-3245-4fbe-a4ea-5051e43c99e6';validateProject(updated);assert.deepEqual(a.parts[0].vertices,[[-3,-.1,0],[3,-.1,0],[3,-.1,4],[-3,-.1,4]]);assert.equal(JSON.stringify({original,overlay}),before);assert.deepEqual(a.approved_facade.slot,asset.approved_facade.slot);
const again=importApprovedFacadeDrafts(updated,[overlay],{origin:'http://127.0.0.1:4197'});assert.equal(again.assets.length,1);assert.equal(again.assets[0].facades.front,a.facades.front);assert.deepEqual(again.assets[0].size,[6,.2,4]);
const seoul=stationProject(stations[0]),legacy={id:'F02WL001-S01',name:'서울 기준 면',floor:'2F',position:[...stations[0].centre],size:[4,.1,3],heading:0,color:'#cccccc',hidden:false,source_record:true,source_id:'original-td',facades:{front:'https://example.test/original.png'}};seoul.assets=[legacy];
const legacyBefore=JSON.stringify(legacy),seoulDraft=importApprovedFacadeDrafts(seoul,[{...overlay,alias:legacy.id,floor:'2F',position:[...legacy.position]}],{origin:'http://127.0.0.1:4197'});assert.equal(seoulDraft.assets.length,1);assert.equal(seoulDraft.overlays.length,0);assert.equal(seoulDraft.assets[0].source_id,'original-td');assert.deepEqual(seoulDraft.assets[0].position,legacy.position);assert.equal(seoulDraft.assets[0].approved_facade,undefined);assert.equal(JSON.stringify(legacy),legacyBefore);
const bad=structuredClone(draft);bad.assets[0].approved_facade.slot=null;assert.throws(()=>validateProject(bad),/승인 기준/);
const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
const env={DB:d1Adapter(db)},call=(url,method='GET',body,cookie='')=>server.fetch(new Request('http://draft.test'+url,{method,headers:{Origin:'http://draft.test',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
try{
 const created=await call('/api/projects','POST',{project:updated});assert.equal(created.status,201);const saved=await created.json(),cookie=created.headers.get('set-cookie').split(';')[0],reloaded=await (await call('/api/projects/'+saved.id,'GET',null,cookie)).json();
 assert.deepEqual(reloaded.project.assets[0],updated.assets[0]);assert.equal(reloaded.project.overlays.length,0);assert.equal((await call('/api/projects/'+saved.id)).status,404);assert.equal(db.prepare('SELECT count(*) AS n FROM station_layers').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM facade_slots').get().n,0);
}finally{db.close();}
console.log('PASS: approved REG plane → editable private asset; center/base and heading/UV equivalence; resize/photo/save/reload; no duplicate Seoul asset/overlay, fake TD_ID or approved-source mutation');
