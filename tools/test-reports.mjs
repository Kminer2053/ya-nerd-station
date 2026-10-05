import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import server from '../server/index.js';
import {validateReportInput,validateStructure,structurePixels,nearest,ruleConfidence,PUBLIC_STATIONS,progressOf} from '../src/reports.js';
import {homography,applyH,warp,autoLevels,pixelate,defaultQuad,mapBox} from '../src/rectify.js';
import {parseAI,analyzeWithAI} from '../server/ai.js';
import {DAEJEON_CANDIDATES} from '../src/daejeon-candidates.js';
import {d1Adapter} from './sqlite-adapter.mjs';
import {initialStructure,structureSlot,resizeBlurs} from '../src/console/structure.js';
import {stationProject,validateProject} from '../src/model.js';
import {stations as stationDefinitions} from '../src/stations.js';

// Public reports → AI-assisted proposals → approver approval. Anyone reads the inbox; approvers sign in with a password.
// Seoul final approvals apply; anonymous direct project saves remain protected.
const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
const files=new Map(),env={DB:d1Adapter(db),UPLOADS:{async put(k,b){files.set(k,b);},async get(k){return files.has(k)?{body:files.get(k)}:null;}},APPROVERS:'테스트 승인자:correct-horse-9, 짧은비번:short'};
const BASE='https://station-one-collab.soalsebi.chatgpt.site';
// Two Seoul facade slots (위니비니, 카카오프렌즈) and their facilities, as the Station One service publishes them.
const S25=[126.970617779,37.553915771,38.074],S26=[126.97052748241022,37.55393451348953,38.07];
const facades={replacements:[
 {is_active:true,image_url:'/data/jury-frozen/images/weeny.png',replacement_width_px:175,replacement_height_px:176,current_store_name:'위니비니',slot:{slot_alias:'F02WL072-S25',floor:'2F',longitude:S25[0],latitude:S25[1],height_m:S25[2],camera_heading_deg:358.846,surface_width_m:3.16,surface_height_m:3.67,model_name:'F02WL072',td_id:'b0054',object_label:'F02WL072'}},
 {is_active:true,image_url:'/data/jury-frozen/images/kakao.png',replacement_width_px:340,replacement_height_px:86,current_store_name:'F02WL072',slot:{slot_alias:'F02WL072-S26',floor:'2F',longitude:S26[0],latitude:S26[1],height_m:S26[2],camera_heading_deg:4.89,surface_width_m:8,surface_height_m:2,model_name:'F02WL072',td_id:'b0054',object_label:'F02WL072'}}]};
const catalog={facilities:[{id:'DEST-F02WL072-S25',name:'위니비니',floor:'2F',source_id:'F02WL072-S25',access:[S25[0],S25[1]+.00002,36.19],store:{category:'잡화'}},{id:'DEST-F02WL072-S26',name:'카카오프렌즈',floor:'2F',source_id:'F02WL072-S26',reference:{lon:S26[0],lat:S26[1],height:S26[2]}}],
 endpoints:[{id:'OD-1',name:'KTX&일반열차',floor:'2F',geometry:{type:'Point',coordinates:[126.9709,37.5538,36.2]}}]};
let aiReply=null,aiCalls=0;
globalThis.fetch=async(url,opts)=>{
 if(url===BASE+'/data/jury-frozen/approved-facades.json')return new Response(JSON.stringify(facades));
 if(url===BASE+'/data/experience/catalog.json')return new Response(JSON.stringify(catalog));
 if(url==='https://api.anthropic.com/v1/messages'){aiCalls++;const b=JSON.parse(opts.body);assert.equal(b.messages[0].content[0].type,'image');return new Response(JSON.stringify({content:[{type:'text',text:aiReply}]}));}
 throw Error('unexpected fetch '+url);
};
const png=(w,h,extra=64)=>{const a=new Uint8Array(24+extra);a.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(a.buffer).setUint32(16,w);new DataView(a.buffer).setUint32(20,h);return a;};
const dataUrl=a=>'data:image/png;base64,'+Buffer.from(a).toString('base64');
const jpeg=(w,h)=>new Uint8Array([255,216,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,34,0,2,17,1,3,17,1,255,217]);
const jpegUrl=a=>'data:image/jpeg;base64,'+Buffer.from(a).toString('base64');
let cookie='';
const call=(path,{method='GET',body,raw,type,user,ip,jar=cookie,origin='http://toolkit.test',e=env}={})=>server.fetch(new Request('http://toolkit.test'+path,{method,headers:{Origin:origin,...(jar?{Cookie:jar}:{}),...(user?{'oai-authenticated-user-id':user}:{}),...(ip?{'CF-Connecting-IP':ip}:{}),...(raw?{'Content-Type':type||'image/png'}:body?{'Content-Type':'application/json'}:{})},...(raw?{body:raw}:body?{body:JSON.stringify(body)}:{})}),e);
const report=(o={})=>({station:'S202103',floor:'2F',position:[S25[0],S25[1]+.00003,36.2],view:{heading:180,pitch:-20},type:'facade',description:'지도엔 토니모리인데 지금은 위니비니예요',consent:true,...o});

