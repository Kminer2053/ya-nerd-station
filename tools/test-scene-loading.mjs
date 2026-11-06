import assert from 'node:assert/strict';
import {stations,stationOf} from '../src/stations.js';
import {stationProject,validateProject} from '../src/model.js';
import {stationTileSources,openTileset,firstRenderedTile} from '../src/scene-loading.js';
class Event{listeners=new Set();addEventListener(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}raise(value){for(const fn of this.listeners)fn(value);}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
assert.equal(stations.length,46);assert.equal(new Set(stations.map(s=>s.id)).size,46);
for(const s of stations){const p=stationProject(s),urls=stationTileSources(s,{hostname:'127.0.0.1'});assert.equal(stationOf(p).id,s.id);assert.equal(validateProject(p).site_id,s.id);assert.ok(s.floors.includes(s.default_floor));for(const f of s.floors)assert.ok(Number.isFinite(s.heights[f]));assert.ok(urls.some(v=>v.url.endsWith('/'+s.id+'/tileset.json')));assert.ok(urls.some(v=>v.url==='/api/map-source/'+s.id+'/tileset.json'));assert.equal(urls[0].url.startsWith('/local-tiles'),s.id==='S201801');}
assert.throws(()=>stationTileSources({id:'../../other'}));
let lateResolve,destroyed=0;const C={Cesium3DTileset:{fromUrl:()=>new Promise(resolve=>lateResolve=resolve)}};
await assert.rejects(openTileset(C,'test',{timeout:2}),/지연/);lateResolve({destroy(){destroyed++;}});await tick();assert.equal(destroyed,1,'timed-out metadata never attaches a late tileset');
const abort=new AbortController();const aborted=openTileset(C,'abort',{signal:abort.signal});await tick();abort.abort();await assert.rejects(aborted,{name:'AbortError'});lateResolve({destroy(){destroyed++;}});await tick();assert.equal(destroyed,2);
const tile={tileVisible:new Event(),tileFailed:new Event()},viewer={scene:{postRender:new Event(),requestRender(){}}};let displayed=false;
const visible=firstRenderedTile(viewer,tile,{timeout:1000}).then(()=>displayed=true);viewer.scene.postRender.raise();await tick();assert.equal(displayed,false,'metadata and an empty render are not a visible model');tile.tileVisible.raise();await tick();assert.equal(displayed,false,'tileVisible alone precedes completed rendering');viewer.scene.postRender.raise();await visible;assert.equal(displayed,true);assert.equal(tile.tileVisible.listeners.size+tile.tileFailed.listeners.size+viewer.scene.postRender.listeners.size,0);
const cancelled=new AbortController(),pending=firstRenderedTile(viewer,tile,{signal:cancelled.signal});cancelled.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(tile.tileVisible.listeners.size+viewer.scene.postRender.listeners.size,0,'station switching removes render listeners');
const failed=firstRenderedTile(viewer,tile,{timeout:2});tile.tileFailed.raise({message:'source b3dm unavailable'});await assert.rejects(failed,/source b3dm unavailable/);assert.equal(tile.tileFailed.listeners.size,0);
console.log('PASS: all 46 registry/source mappings, first completed tile render, timeout/abort late destruction and listener cleanup.');
