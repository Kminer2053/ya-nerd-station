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
console.log('PASS: Seoul full snapshot, N:N elevator stops, route references, source immutability');