// Input rules
assert.equal(PUBLIC_STATIONS.length,46,'46 KTX stations listed');
assert.throws(()=>validateReportInput(report({station:'S999999'})),/역을/);
assert.throws(()=>validateReportInput(report({consent:false})),/동의/);
assert.throws(()=>validateReportInput(report({position:[127.5,37.5,30]})),/위치/);
assert.throws(()=>validateReportInput(report({floor:'9F'})),/층/);
assert.equal(PUBLIC_STATIONS.filter(s=>s.connected).length,46,'all 46 stations verified against the VWorld indoor list');
assert.throws(()=>validateReportInput({station:'name:부산역',type:'new',consent:true,place_note:'대합실'}),/층|위치/,'a legacy name key resolves to the connected station: map position needed');
assert.equal(validateReportInput({station:'S201807',type:'new',consent:true,floor:'3F',position:[129.0423,35.11478,12.6]}).station_key,'S201807');
assert.equal(nearest([{floor:'2F',position:S25,heading:358.8}],[S25[0],S25[1]+.00003,36.2],'2F',12,180).distance<5,true,'facing slot matched');
assert(nearest([{floor:'2F',position:S25,heading:358.8}],[S25[0],S25[1]+.00003,36.2],'2F',12,0).distance>4,'looking away from the face costs 4 m');
assert.equal(ruleConfidence({slotDistance:3,duplicates:1,photos:2}),.8);

