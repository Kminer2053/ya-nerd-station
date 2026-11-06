import {importApprovedFacadeDrafts} from '../src/approved-facade-drafts.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProjectLoading} from '../src/project-loading.js';
import {stationProject,sampleProject,validateProject,approvedImageReference} from '../src/model.js';
import {stations,stationOf} from '../src/stations.js';
import {adaptSeoulSnapshot} from '../src/seoul-snapshot.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const entries=source.slice(source.indexOf('// Project loading entrypoints'),source.indexOf('// End project loading entrypoints.'));
const projectUrl=source.split('\n').find(line=>line.startsWith('function projectUrl('));
const saving=source.slice(source.indexOf('async function save({'),source.indexOf("\n$('#saveProject').onclick"));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(initial=stationProject(stations.find(s=>s.id==='S201807'))){
 const calls=[],views=[],urls=[],notices=[],nodes=new Map(),location={origin:'http://editor.test',pathname:'/editor/',search:'?serviceOrigin=http%3A%2F%2F127.0.0.1%3A4210'};
 const api=(path,method='GET',body,options={})=>{const call={path,method,body,signal:options.signal,...deferred()};calls.push(call);return call.promise;};
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',value:initial.name,close(){}});return nodes.get(selector);};
 const history={replaceState(_a,_b,url){urls.push(url);location.search=new URL(url,'http://editor.test').search;}};
 const make=new Function('d',`
  const {createProjectLoading,stationProject,sampleProject,validateProject,approvedImageReference,importApprovedFacadeDrafts,stations,stationOf,adaptSeoulSnapshot,initial,api,$,history,location,views,notices}=d;
  let project=initial,projectId=null,revision=0,canEdit=true,shared=false,dirty=false,lastPick=null,selected=null,editVersion=0,pendingSceneProject=false;
  const projectLoading=createProjectLoading(()=>editVersion),scene={connect:async()=>{}},key=()=>'assets',record=()=>null;
  const render=()=>views.push({site:project.site_id,id:projectId}),status=()=>{},syncHeader=()=>{},notice=text=>notices.push(text),seoulOrigin=()=> 'http://127.0.0.1:4210';
  ${projectUrl}\n${entries}\n${saving}
  return {connectStation,openProject,importProject,newProject,save,state:()=>({project,projectId,revision,dirty}),edit(name){editVersion++;dirty=true;project.name=name;$('#projectName').value=name;}};
 `);
 return {...make({createProjectLoading,stationProject,sampleProject,validateProject,approvedImageReference,importApprovedFacadeDrafts,stations,stationOf,adaptSeoulSnapshot,initial,api,$,history,location,views,notices}),calls,views,urls,notices};
}
const empty={assets:[],overlays:[]},busan='S201807',gangneung='S201704',saved=(id,station)=>({id,revision:3,project:stationProject(stations.find(s=>s.id===station)),shared:false,canEdit:true});
// Deliberately ignore AbortSignal in the fake transport: a cancelled response
// can still arrive, and the real main.js entrypoints must reject it.
{
 const h=harness(),older=h.connectStation(busan),newer=h.connectStation(gangneung);assert.equal(h.calls[0].signal.aborted,true);
 h.calls[1].resolve(empty);await newer;h.calls[0].resolve(empty);await older;
 assert.equal(h.state().project.site_id,gangneung);assert.equal(h.views.length,1);assert.match(h.urls.at(-1),/station=S201704/);assert.match(h.urls.at(-1),/serviceOrigin=/);
}
{
 const h=harness(),older=h.connectStation(busan),newer=h.openProject('saved');h.calls[1].resolve(saved('saved',gangneung));await newer;h.calls[0].resolve(empty);await older;
 assert.equal(h.state().projectId,'saved');assert.equal(h.state().project.site_id,gangneung);assert.equal(h.views.length,1);
}
{
 const h=harness(),older=h.openProject('old'),text=deferred(),newer=h.importProject({size:100,text:()=>text.promise});text.resolve(JSON.stringify(stationProject(stations.find(s=>s.id===gangneung))));await newer;h.calls[0].resolve(saved('old',busan));await older;
 assert.equal(h.state().projectId,null);assert.equal(h.state().project.site_id,gangneung);assert.equal(h.state().dirty,true);assert.equal(h.views.length,1);
}
{
 const h=harness(),text=deferred(),older=h.importProject({size:100,text:()=>text.promise}),newer=h.newProject();h.calls[0].resolve(empty);await newer;text.resolve(JSON.stringify(stationProject(stations.find(s=>s.id===gangneung))));await older;
 assert.equal(h.state().project.site_id,busan);assert.equal(h.state().dirty,false);assert.equal(h.views.length,1);
}
{
 const h=harness(),pending=h.connectStation(gangneung);h.edit('이동 중 입력한 현재 초안');h.calls[0].resolve(empty);await pending;
 assert.equal(h.state().project.site_id,busan);assert.equal(h.state().project.name,'이동 중 입력한 현재 초안');assert.equal(h.state().dirty,true);assert.equal(h.views.length,0);assert.equal(h.urls.length,0);assert(h.notices.some(n=>n.includes('현재 초안을 유지')));
}
{
 const h=harness(),older=h.save({skipForm:true}),newer=h.openProject('new');h.calls[1].resolve(saved('new',gangneung));await newer;h.calls[0].resolve({id:'old-save',revision:0});assert.equal((await older).previous,true);
 assert.equal(h.state().projectId,'new');assert.equal(h.state().project.site_id,gangneung);
}
{
 const h=harness(),pending=h.save({skipForm:true});h.edit('저장 요청 후 추가 입력');h.calls[0].resolve({id:'saved',revision:0});await pending;
 assert.equal(h.state().project.name,'저장 요청 후 추가 입력');assert.equal(h.state().dirty,true);assert.equal(h.views.length,0,'A save response cannot rebuild and erase a newly edited form');
}
console.log('PASS: real editor entrypoints reject delayed station/project/JSON responses; new drafts cancel earlier loads; in-flight edits and later-project/save metadata stay intact');