// Report → photos → submit (rules analysis: slot, facility, confidence)
assert.equal((await call('/api/reports',{method:'POST',body:report(),origin:'http://evil.test'})).status,403,'same-site writes only');
let res=await call('/api/reports',{method:'POST',body:report()});assert.equal(res.status,201);cookie=res.headers.get('set-cookie').split(';')[0];const first=(await res.json()).id;
assert.match(cookie,/^nerd-reporter=/);
assert.equal((await call('/api/reports/'+first+'/submit',{method:'POST',body:{}})).status,400,'a photo first');
assert.equal((await call('/api/reports/'+first+'/photos',{method:'POST',raw:new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25])})).status,400,'not an image');
assert.equal((await call('/api/reports/'+first+'/photos',{method:'POST',raw:png(1600,1200),jar:''})).status,403,'someone else');
res=await call('/api/reports/'+first+'/photos',{method:'POST',raw:png(1600,1200)});assert.equal(res.status,201);const firstUp=await res.json();assert.equal(firstUp.width,1600);
const firstPhoto=firstUp.id;
res=await call('/api/reports/'+first+'/photos',{method:'POST',raw:png(1200,1600)});const firstPhoto2=(await res.json()).id;
res=await call('/api/reports/'+first+'/submit',{method:'POST',body:{photos:[{id:firstPhoto,caption:'  간판이 위니비니로 바뀌었어요  ',mark:[.42,.31],preview:jpegUrl(jpeg(48,36))},{id:firstPhoto2,caption:'x'.repeat(300),mark:[2,-1],preview:jpegUrl(jpeg(640,480))},{id:'00000000-0000-4000-8000-000000000000',caption:'not mine'}]}});
assert.equal(res.status,202);assert.equal((await res.json()).status,'review');
let notes=db.prepare('SELECT id,caption,mark,preview_size FROM report_photos WHERE report_id=? ORDER BY created_at').all(first);
assert.equal(notes[0].caption,'간판이 위니비니로 바뀌었어요');assert.deepEqual(JSON.parse(notes[0].mark),[.42,.31]);assert(notes[0].preview_size>0,'mosaic stored');
assert.equal(notes[1].caption.length,120,'caption capped');assert.equal(notes[1].mark,null,'mark outside the photo dropped');assert.equal(notes[1].preview_size,null,'large preview refused');
assert.equal((await call('/api/reports/'+first+'/photos',{method:'POST',raw:png(10,10)})).status,409,'no photos after submit');
let row=db.prepare('SELECT * FROM reports WHERE id=?').get(first),a=JSON.parse(row.analysis);
assert.equal(a.mode,'rules');assert.equal(a.slot.alias,'F02WL072-S25');assert.equal(a.slot.name,'위니비니');assert(a.slot.distance<5);assert.deepEqual(a.slot.px,[175,176]);
assert.equal(a.facility.name,'위니비니');assert.equal(a.suggestion.kind,'facade');assert.equal(a.group.size,1);assert(a.confidence>=.7,'close slot + 2 photos');
assert.deepEqual(JSON.parse(row.history).map(h=>h.status),['received','analyzing','review']);
// Same place, same type → one group
res=await call('/api/reports',{method:'POST',body:report({description:'간판이 위니비니로 바뀌었어요'})});const second=(await res.json()).id;
await call('/api/reports/'+second+'/photos',{method:'POST',raw:png(800,600)});await call('/api/reports/'+second+'/submit',{method:'POST',body:{}});
a=JSON.parse(db.prepare('SELECT analysis FROM reports WHERE id=?').get(second).analysis);assert.equal(a.group.id,first);assert.equal(a.group.size,2);
// My reports: only mine, photos visible only to me and approvers
let mine=(await (await call('/api/reports/mine')).json()).reports;assert.equal(mine.length,2);assert.equal(mine[0].status_label,'검토 대기');
assert.equal((await (await call('/api/reports/mine',{jar:''})).json()).reports.length,0);
const mineFirst=mine.find(r=>r.id===first),photo=mineFirst.photos[0].id;
assert.equal(mineFirst.photos[0].caption,'간판이 위니비니로 바뀌었어요');assert.match(mineFirst.photos[0].src,/\/api\/reports\/photos\//);assert.deepEqual(mineFirst.progress,{at:2,state:'active',bucket:'review'});
assert.equal((await call('/api/reports/photos/'+photo)).status,200);assert.equal((await call('/api/reports/photos/'+photo,{jar:''})).status,404);

// Report inbox: anyone reads (mosaics, not originals); processing needs an approver session
let inbox=await (await call('/api/console/reports',{jar:''})).json();assert.equal(inbox.reports.length,2);assert.equal(inbox.reports[0].slot.alias,'F02WL072-S25');assert.equal(inbox.approver,null);
assert.equal(inbox.summary.review,2);assert.equal(inbox.summary.all,2);assert.match(inbox.reports.find(r=>r.id===first).cover,/report-previews/);
let pub=await (await call('/api/console/reports/'+first,{jar:''})).json();
assert.equal(pub.report.originals,false);assert.equal(pub.report.photos[0].src,null,'no original for the public');assert.match(pub.report.photos[0].preview,/report-previews/);assert.equal(pub.report.photos[0].caption,'간판이 위니비니로 바뀌었어요');
assert.equal((await call(pub.report.photos[0].preview,{jar:''})).status,200,'mosaic is public');assert.equal((await call('/api/public/report-previews/'+firstPhoto2,{jar:''})).status,404,'no mosaic stored');
assert.equal((await call('/api/reports/photos/'+photo,{jar:''})).status,404,'original stays private');
assert.equal((await call('/api/console/reports/'+first+'/decision',{jar:'',method:'POST',body:{status:'held',reason:'x'}})).status,401,'acting needs an approver');
assert.equal((await call('/api/console/proposals',{jar:'',method:'POST',body:{}})).status,401);
assert.equal((await (await call('/api/session',{jar:''})).json()).approvers_configured,true);
// Password sign-in: wrong passwords are counted per address, short passwords are not accounts
assert.equal((await call('/api/console/login',{jar:'',method:'POST',body:{name:'짧은비번',password:'short'},ip:'10.0.0.9'})).status,401,'passwords under 8 characters are ignored');
for(let i=0;i<4;i++)assert.equal((await call('/api/console/login',{jar:'',method:'POST',body:{name:'테스트 승인자',password:'wrong-'+i},ip:'10.0.0.9'})).status,401);
assert.equal((await call('/api/console/login',{jar:'',method:'POST',body:{name:'테스트 승인자',password:'correct-horse-9'},ip:'10.0.0.9'})).status,429,'five failures lock the address');
assert.equal((await call('/api/console/login',{jar:'',method:'POST',body:{name:'테스트 승인자',password:'correct-horse-9'},origin:'http://evil.test'})).status,403);
res=await call('/api/console/login',{jar:'',method:'POST',body:{name:'테스트 승인자',password:'correct-horse-9'},ip:'10.0.0.1'});assert.equal(res.status,200);
const approverCookie=res.headers.get('set-cookie').split(';')[0];assert.match(approverCookie,/^nerd-approver=[a-f0-9]{64}$/);assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
assert.equal(db.prepare('SELECT count(*) AS n FROM approver_sessions WHERE token_hash=?').get(approverCookie.slice(14)).n,0,'only a hash of the token is stored');
const amb={jar:approverCookie};
assert.equal((await (await call('/api/session',amb)).json()).approver,'테스트 승인자');
let list=(await (await call('/api/console/reports',amb)).json()).reports;assert.equal(list.length,2);
assert.equal((await call('/api/reports/photos/'+photo,amb)).status,200,'approvers see originals');
const detail=await (await call('/api/console/reports/'+first,amb)).json();assert.equal(detail.report.photos.length,2);assert.equal(detail.report.originals,true);assert.equal(detail.locked,false);assert.equal(detail.group.length,1);
// Facade proposal: slot size enforced, public only after approval
assert.equal((await call('/api/console/proposals',{...amb,method:'POST',body:{report_id:first,kind:'facade',target:{alias:'F02WL072-S25'},image:dataUrl(png(200,200))}})).status,400,'slot pixel size');
assert.equal((await call('/api/console/proposals',{...amb,method:'POST',body:{report_id:first,kind:'structure',target:{alias:'F02WL072-S25'},image:dataUrl(png(175,176))}})).status,400,'structure requires a new-structure report');
res=await call('/api/console/proposals',{...amb,method:'POST',body:{report_id:first,kind:'facade',target:{alias:'F02WL072-S25'},image:dataUrl(png(175,176)),meta:{quad:[[1,2],[3,4],[5,6],[7,8]],levels:true,by:'approver'}}});
assert.equal(res.status,201);const proposal=(await res.json()).id;
inbox=await (await call('/api/console/reports?stage=proposed',{jar:''})).json();assert.deepEqual(inbox.reports.map(r=>r.id),[first],'a ready proposal moves the report to 제안 승인 대기');assert.equal(inbox.summary.proposed,1);
pub=await (await call('/api/console/reports/'+first,{jar:''})).json();assert.equal(pub.proposals[0].image,null,'unapproved proposal image stays with approvers');assert.equal(pub.report.progress.at,3);
assert.equal((await call('/api/public/proposal-images/'+proposal,{jar:''})).status,404,'not public before approval');
assert.equal((await call('/api/console/proposals/'+proposal+'/reject',{...amb,method:'POST',body:{}})).status,400,'reject needs a reason');
res=await call('/api/console/proposals/'+proposal+'/approve',{...amb,method:'POST',body:{}});const approved=await res.json();
assert.equal(approved.status,'applied','Seoul final approval applies immediately');assert.match(approved.note,/지도에 반영/);
assert.equal((await call('/api/console/proposals/'+proposal+'/approve',{...amb,method:'POST',body:{}})).status,409);
assert.equal((await call('/api/public/proposal-images/'+proposal,{jar:''})).status,200);
assert.equal(db.prepare('SELECT count(*) AS n FROM station_layers').get().n,1,'approved Seoul layer saved');
assert.deepEqual([first,second].map(id=>db.prepare('SELECT status FROM reports WHERE id=?').get(id).status),['applied','applied'],'the whole group follows');
inbox=await (await call('/api/console/reports?stage=applied',{jar:''})).json();assert.equal(inbox.reports.length,2);assert.equal(inbox.summary.applied,2);assert.equal(inbox.summary.review,0);
pub=await (await call('/api/console/reports/'+first,{jar:''})).json();assert.match(pub.proposals[0].image,/\/api\/public\/proposal-images\//,'approved image is public');assert.equal(pub.proposals[0].reviewer,null);assert.deepEqual(pub.report.progress,{at:5,state:'done',bucket:'applied'});
const station=await (await call('/api/public/station?key=S202103',{jar:''})).json();
assert.equal(station.station.locked,false);assert.equal(station.overlays.length,1);assert.equal(station.overlays[0].alias,'F02WL072-S25');assert.equal(station.overlays[0].image,'/api/public/proposal-images/'+proposal);
assert.equal(station.changes.length,1);assert.equal(station.changes[0].name,'위니비니');assert.equal(station.changes[0].status_label,'반영');assert.equal(station.facilities.length,2);assert.equal(station.endpoints.length,1);
const stationsList=(await (await call('/api/public/stations',{jar:''})).json()).stations;assert.equal(stationsList.find(s=>s.key==='S202103').changes,1);
// Other decisions need a reason the reporter can read
res=await call('/api/reports',{method:'POST',body:report({type:'blocked',position:[126.9709,37.5537,36.2],description:'공사 중'})});const third=(await res.json()).id;
await call('/api/reports/'+third+'/photos',{method:'POST',raw:png(640,480)});await call('/api/reports/'+third+'/submit',{method:'POST',body:{}});
assert.equal((await call('/api/console/reports/'+third+'/decision',{...amb,method:'POST',body:{status:'rejected'}})).status,400);
await call('/api/console/reports/'+third+'/decision',{...amb,method:'POST',body:{status:'held',reason:'공사 기간을 확인 중이에요'}});
mine=(await (await call('/api/reports/mine')).json()).reports;assert.equal(mine.find(r=>r.id===third).reason,'공사 기간을 확인 중이에요');
assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action NOT LIKE 'approver.%'").get().n,3,'create, queue, hold audited');
assert.equal(db.prepare("SELECT actor FROM audit_log WHERE action='proposal.create'").get().actor,'테스트 승인자','actions carry the approver name');
// Rejected reports: the reason stays visible, the content does not
res=await call('/api/reports',{method:'POST',body:report({type:'other',position:[126.9709,37.5536,36.2],description:'광고 문구'})});const spam=(await res.json()).id;
await call('/api/reports/'+spam+'/photos',{method:'POST',raw:png(640,480)});await call('/api/reports/'+spam+'/submit',{method:'POST',body:{}});
await call('/api/console/reports/'+spam+'/decision',{...amb,method:'POST',body:{status:'rejected',reason:'지도와 관계없는 내용이에요'}});
pub=await (await call('/api/console/reports/'+spam,{jar:''})).json();assert.equal(pub.report.hidden,true);assert.equal(pub.report.description,'');assert.equal(pub.report.photos.length,0);assert.equal(pub.report.reason,'지도와 관계없는 내용이에요');
assert.equal((await (await call('/api/console/reports/'+spam,amb)).json()).report.description,'광고 문구','approvers still read it');
inbox=await (await call('/api/console/reports?stage=closed',{jar:''})).json();assert.equal(inbox.reports[0].description,'');assert.equal(inbox.summary.closed,1);assert.equal(inbox.summary.held,1);
// Sign-out ends the session
await call('/api/console/logout',{...amb,method:'POST',body:{}});assert.equal((await (await call('/api/session',amb)).json()).approver,null);
assert.equal((await call('/api/console/reports/'+third+'/decision',{...amb,method:'POST',body:{status:'review'}})).status,401);
assert.equal(progressOf('held','ready').at,3);assert.equal(progressOf('duplicate').state,'closed');assert.equal(progressOf('applied').state,'done');
// A newly connected station (VWorld list): map position, no facade slots registered yet
res=await call('/api/reports',{method:'POST',body:{station:'S201807',type:'new',consent:true,floor:'3F',position:[129.0423,35.11478,12.6],description:'대합실에 새 매장'}});const busan=(await res.json()).id;
await call('/api/reports/'+busan+'/photos',{method:'POST',raw:png(640,480)});res=await call('/api/reports/'+busan+'/submit',{method:'POST',body:{}});
assert.equal((await res.json()).status,'review');assert.equal(JSON.parse(db.prepare('SELECT analysis FROM reports WHERE id=?').get(busan).analysis).slot,null);
// Daily limit per reporter
for(let i=0;i<5;i++)assert.equal((await call('/api/reports',{method:'POST',body:report()})).status,201);
assert.equal((await call('/api/reports',{method:'POST',body:report()})).status,429,'10 reports a day');

// Daejeon: candidate register from the VWorld texture review; not locked, so an approved facade is applied and drawn
const D=DAEJEON_CANDIDATES,ids=new Set(D.facilities.map(f=>f.id));
assert(D.slots.length>=30&&D.facilities.length>=60,'reviewed candidates bundled');assert.equal(ids.size,D.facilities.length,'unique ids');
for(const sl of D.slots){assert(ids.has(sl.facility_id));assert(sl.px.every(n=>Number.isInteger(n)&&n>0));assert.equal(sl.image,null,'no VWorld texture redistributed');}
for(const f of D.facilities){assert.equal(f.verified,false);assert(['1F','2F','3F','4F','5F','RF'].includes(f.floor));assert(f.basis&&f.slots.length);if(f.kind==='store'&&!f.named)assert.match(f.name,/매장 후보/,'unread signs stay unnamed');}
const lohbs=D.slots.find(x=>x.facility_id==='DJ-S-LOHBS'),lohbsAt=D.facilities.find(f=>f.id==='DJ-S-LOHBS').position;
const cookie3='nerd-reporter=22222222-2222-4222-8222-222222222222';
let dj=await (await call('/api/public/station?key=S201801',{jar:''})).json();
assert.match(dj.note,/간판을 읽어 만든 후보/);assert.equal(dj.facilities.length,D.facilities.length);assert(dj.facilities.some(f=>f.kind==='group'));assert.deepEqual(dj.overlays,[]);
res=await call('/api/reports',{method:'POST',body:{station:'S201801',floor:lohbs.floor,position:lohbsAt,view:{heading:(lohbs.heading+180)%360,pitch:-10},type:'facade',description:'롭스 자리가 바뀌었어요',consent:true},jar:cookie3});const djReport=(await res.json()).id;
await call('/api/reports/'+djReport+'/photos',{method:'POST',raw:png(1600,1200),jar:cookie3});await call('/api/reports/'+djReport+'/submit',{method:'POST',body:{},jar:cookie3});
a=JSON.parse(db.prepare('SELECT analysis FROM reports WHERE id=?').get(djReport).analysis);assert.equal(a.slot.alias,lohbs.alias,'Daejeon report matches the storefront slot');assert.equal(a.facility.id,'DJ-S-LOHBS');
res=await call('/api/console/login',{jar:'',method:'POST',body:{name:'테스트 승인자',password:'correct-horse-9'},ip:'10.0.0.2'});const amb2={jar:res.headers.get('set-cookie').split(';')[0]};
assert.equal((await call('/api/console/proposals',{...amb2,method:'POST',body:{report_id:djReport,kind:'facade',target:{alias:lohbs.alias},image:dataUrl(png(100,100))}})).status,400,'Daejeon slot size enforced');
res=await call('/api/console/proposals',{...amb2,method:'POST',body:{report_id:djReport,kind:'facade',target:{alias:lohbs.alias},image:dataUrl(png(...lohbs.px))}});const djProposal=(await res.json()).id;
const djApproved=await (await call('/api/console/proposals/'+djProposal+'/approve',{...amb2,method:'POST',body:{}})).json();assert.equal(djApproved.status,'applied','unlocked station applies');assert.match(djApproved.note,/반영됐어요/);
assert.equal(JSON.parse(db.prepare("SELECT body FROM station_layers WHERE station_key='S201801'").get().body).facades[lohbs.alias].proposal,djProposal);
dj=await (await call('/api/public/station?key=S201801',{jar:''})).json();assert.equal(dj.overlays.length,1);assert.equal(dj.overlays[0].alias,lohbs.alias);assert.deepEqual(dj.overlays[0].surface,lohbs.surface);assert.match(dj.overlays[0].image,/proposal-images/);
assert.equal(dj.changes[0].before,null);assert.equal((await call(dj.overlays[0].image,{jar:''})).status,200);
assert.equal(db.prepare('SELECT status FROM reports WHERE id=?').get(djReport).status,'applied');assert.deepEqual((await (await call('/api/console/reports/'+djReport,{jar:''})).json()).report.progress,{at:5,state:'done',bucket:'applied'});

// Import of facades approved in the retired Supabase workbench: approver-only, exact size, idempotent, drawn from its own geometry
res=await call('/api/public/station?key=S201801',{jar:''});assert.equal(res.headers.get('access-control-allow-origin'),'*','public reads open to other sites');
assert.equal((await call(dj.overlays[0].image,{jar:''})).headers.get('access-control-allow-origin'),'*','approved images usable as cross-site textures');
const imp={station_key:'S201801',slot:{alias:'F01_WL01-S99',name:'가져온 파사드',floor:'1F',position:[127.4349,36.3320,57.2],heading:90,surface:[3.2,2.4],px:[320,240]},image:dataUrl(png(320,240)),source:{kind:'supabase',id:'sb-version-1',approved_at:'2026-09-10T00:00:00Z',store_name:'테스트 매장'}};
assert.equal((await call('/api/console/import-facade',{jar:'',method:'POST',body:imp})).status,401);
assert.equal((await call('/api/console/import-facade',{...amb2,method:'POST',body:{...imp,slot:{...imp.slot,position:[127.9,36.3,57]}}})).status,400,'outside the station');
assert.equal((await call('/api/console/import-facade',{...amb2,method:'POST',body:{...imp,image:dataUrl(png(300,240))}})).status,400,'exact slot size');
assert.equal((await call('/api/console/import-facade',{...amb2,method:'POST',body:{...imp,station_key:'S202103'}})).status,400,'Seoul import still requires valid station coordinates');
res=await call('/api/console/import-facade',{...amb2,method:'POST',body:imp});assert.equal(res.status,201);const imported=(await res.json()).id;
const again=await (await call('/api/console/import-facade',{...amb2,method:'POST',body:imp})).json();assert.equal(again.skipped,true);assert.equal(again.id,imported,'same source id imported once');
dj=await (await call('/api/public/station?key=S201801',{jar:''})).json();const io=dj.overlays.find(o=>o.alias==='F01_WL01-S99');
assert.deepEqual([io.floor,io.heading,io.px,io.surface],['1F',90,[320,240],[3.2,2.4]]);assert.equal(io.name,'가져온 파사드');assert(dj.changes.some(c=>c.alias==='F01_WL01-S99'));
assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='facade.import'").get().n,1);

// AI step: strict parsing, used when configured, dropped when malformed
aiReply=JSON.stringify({change_type:'facade',signage_text:'Weeny Beeny',same_as_registered:false,storefront_quad:{photo:0,points:[[.1,.2],[.9,.18],[.92,.8],[.08,.82]]},people:[{photo:0,box:[.4,.5,.1,.3]},{photo:7,box:[0,0,.1,.1]}],quality:{sharp:true,lit:true,frontal:false},confidence:.9,summary:'간판이 위니비니로 바뀌었습니다.'});
const parsed=parseAI('```json\n'+aiReply+'\n```',2);assert.equal(parsed.signage_text,'Weeny Beeny');assert.equal(parsed.people.length,1,'box on a missing photo dropped');assert.equal(parsed.storefront_quad.points[1][0],.9);
assert.throws(()=>parseAI('사진을 볼 수 없어요',1));
assert.equal(await analyzeWithAI({},{photos:[],report:{},slot:null,facility:null}),null,'no key: no AI call');
const aiEnv={...env,AI_API_KEY:'test'},cookie2='nerd-reporter=11111111-1111-4111-8111-111111111111';
res=await call('/api/reports',{method:'POST',body:report({position:[S26[0],S26[1]+.00003,36.2],description:'카카오프렌즈 간판'}),jar:cookie2,e:aiEnv});const withAi=(await res.json()).id;
await call('/api/reports/'+withAi+'/photos',{method:'POST',raw:png(1600,1200),jar:cookie2,e:aiEnv});await call('/api/reports/'+withAi+'/submit',{method:'POST',body:{},jar:cookie2,e:aiEnv});
a=JSON.parse(db.prepare('SELECT analysis FROM reports WHERE id=?').get(withAi).analysis);
assert.equal(a.mode,'ai');assert.equal(aiCalls,1);assert.equal(a.slot.alias,'F02WL072-S26');assert.equal(a.slot.name,'카카오프렌즈','slot named after the registered facility');assert.equal(a.ai.signage_text,'Weeny Beeny');assert(a.confidence>=.75&&a.confidence<=.9,'rules 40% + AI 60%');
aiReply='not json';res=await call('/api/reports',{method:'POST',body:report(),jar:cookie2,e:aiEnv});const badAi=(await res.json()).id;
await call('/api/reports/'+badAi+'/photos',{method:'POST',raw:png(640,480),jar:cookie2,e:aiEnv});await call('/api/reports/'+badAi+'/submit',{method:'POST',body:{},jar:cookie2,e:aiEnv});
a=JSON.parse(db.prepare('SELECT analysis FROM reports WHERE id=?').get(badAi).analysis);assert.equal(a.mode,'rules');assert.match(a.notes.join(' '),/AI:/,'falls back to rules with a note');

// Rectification: exact corners, straight sampling, levels, pixelation, box mapping
const src=[[120,80],[520,110],[500,400],[90,380]],H=homography([[0,0],[175,0],[175,176],[0,176]],src);
for(const [i,pt] of [[0,0],[175,0],[175,176],[0,176]].entries()){const q=applyH(H,pt);assert(Math.hypot(q[0]-src[i][0],q[1]-src[i][1])<1e-6);}
const W=40,Hh=30,img={width:W,height:Hh,data:new Uint8ClampedArray(W*Hh*4)};for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const o=(y*W+x)*4;img.data.set([x*6,y*8,128,255],o);}
const out=warp(img,[[10,5],[30,5],[30,25],[10,25]],20,20);
assert(Math.abs(out.data[(10*20+10)*4]-(20*6))<=6&&Math.abs(out.data[(10*20+10)*4+1]-(15*8))<=8,'axis-aligned quad samples the same pixels');
const lv=autoLevels({width:2,height:1,data:new Uint8ClampedArray([60,60,60,255,120,120,120,255])},0);assert.equal(lv.data[0],0);assert.equal(lv.data[4],255);
const px=pixelate({width:8,height:8,data:new Uint8ClampedArray(8*8*4).map((_,i)=>i%4===3?255:i%251)},[0,0,8,8],8);assert(px.data.every((v,i)=>v===px.data[i%4]),'one block, one colour');
const dq=defaultQuad(1600,1200,175/176);assert(Math.abs((dq[1][0]-dq[0][0])/(dq[3][1]-dq[0][1])-175/176)<1e-9);
const mb=mapBox([[0,0],[100,0],[100,50],[0,50]],200,100,[10,10,20,10]);assert.deepEqual(mb.map(n=>Math.round(n)),[20,20,40,20]);
// New structure: adoption, immutable versioned drafts, human checks, atomic approval and public rendering data.
const post=(path,body,extra={})=>call(path,{...amb2,...extra,method:'POST',body});
const fresh=async(station='S202103',offset=0)=>{const seoul=station==='S202103',position=seoul?[126.9708+offset,37.5537,36.19]:[129.0423+offset,35.11478,12.6],floor=seoul?'2F':'3F',jar='nerd-reporter='+crypto.randomUUID();
 const created=await call('/api/reports',{method:'POST',jar,body:{station,type:'new',consent:true,floor,position,description:'테스트용 키오스크'}});assert.equal(created.status,201);const id=(await created.json()).id;
 const up=await call('/api/reports/'+id+'/photos',{method:'POST',jar,raw:png(640,480)}),photo=(await up.json()).id;await call('/api/reports/'+id+'/submit',{method:'POST',jar,body:{}});
 return {id,photo,station,floor,position};};
const draftInput=f=>({report_id:f.id,report_version:db.prepare('SELECT updated_at FROM reports WHERE id=?').get(f.id).updated_at,kind:'structure',target:{structure:{name:'AI역무원',floor:f.floor,position:f.position,size:[1,.6,2],heading:180,color:'#a9b6b0',dimension_basis:'estimated'}},image:dataUrl(png(512,1024)),meta:{photo:f.photo,quad:[[10,10],[630,10],[630,470],[10,470]],levels:true,blurs:[]}});
const accept=f=>post('/api/console/reports/'+f.id+'/decision',{status:'accepted'});
const checks={geometry_checked:true,privacy_checked:true,preview_checked:true};
const ready=async id=>{const out=await post('/api/console/proposals/'+id+'/ready',checks);assert.equal(out.status,200,await out.text());};
const f=await fresh(),input=draftInput(f);
assert.equal((await post('/api/console/proposals',input)).status,409,'adoption first');
assert.equal((await accept(f)).status,200);input.report_version=draftInput(f).report_version;
assert.equal((await post('/api/console/proposals',input,{jar:''})).status,401);
assert.equal((await post('/api/console/proposals',input,{origin:'https://evil.test'})).status,403);
assert.equal((await post('/api/console/proposals',{...input,meta:{...input.meta,photo:firstPhoto}})).status,400,'cannot use another report photo');
assert.equal((await post('/api/console/proposals',{...input,image:dataUrl(png(511,1024))})).status,400,'exact derived pixels');
assert.deepEqual(structurePixels([1,.6,2]),[512,1024]);
assert.deepEqual(resizeBlurs([[700,500,100,100]],[1024,1024],[512,1024]),[[350,500,50,100]],'face blur stays on the same face after resize');
const geom=initialStructure({station_key:'S202103',floor:'2F',position:[126.9708,37.5537,36.19],photos:[],view:{heading:0}},null);assert.equal(geom.heading,0);assert.equal(structureSlot(geom).heading,180,'photo and box face point toward camera');
for(const invalid of [{size:[0,1,2]},{size:[1,1,31]},{floor:'99F'},{position:[129,37,20]},{heading:null},{color:'url(x)'},{dimension_basis:'auto'}])assert.throws(()=>validateStructure({...input.target.structure,...invalid},f.station));
res=await post('/api/console/proposals',input);assert.equal(res.status,201);const oldDraft=(await res.json()).id;
assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(oldDraft).status,'draft');
assert.equal((await post('/api/console/proposals/'+oldDraft+'/approve',{})).status,409,'draft cannot approve');
assert.equal((await post('/api/console/proposals/'+oldDraft+'/ready',{})).status,400,'explicit human checks');
assert.equal((await call('/api/public/proposal-images/'+oldDraft,{jar:''})).status,404);
assert.deepEqual((await (await call('/api/public/station?key=S202103',{jar:''})).json()).assets,[],'unapproved Seoul structure is not public');
pub=await (await call('/api/console/reports/'+f.id,{jar:''})).json();assert.equal(pub.proposals[0].image,null);assert.equal(pub.proposals[0].meta,null);assert.equal(pub.report.progress.bucket,'draft');
assert.equal((await post('/api/console/proposals',input)).status,409,'stale draft version');
const edit=draftInput(f),saves=await Promise.all([post('/api/console/proposals',edit),post('/api/console/proposals',edit)]);
assert.deepEqual(saves.map(r=>r.status).sort(),[201,409],'one winner for concurrent saves');
const draft=(await saves.find(r=>r.status===201).json()).id;
assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(oldDraft).status,'superseded');
await ready(draft);
await post('/api/console/reports/'+f.id+'/decision',{status:'review'});assert.equal((await post('/api/console/proposals/'+draft+'/approve',{})).status,409,'new structure must remain adopted');await accept(f);
assert.equal((await (await call('/api/console/reports/'+f.id,amb2)).json()).report.progress.bucket,'proposed');
const approvals=await Promise.all([post('/api/console/proposals/'+draft+'/approve',{}),post('/api/console/proposals/'+draft+'/approve',{})]);
assert.deepEqual(approvals.map(r=>r.status).sort(),[200,409],'double approval once');
assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(draft).status,'applied');
assert.equal(db.prepare("SELECT count(*) AS n FROM station_layers WHERE station_key='S202103'").get().n,1,'Seoul approved layer active');
const seoulApproved=await (await call('/api/public/station?key=S202103')).json();assert.equal(seoulApproved.assets.length,1);assert.equal(seoulApproved.assets[0].proposal,draft);assert.equal(seoulApproved.station.locked,false);assert.equal(seoulApproved.overlays.length,1,'new structure preserves approved facade');
assert.equal((await post('/api/console/reports/'+f.id+'/decision',{status:'review'})).status,409,'approved report cannot reopen');
// Rejected/held reports cannot approve an old ready proposal.
const held=await fresh('S201807');await accept(held);const hd=(await (await post('/api/console/proposals',draftInput(held))).json()).id;await ready(hd);
await post('/api/console/reports/'+held.id+'/decision',{status:'held',reason:'현장 확인 필요'});
assert.equal((await post('/api/console/proposals/'+hd+'/approve',{})).status,409);
await accept(held);
// Failure injection proves no half-applied structure/proposal/report survives a failed batch.
db.exec("CREATE TEMP TRIGGER block_layer BEFORE INSERT ON station_layers BEGIN SELECT RAISE(ABORT,'test layer failure'); END");
assert.equal((await post('/api/console/proposals/'+hd+'/approve',{})).status,400);
assert.equal(db.prepare('SELECT status FROM proposals WHERE id=?').get(hd).status,'ready');assert.equal(db.prepare('SELECT status FROM reports WHERE id=?').get(held.id).status,'accepted');
db.exec('DROP TRIGGER block_layer');
const secondStructure=await fresh('S201807',.0003);await accept(secondStructure);const sd=(await (await post('/api/console/proposals',draftInput(secondStructure))).json()).id;await ready(sd);
const both=await Promise.all([post('/api/console/proposals/'+hd+'/approve',{}),post('/api/console/proposals/'+sd+'/approve',{})]);assert(both.every(r=>r.status===200),'two approvals succeed');
const busanLayer=db.prepare("SELECT body,revision FROM station_layers WHERE station_key='S201807'").get();assert.equal(Object.keys(JSON.parse(busanLayer.body).assets).length,2);assert.equal(busanLayer.revision,2,'both merge without lost update');
const publicAssets=(await (await call('/api/public/station?key=S201807',{jar:''})).json()).assets;assert.equal(publicAssets.length,2);assert(publicAssets.every(a=>a.facades.front.startsWith('/api/public/proposal-images/')));assert.equal((await call(publicAssets[0].facades.front,{jar:''})).status,200);
assert.doesNotThrow(()=>validateProject({...stationProject(stationDefinitions.find(s=>s.id==='S201807')),assets:publicAssets}),'applied structures remain editable in an independent project');
// Nearby is not synonymous with duplicate: one approved structure does not close a neighbour.
const nearA=await fresh('S201807',.0007),nearB=await fresh('S201807',.00071);await accept(nearA);await accept(nearB);
const nearDraft=(await (await post('/api/console/proposals',draftInput(nearA))).json()).id;await ready(nearDraft);assert.equal((await post('/api/console/proposals/'+nearDraft+'/approve',{})).status,200);
assert.equal(db.prepare('SELECT status FROM reports WHERE id=?').get(nearB.id).status,'accepted','neighbour is still pending');
console.log('PASS: public reports regression + new structure adoption/draft/reload/version conflict, input/photo validation, private draft, explicit human checks, concurrent saves and approvals, Seoul approved map application, held-source guard, transaction rollback and public applied assets');
