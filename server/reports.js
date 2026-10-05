// Public reports and the report inbox API.
// Anyone can report (a device cookie or a Sites sign-in) and anyone can read the inbox. Original photos are seen only by
// the reporter and approvers; everyone else gets a tiny mosaic made in the reporter's browser. Processing (decisions,
// facade proposals, approval) needs an approver session: a name and password from APPROVERS (local preview: a generated
// local account). Station-level maintenance locks may queue approvals; Seoul accepts final administrator approvals.
import {validateReportInput,validateStructure,structurePixels,validatePhotoView,STRUCTURE_FACES,stationByKey,connectedStation,PUBLIC_STATIONS,LIMITS,STATUS,DECISIONS,STAGE_FILTERS,nearest,ruleConfidence,metres,typeLabel,progressOf} from '../src/reports.js';
import {analyzeWithAI} from './ai.js';
import {DAEJEON_CANDIDATES} from '../src/daejeon-candidates.js';

export const seoulBase=env=>env.LOCAL_PREVIEW?'http://127.0.0.1:4196':'https://station-one-collab.soalsebi.chatgpt.site';
let seoulCache=null;
// Seoul facade slots and facilities from the Station One service (the jury-frozen register), cached per isolate.
// Daejeon: the reviewed candidate register (texture-sign readings, unverified), bundled with the Worker.
const DAEJEON={slots:DAEJEON_CANDIDATES.slots,facilities:DAEJEON_CANDIDATES.facilities.map(f=>({id:f.id,name:f.name,floor:f.floor,category:f.category,kind:f.kind,position:f.position})),endpoints:[]};
export async function stationData(env,key,fetcher=fetch){
 if(key==='S201801')return DAEJEON;
 if(key!=='S202103')return {slots:[],facilities:[],endpoints:[]};
 const base=seoulBase(env);if(seoulCache&&seoulCache.base===base&&Date.now()-seoulCache.at<600000)return seoulCache.data;
 const get=async p=>{const r=await fetcher(base+p,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('서울역 기준 자료 응답 '+r.status);return r.json();};
 const [facades,catalog]=await Promise.all([get('/data/jury-frozen/approved-facades.json'),get('/data/experience/catalog.json')]);
 const bySource=new Map(catalog.facilities.map(f=>[f.source_id,f]));
 const slots=facades.replacements.filter(r=>r.is_active!==false&&r.slot).map(r=>{const s=r.slot,f=bySource.get(s.slot_alias);
  return {alias:s.slot_alias,name:f?.name||r.current_store_name||s.object_label,facility_id:f?.id||null,floor:s.floor,position:[s.longitude,s.latitude,s.height_m],heading:s.camera_heading_deg,
   px:[r.replacement_width_px,r.replacement_height_px],surface:[s.surface_width_m,s.surface_height_m],image:new URL(r.image_url,base).href,model:s.model_name,td_id:s.td_id};});
 const facilities=catalog.facilities.filter(f=>Array.isArray(f.access)||f.reference).map(f=>({id:f.id,name:f.name,floor:f.floor,category:f.store?.category||'',
  position:Array.isArray(f.access)?f.access:[f.reference.lon,f.reference.lat,f.reference.height]}));
 const endpoints=(catalog.endpoints||[]).map(e=>{const g=e.geometry,c=g?.type==='Point'?g.coordinates:g?.coordinates?.[0]?.[0];return c?{id:e.id,name:e.name,floor:e.floor,position:c}:null;}).filter(Boolean);
 seoulCache={at:Date.now(),base,data:{slots,facilities,endpoints}};return seoulCache.data;
}

export function imageInfo(a){
 if(a.length>24&&a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71)return {mime:'image/png',width:(a[16]<<24|a[17]<<16|a[18]<<8|a[19])>>>0,height:(a[20]<<24|a[21]<<16|a[22]<<8|a[23])>>>0};
 if(a.length>4&&a[0]===255&&a[1]===216&&a[2]===255){let i=2;while(i+9<a.length){if(a[i]!==255){i++;continue;}const m=a[i+1],len=a[i+2]<<8|a[i+3];
  if(m>=192&&m<=207&&![196,200,204].includes(m))return {mime:'image/jpeg',width:a[i+7]<<8|a[i+8],height:a[i+5]<<8|a[i+6]};i+=2+len;}return {mime:'image/jpeg',width:null,height:null};}
 return null;
}
// Approver accounts: "이름:비밀번호" pairs separated by commas or new lines (a Worker secret). Passwords under 8 characters are ignored.
export function approvers(env){
 const m=new Map();for(const line of String(env.APPROVERS||'').split(/[,\n]/)){const i=line.indexOf(':'),name=line.slice(0,i).trim(),pw=line.slice(i+1).trim();if(i>0&&name.length<=40&&pw.length>=8)m.set(name,pw);}
 return m;
}
const SESSION_HOURS=8,LOGIN_TRIES=5,LOGIN_WINDOW_MIN=15;
// Public reads are cookie-free: other sites (the Station One service) may read them.
const OPEN={'Access-Control-Allow-Origin':'*'};
const readObject=async(env,key)=>{const o=await env.UPLOADS?.get(key);return o?new Uint8Array(await new Response(o.body).arrayBuffer()):null;};
const hex=n=>[...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,'0')).join('');
const cookie=(request,name,pattern)=>request.headers.get('Cookie')?.match(new RegExp('(?:^|;\\s*)'+name+'=('+pattern+')(?:;|$)'))?.[1]||null;
const parse=(s,f=null)=>{try{return s?JSON.parse(s):f;}catch{return f;}};
const stepped=(history,status,note)=>JSON.stringify([...parse(history,[]),{status,at:new Date().toISOString(),...(note?{note}:{})}]);
async function who(request,env,digest){
 const user=request.headers.get('oai-authenticated-user-id')||null,token=cookie(request,'nerd-approver','[a-f0-9]{64}');let approver=null;
 if(token&&env.DB){const r=await env.DB.prepare('SELECT name FROM approver_sessions WHERE token_hash=? AND expires_at>?').bind(await digest('approver:'+token),new Date().toISOString()).first();approver=r?.name||null;}
 return {user,approver,token,local:env.LOCAL_PREVIEW===true};
}
// Same-length digests compared without an early exit.
async function samePassword(given,expected,digest){const [a,b]=await Promise.all([digest('pw:'+given),digest('pw:'+expected)]);let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

function suggest(type,slot,facility){
 if(type==='facade'&&slot)return {kind:'facade',target:slot.alias,label:slot.name+' 파사드 교체'};
 if(type==='removed')return {kind:'removal',target:facility?.id||slot?.alias||null,label:(facility?.name||slot?.name||'시설')+' 숨김 검토'};
 if(type==='new')return {kind:'structure',target:null,label:'새 구조물 등록 검토'};
 if(type==='blocked')return {kind:'route',target:null,label:'경로 차단·우회 검토'};
 if(type==='info')return {kind:'facility',target:facility?.id||null,label:(facility?.name||'시설')+' 정보 수정 검토'};
 return {kind:'other',target:null,label:'승인자 판단'};
}
// Matching, duplicate grouping and (when configured) the vision model. Never changes the map by itself.
export async function analyzeReport(env,report,fetcher=fetch){
 const db=env.DB,position=parse(report.position),view=parse(report.view);
 const photos=(await db.prepare('SELECT id,mime,view_role FROM report_photos WHERE report_id=? ORDER BY created_at,rowid').bind(report.id).all()).results;
 let data={slots:[],facilities:[]},dataError=null;
 if(connectedStation(report.station_key)&&position){try{data=await stationData(env,report.station_key,fetcher);}catch(e){dataError=e.message;}}
 const slot=position?nearest(data.slots,position,report.floor,LIMITS.matchRadius,view?.heading):null;
 const facility=position?nearest(data.facilities,position,report.floor,LIMITS.matchRadius):null;
 const since=new Date(Date.now()-LIMITS.duplicateDays*864e5).toISOString();
 const others=(await db.prepare("SELECT id,group_id,position,floor FROM reports WHERE station_key=? AND type=? AND id<>? AND status<>'rejected' AND created_at>=? ORDER BY created_at").bind(report.station_key,report.type,report.id,since).all()).results;
 const near=position?others.filter(o=>o.floor===report.floor&&o.position&&metres(parse(o.position),position)<=LIMITS.duplicateRadius):[];
 let ai=null,aiError=null;
 if(env.AI_API_KEY&&photos.length){try{const imgs=[];for(const [index,p] of photos.entries()){const b=await readObject(env,'report/'+p.id);if(b)imgs.push({id:p.id,index,view_role:p.view_role,mime:p.mime,bytes:b});}
  ai=await analyzeWithAI(env,{photos:imgs,report,slot,facility},fetcher);
  if(ai){const linked=q=>({...q,photo:imgs[q.photo].index,photo_id:imgs[q.photo].id,view_role:imgs[q.photo].view_role});if(ai.storefront_quad)ai.storefront_quad=linked(ai.storefront_quad);ai.storefront_quads=ai.storefront_quads.map(linked);ai.people=ai.people.map(linked);}
 }catch(e){aiError=e.message;}}
 const rules=ruleConfidence({slotDistance:slot?.distance,duplicates:near.length,photos:photos.length});
 return {mode:ai?'ai':'rules',at:new Date().toISOString(),photo_ids:photos.map(p=>p.id),
  slot:slot&&{alias:slot.alias,name:slot.name,distance:slot.distance,px:slot.px,heading:slot.heading,image:slot.image,floor:slot.floor,position:slot.position,surface:slot.surface,model:slot.model,td_id:slot.td_id},
  facility:facility&&{id:facility.id,name:facility.name,category:facility.category,distance:facility.distance},
  group:{id:near.length?(near[0].group_id||near[0].id):report.id,size:near.length+1},
  confidence:Number.isFinite(ai?.confidence)?Math.round((rules*.4+ai.confidence*.6)*100)/100:rules,
  suggestion:suggest(report.type,slot,facility),ai,notes:[dataError&&'기준 자료: '+dataError,aiError&&'AI: '+aiError].filter(Boolean)};
}
async function runAnalysis(env,id){
 const r=await env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(id).first();if(!r)return;
 let analysis;try{analysis=await analyzeReport(env,r);}catch(e){analysis={mode:'failed',at:new Date().toISOString(),notes:['정리 실패: '+e.message],confidence:null,photo_ids:[]};}
 const fresh=await env.DB.prepare('SELECT history,status FROM reports WHERE id=?').bind(id).first();
 await env.DB.prepare('UPDATE reports SET analysis=?,group_id=?,status=?,history=?,updated_at=? WHERE id=?').bind(JSON.stringify(analysis),analysis.group?.id||id,fresh.status==='analyzing'?'review':fresh.status,fresh.status==='analyzing'?stepped(fresh.history,'review',analysis.mode==='ai'?'AI 정리 완료':'위치·중복 자동 정리 완료'):fresh.history,new Date().toISOString(),id).run();
}
const audit=(db,actor,action,target,detail)=>db.prepare('INSERT INTO audit_log (id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,target,JSON.stringify(detail||{}),new Date().toISOString()).run();

const photosOf=async(db,id)=>(await db.prepare('SELECT id,width,height,caption,mark,view_role,preview_size FROM report_photos WHERE report_id=? ORDER BY created_at,rowid').bind(id).all()).results;
// full: the original (reporter and approvers); everyone gets the mosaic preview when the reporter's browser made one.
const photoRow=(ph,full)=>({id:ph.id,caption:ph.caption||'',mark:parse(ph.mark),view_role:ph.view_role||'unknown',width:ph.width,height:ph.height,src:full?'/api/reports/photos/'+ph.id:null,preview:ph.preview_size?'/api/public/report-previews/'+ph.id:null});
const faceObject=(id,side)=>'proposal/'+id+(side==='front'?'':'/'+side);
const faceUrl=(id,side,publicImage=false)=>(publicImage?'/api/public/proposal-images/':'/api/console/proposal-images/')+id+(side==='front'?'':'/'+side);
const proposalFaces=pr=>{const faces=parse(pr.meta,{})?.faces;return faces&&typeof faces==='object'?Object.keys(faces).filter(s=>STRUCTURE_FACES.includes(s)):['front'];};
const proposalImages=(pr,allowed,publicImage=false)=>allowed?Object.fromEntries(proposalFaces(pr).map(s=>[s,faceUrl(pr.id,s,publicImage)])):null;
const proposalsOf=async(db,id)=>(await db.prepare("SELECT id,kind,target,meta,status,confidence,reviewer,created_at,decided_at,reason FROM proposals WHERE report_ids LIKE ? ORDER BY CASE WHEN status IN ('draft','ready','queued','applied') THEN 0 ELSE 1 END,created_at DESC").bind('%'+id+'%').all()).results;
const brief=p=>p?{status:p.status,created_at:p.created_at,decided_at:p.decided_at}:null;
function baseRow(r){return {id:r.id,station_key:r.station_key,station_name:stationByKey(r.station_key)?.name||r.station_key,type:r.type,type_label:typeLabel(r.type),floor:r.floor,place_note:r.place_note,description:r.description,
 status:r.status,status_label:STATUS[r.status]||r.status,history:parse(r.history,[]).map(h=>({...h,label:STATUS[h.status]||h.status})),reason:r.reason||null,created_at:r.created_at};}

export async function reportsApi(request,env,ctx,{json,bytes,digest}){
 const u=new URL(request.url),p=u.pathname,method=request.method;
 if(!(p==='/api/session'||p.startsWith('/api/reports')||p.startsWith('/api/public/')||p.startsWith('/api/console/')))return null;
 const me=await who(request,env,digest);
 if(p==='/api/session')return json({user_id:me.user,approver:me.approver,local:me.local,approvers_configured:approvers(env).size>0});
 if(!env.DB)return json({error:'제보 저장소 연결을 확인하세요.'},503);
 const db=env.DB,writing=!['GET','HEAD'].includes(method),now=new Date().toISOString();
 if(writing&&request.headers.get('Origin')!==u.origin)return json({error:'같은 사이트에서 보내 주세요.'},403);
 const token=cookie(request,'nerd-reporter','[a-f0-9-]{36}'),reporter=token?await digest('reporter:'+token):null;
 const body=async(max=200_000)=>{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('JSON으로 보내 주세요.');const a=await bytes(request,max);return a.length?JSON.parse(new TextDecoder().decode(a)):{};};
 const needApprover=()=>json({error:'승인자 로그인이 필요해요.',login:true},401);
 try{
  // ---- Public
  if(p==='/api/public/stations'&&method==='GET'){
   const open=(await db.prepare("SELECT station_key,count(*) AS n FROM reports WHERE status IN ('review','analyzing') GROUP BY station_key").all()).results,changed=(await db.prepare("SELECT station_key,count(*) AS n FROM proposals WHERE status IN ('queued','applied') GROUP BY station_key").all()).results;
   const count=(rows,k)=>rows.find(r=>r.station_key===k)?.n||0;
   return json({stations:PUBLIC_STATIONS.map(s=>({...s,open:count(open,s.key),changes:count(changed,s.key)}))},200,OPEN);
  }
  if(p==='/api/public/station'&&method==='GET'){
   const s=stationByKey(u.searchParams.get('key'));if(!s)return json({error:'역을 찾을 수 없어요.'},404,OPEN);
   const c=connectedStation(s.key);let data={slots:[],facilities:[],endpoints:[]},note=null;
   if(c)try{data=await stationData(env,s.key);}catch(e){note='등록 시설을 불러오지 못했어요. 3D 지도와 제보는 쓸 수 있어요.';}
   if(s.key==='S201801'&&!note)note=DAEJEON_CANDIDATES.notice;
   // Approved facades, including Seoul, placed on their registered slots.
   const layer=c&&!s.locked?parse((await db.prepare('SELECT body FROM station_layers WHERE station_key=?').bind(s.key).first())?.body,null):null;
   // Imported facades carry their own slot geometry; proposals made here use the station's slot register.
   const overlays=Object.entries(layer?.facades||{}).map(([alias,v])=>{const g=v.slot||data.slots.find(x=>x.alias===alias);return g&&v.front?{alias,name:g.name,floor:g.floor,position:g.position,heading:g.heading,surface:g.surface,px:g.px,image:v.front,at:v.at}:null;}).filter(Boolean);
   const changes=(await db.prepare("SELECT id,target,status,decided_at FROM proposals WHERE station_key=? AND status IN ('queued','applied') ORDER BY decided_at DESC LIMIT 20").bind(s.key).all()).results.map(r=>{const t=parse(r.target,{});return {id:r.id,name:t.name||t.alias,alias:t.alias,before:t.before||null,after:'/api/public/proposal-images/'+r.id,status:r.status,status_label:STATUS[r.status],decided_at:r.decided_at};});
   return json({station:{...s,...(c?{floors:c.floors,default_floor:c.default_floor,centre:c.centre,heights:c.heights}:{})},note,
    assets:Object.values(layer?.assets||{}),facilities:data.facilities.map(f=>({id:f.id,name:f.name,floor:f.floor,category:f.category,kind:f.kind||'facility',position:f.position})),endpoints:data.endpoints,overlays,
    slots:data.slots.map(x=>({alias:x.alias,name:x.name,floor:x.floor,position:x.position,heading:x.heading})),changes},200,OPEN);
  }
  let m=p.match(/^\/api\/public\/proposal-images\/([a-f0-9-]{36})(?:\/(front|left|right|back))?$/);
  if(m&&method==='GET'){const r=await db.prepare('SELECT status,mime,meta FROM proposals WHERE id=?').bind(m[1]).first(),side=m[2]||'front';if(!r||!['queued','applied'].includes(r.status)||!proposalFaces(r).includes(side))return json({error:'공개된 이미지가 아니에요.'},404);
   const b=await readObject(env,faceObject(m[1],side));return b?new Response(b,{headers:{'Content-Type':parse(r.meta,{})?.faces?.[side]?.mime||r.mime,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff',...OPEN}}):json({error:'이미지가 없어요.'},404);}
  m=p.match(/^\/api\/public\/report-previews\/([a-f0-9-]{36})$/);
  if(m&&method==='GET'){const ph=await db.prepare('SELECT p.preview_size,r.status FROM report_photos p JOIN reports r ON r.id=p.report_id WHERE p.id=?').bind(m[1]).first();
   if(!ph?.preview_size||['received','rejected'].includes(ph.status))return json({error:'볼 수 없는 사진이에요.'},404);
   const b=await readObject(env,'report-preview/'+m[1]);return b?new Response(b,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff'}}):json({error:'사진이 없어요.'},404);}
  // ---- Reporting
  if(p==='/api/reports'&&method==='POST'){
   const v=validateReportInput(await body());let secret=token,set={};
   if(!secret){secret=crypto.randomUUID();set={'Set-Cookie':'nerd-reporter='+secret+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(u.protocol==='https:'?'; Secure':'')};}
   const hash=reporter||await digest('reporter:'+secret),day=new Date(Date.now()-864e5).toISOString();
   const mine=await db.prepare('SELECT count(*) AS n FROM reports WHERE reporter_hash=? AND created_at>=?').bind(hash,day).first();if(mine.n>=LIMITS.perDay)return json({error:'하루에 '+LIMITS.perDay+'건까지 제보할 수 있어요. 내일 다시 보내 주세요.'},429);
   const total=await db.prepare('SELECT count(*) AS n FROM reports').first();if(total.n>=20000)return json({error:'제보 저장 한도에 도달했어요. 잠시 후 다시 시도해 주세요.'},429);
   const id=crypto.randomUUID();
   await db.prepare('INSERT INTO reports (id,station_key,floor,position,view,type,description,place_note,status,reporter_hash,user_id,group_id,analysis,history,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id,v.station_key,v.floor,v.position?JSON.stringify(v.position):null,v.view?JSON.stringify(v.view):null,v.type,v.description,v.place_note,'received',hash,me.user,null,null,stepped('[]','received'),null,now,now).run();
   return json({id,status:'received',photos:'/api/reports/'+id+'/photos'},201,set);
  }
  m=p.match(/^\/api\/reports\/([a-f0-9-]{36})\/(photos|submit)$/);
  if(m&&method==='POST'){
   const r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(m[1]).first();
   if(!r||!reporter||r.reporter_hash!==reporter)return json({error:'내 제보가 아니에요.'},403);
   if(r.status!=='received')return json({error:'이미 제출한 제보예요.'},409);
   const count=await db.prepare('SELECT count(*) AS n FROM report_photos WHERE report_id=?').bind(r.id).first();
   if(m[2]==='photos'){
    if(Date.now()-Date.parse(r.created_at)>3600000)return json({error:'사진 올리기 시간이 지났어요. 새로 제보해 주세요.'},409);
    if(count.n>=LIMITS.photos)return json({error:'사진은 '+LIMITS.photos+'장까지 올릴 수 있어요.'},400);
    const a=await bytes(request,LIMITS.photoBytes),info=imageInfo(a);if(!info)return json({error:'PNG 또는 JPEG 사진만 올릴 수 있어요.'},400);
    const used=await db.prepare('SELECT COALESCE(sum(size),0) AS s FROM report_photos').first();if(used.s+a.length>(Number(env.REPORT_STORAGE_MB)||500)*1e6)return json({error:'사진 저장 한도에 도달했어요.'},429);
    const pid=crypto.randomUUID();await env.UPLOADS.put('report/'+pid,a,{httpMetadata:{contentType:info.mime}});
    await db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,created_at) VALUES (?,?,?,?,?,?,?)').bind(pid,r.id,info.mime,a.length,info.width,info.height,now).run();
    return json({id:pid,width:info.width,height:info.height},201);
   }
   if(!count.n)return json({error:'사진을 한 장 이상 올려 주세요.'},400);
   // What the reporter says about each photo: a caption, the spot they tapped, and the mosaic for the public inbox.
   const v=await body(),own=new Set((await db.prepare('SELECT id FROM report_photos WHERE report_id=?').bind(r.id).all()).results.map(x=>x.id));
   if(v.photos!==undefined&&(!Array.isArray(v.photos)||v.photos.length>LIMITS.photos))return json({error:'사진은 '+LIMITS.photos+'장까지 보내 주세요.'},400);
   const notes=(v.photos||[]).filter(n=>n&&own.has(n.id)),seen=new Set();
   for(const n of notes){validatePhotoView(n.view_role);if(seen.has(n.id))return json({error:'같은 사진이 두 번 지정됐어요.'},400);seen.add(n.id);}
   for(const n of notes){
    const caption=typeof n.caption==='string'?n.caption.trim().slice(0,LIMITS.caption):'';
    const mark=Array.isArray(n.mark)&&n.mark.length===2&&n.mark.every(x=>Number.isFinite(x)&&x>=0&&x<=1)?JSON.stringify(n.mark.map(x=>Math.round(x*1e4)/1e4)):null;
    let preview=null;const pm=typeof n.preview==='string'&&n.preview.length<=LIMITS.previewChars?/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(n.preview):null;
    if(pm){const bin=Uint8Array.from(atob(pm[1]),c=>c.charCodeAt(0)),info=imageInfo(bin);
     if(info?.mime==='image/jpeg'&&info.width&&info.height&&info.width<=LIMITS.previewPx&&info.height<=LIMITS.previewPx){await env.UPLOADS.put('report-preview/'+n.id,bin,{httpMetadata:{contentType:'image/jpeg'}});preview=bin.length;}}
    await db.prepare('UPDATE report_photos SET caption=?,mark=?,view_role=?,preview_size=? WHERE id=? AND report_id=?').bind(caption||null,mark,validatePhotoView(n.view_role),preview,n.id,r.id).run();
   }
   await db.prepare('UPDATE reports SET status=?,history=?,updated_at=? WHERE id=?').bind('analyzing',stepped(r.history,'analyzing'),now,r.id).run();
   const job=runAnalysis(env,r.id);if(ctx?.waitUntil){ctx.waitUntil(job);}else await job;
   const after=await db.prepare('SELECT status FROM reports WHERE id=?').bind(r.id).first();
   return json({id:r.id,status:after.status,status_label:STATUS[after.status]},202);
  }
  if(p==='/api/reports/mine'&&method==='GET'){
   if(!reporter&&!me.user)return json({reports:[]});
   const rows=(await db.prepare('SELECT * FROM reports WHERE reporter_hash=? OR (user_id IS NOT NULL AND user_id=?) ORDER BY created_at DESC LIMIT 50').bind(reporter||'-',me.user||'-').all()).results;
   const out=[];for(const r of rows){const pr=(await proposalsOf(db,r.id))[0];out.push({...baseRow(r),photos:(await photosOf(db,r.id)).map(x=>photoRow(x,true)),proposal:brief(pr),progress:progressOf(r.status,pr?.status)});}
   return json({reports:out});
  }
  m=p.match(/^\/api\/reports\/photos\/([a-f0-9-]{36})$/);
  if(m&&method==='GET'){const ph=await db.prepare('SELECT p.mime,r.reporter_hash FROM report_photos p JOIN reports r ON r.id=p.report_id WHERE p.id=?').bind(m[1]).first();
   if(!ph||!(me.approver||reporter&&ph.reporter_hash===reporter))return json({error:'볼 수 없는 사진이에요.'},404);
   const b=await readObject(env,'report/'+m[1]);return b?new Response(b,{headers:{'Content-Type':ph.mime,'Cache-Control':'private,max-age=600','X-Content-Type-Options':'nosniff'}}):json({error:'사진이 없어요.'},404);}
  // ---- Report inbox: anyone reads; approvers act
  if(p.startsWith('/api/console/')){
   if(p==='/api/console/login'&&method==='POST'){
    const accounts=approvers(env);if(!accounts.size)return json({error:'승인자 계정이 아직 설정되지 않았어요. 운영자에게 문의하세요.'},503);
    const ip=await digest('ip:'+(request.headers.get('CF-Connecting-IP')||'local')),since=new Date(Date.now()-LOGIN_WINDOW_MIN*60000).toISOString();
    const fails=await db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='approver.login_fail' AND target=? AND created_at>=?").bind(ip,since).first();
    if(fails.n>=LOGIN_TRIES)return json({error:'로그인 시도가 너무 많아요. '+LOGIN_WINDOW_MIN+'분 뒤에 다시 시도하세요.'},429);
    const v=await body(10_000),name=String(v.name||'').trim(),expected=accounts.get(name);
    const ok=await samePassword(String(v.password||''),expected??'\u0000no-account',digest)&&expected!==undefined;
    if(!ok){await audit(db,'anonymous','approver.login_fail',ip);return json({error:'이름이나 비밀번호가 맞지 않아요.'},401);}
    const session=hex(32),expires=new Date(Date.now()+SESSION_HOURS*3600e3).toISOString();
    await db.prepare('DELETE FROM approver_sessions WHERE expires_at<?').bind(now).run();
    await db.prepare('INSERT INTO approver_sessions (token_hash,name,created_at,expires_at) VALUES (?,?,?,?)').bind(await digest('approver:'+session),name,now,expires).run();
    await audit(db,name,'approver.login',name);
    return json({approver:name,expires_at:expires},200,{'Set-Cookie':'nerd-approver='+session+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+SESSION_HOURS*3600+(u.protocol==='https:'?'; Secure':'')});
   }
   if(p==='/api/console/logout'&&method==='POST'){
    if(me.token)await db.prepare('DELETE FROM approver_sessions WHERE token_hash=?').bind(await digest('approver:'+me.token)).run();
    return json({approver:null},200,{'Set-Cookie':'nerd-approver=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(u.protocol==='https:'?'; Secure':'')});
   }
   if(p==='/api/console/reports'&&method==='GET'){
    const stage=u.searchParams.get('stage')||'review',station=u.searchParams.get('station')||'';
    const legacy=station?'name:'+(stationByKey(station)?.name||''):'';
    const rows=(await db.prepare("SELECT r.id,r.station_key,r.type,r.floor,r.description,r.place_note,r.status,r.created_at,r.analysis,(SELECT p.status FROM proposals p WHERE p.report_ids LIKE '%'||r.id||'%' ORDER BY p.created_at DESC LIMIT 1) AS proposal_status,(SELECT count(*) FROM report_photos ph WHERE ph.report_id=r.id) AS photo_count,(SELECT ph.id FROM report_photos ph WHERE ph.report_id=r.id AND ph.preview_size IS NOT NULL ORDER BY ph.created_at LIMIT 1) AS cover FROM reports r WHERE (?='' OR r.station_key=? OR r.station_key=?) AND r.status<>'received' ORDER BY r.created_at DESC LIMIT 500").bind(station,station,legacy).all()).results;
    const summary=Object.fromEntries(STAGE_FILTERS.map(f=>[f.id,0]));
    const items=rows.map(r=>{const a=parse(r.analysis),progress=progressOf(r.status,r.proposal_status),hidden=r.status==='rejected'&&!me.approver;if(progress.bucket in summary)summary[progress.bucket]++;summary.all++;
     return {id:r.id,station_key:r.station_key,station_name:stationByKey(r.station_key)?.name||r.station_key,type:r.type,type_label:typeLabel(r.type),floor:r.floor,description:hidden?'':r.description.slice(0,120),place_note:hidden?'':r.place_note,hidden,
      status:r.status,status_label:STATUS[r.status],created_at:r.created_at,confidence:a?.confidence??null,mode:a?.mode||null,slot:a?.slot?{alias:a.slot.alias,name:a.slot.name,distance:a.slot.distance}:null,group:a?.group||null,
      proposal_status:r.proposal_status||null,progress,photo_count:r.photo_count,cover:!hidden&&r.cover?'/api/public/report-previews/'+r.cover:null};});
    return json({reports:items.filter(x=>stage==='all'||x.progress.bucket===stage).slice(0,200),summary,approver:me.approver});
   }
   m=p.match(/^\/api\/console\/reports\/([a-f0-9-]{36})(?:\/(decision|analyze))?$/);
   if(m){const r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(m[1]).first();if(!r||r.status==='received')return json({error:'제보가 없어요.'},404);
    if(!m[2]&&method==='GET'){
     const full=Boolean(me.approver||reporter&&r.reporter_hash===reporter),hidden=r.status==='rejected'&&!me.approver,prs=await proposalsOf(db,r.id);
     const group=r.group_id?(await db.prepare('SELECT id,status,created_at FROM reports WHERE group_id=? AND id<>? ORDER BY created_at').bind(r.group_id,r.id).all()).results.map(g=>({...g,status_label:STATUS[g.status]})):[];
     const proposals=prs.map(x=>({...x,meta:me.approver?parse(x.meta,{}):null,reviewer:me.approver?x.reviewer:null,target:parse(x.target,{}),images:proposalImages(x,me.approver||['queued','applied'].includes(x.status),!me.approver),image:me.approver?'/api/console/proposal-images/'+x.id:['queued','applied'].includes(x.status)?'/api/public/proposal-images/'+x.id:null}));
     const base=baseRow(r);
     return json({report:{...base,description:hidden?'':base.description,place_note:hidden?'':base.place_note,hidden,position:parse(r.position),view:parse(r.view),group_id:r.group_id,user:Boolean(r.user_id),
      updated_at:r.updated_at,analysis:hidden?null:parse(r.analysis),photos:hidden?[]:(await photosOf(db,r.id)).map(x=>photoRow(x,full)),originals:full,proposal:brief(prs[0]),progress:progressOf(r.status,prs[0]?.status)},
      group,proposals,locked:Boolean(stationByKey(r.station_key)?.locked),approver:me.approver});
    }
    if(!me.approver)return needApprover();
    if(m[2]==='decision'&&method==='POST'){const v=await body();if(!DECISIONS.includes(v.status))return json({error:'판단을 골라 주세요.'},400);const reason=String(v.reason||'').trim().slice(0,LIMITS.reason);if(!['review','accepted'].includes(v.status)&&!reason)return json({error:'제보자에게 보일 사유를 적어 주세요.'},400);
     if(['queued','applied'].includes(r.status))return json({error:'이미 승인된 제보입니다. 승인 결과를 임의로 되돌릴 수 없어요.'},409);
     if(v.status==='accepted'&&(!['review','held'].includes(r.status)||!['new','facade'].includes(r.type)))return json({error:'새 구조물 또는 파사드 제보를 검토한 뒤 채택해 주세요.'},409);
     const changed=await db.prepare('UPDATE reports SET status=?,reason=?,history=?,updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(v.status,reason||null,stepped(r.history,v.status,reason),now,r.id,r.status,r.updated_at).run();
     if(!changed.meta.changes)return json({error:'다른 창에서 변경됐어요. 다시 불러오세요.'},409);
     await audit(db,me.approver,'report.'+v.status,r.id,{reason});
     return json({id:r.id,status:v.status,status_label:STATUS[v.status]});}
    if(m[2]==='analyze'&&method==='POST'){await runAnalysis(env,r.id);const a=await db.prepare('SELECT analysis,status FROM reports WHERE id=?').bind(r.id).first();await audit(db,me.approver,'report.analyze',r.id);return json({analysis:parse(a.analysis),status:a.status});}
    return json({error:'등록되지 않은 경로입니다.'},404);
   }
   if(p==='/api/console/station'&&method==='GET'){const key=u.searchParams.get('key');if(!connectedStation(key))return json({error:'3D가 연결된 역만 볼 수 있어요.'},400);const d=await stationData(env,key);return json({slots:d.slots});}
   if(!me.approver)return needApprover();
   // Facades approved elsewhere (the retired Supabase workbench): stored like an applied proposal, idempotent per source id.
   if(p==='/api/console/import-facade'&&method==='POST'){
    const v=await body(7_000_000),st=stationByKey(v.station_key),c=connectedStation(v.station_key),g=v.slot||{},num=Number.isFinite;
    if(!st||!c)return json({error:'3D가 연결된 역에만 가져올 수 있어요.'},400);
    if(st.locked)return json({error:'지도 반영이 잠긴 역에는 가져올 수 없어요.'},409);
    const geometry=typeof g.alias==='string'&&/^[\w-]{1,80}$/.test(g.alias)&&c.floors.includes(g.floor)&&Array.isArray(g.position)&&g.position.length===3&&g.position.every(num)&&Math.abs(g.position[0]-c.centre[0])<.03&&Math.abs(g.position[1]-c.centre[1])<.03
     &&num(g.heading)&&Array.isArray(g.surface)&&g.surface.length===2&&g.surface.every(n=>num(n)&&n>0&&n<200)&&Array.isArray(g.px)&&g.px.length===2&&g.px.every(n=>Number.isInteger(n)&&n>0&&n<=8192);
    if(!geometry)return json({error:'파사드 자리 정보를 확인하세요.'},400);
    const dm=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(v.image||''));if(!dm)return json({error:'이미지를 PNG 또는 JPEG로 보내 주세요.'},400);
    const bin=Uint8Array.from(atob(dm[2]),x=>x.charCodeAt(0)),info=imageInfo(bin);if(!info||info.mime!==dm[1]||bin.length>LIMITS.photoBytes)return json({error:'이미지 형식이나 크기를 확인하세요. (4MB까지)'},400);
    if(info.width!==g.px[0]||info.height!==g.px[1])return json({error:'이미지 크기('+info.width+'×'+info.height+')가 파사드 규격('+g.px.join('×')+')과 달라요.'},400);
    const source={kind:String(v.source?.kind||'import').slice(0,40),id:String(v.source?.id||'').slice(0,120),approved_at:String(v.source?.approved_at||'').slice(0,40),store_name:String(v.source?.store_name||'').slice(0,120)};
    const layer=await db.prepare('SELECT * FROM station_layers WHERE station_key=?').bind(st.key).first(),b=parse(layer?.body,{facades:{}}),cur=b.facades[g.alias];
    if(source.id&&cur?.source?.id===source.id)return json({id:cur.proposal,status:'applied',skipped:true});
    const id=crypto.randomUUID(),name=String(g.name||source.store_name||g.alias).slice(0,120),slot={name,floor:g.floor,position:g.position,heading:g.heading,surface:g.surface,px:g.px};
    await env.UPLOADS.put('proposal/'+id,bin,{httpMetadata:{contentType:info.mime}});
    await db.prepare('INSERT INTO proposals (id,station_key,report_ids,kind,target,meta,mime,size,confidence,status,reviewer,reason,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(id,st.key,'[]','facade',JSON.stringify({alias:g.alias,name,side:'front',px:g.px,before:null}),JSON.stringify({by:'import',source}),info.mime,bin.length,null,'applied',me.approver,null,now,now).run();
    const value={front:'/api/public/proposal-images/'+id,proposal:id,at:now,source,slot},path='$.facades."'+g.alias+'"';
    await db.prepare("INSERT INTO station_layers (station_key,revision,body,updated_at) VALUES (?,1,json_set('{}',?,json(?)),?) ON CONFLICT(station_key) DO UPDATE SET revision=station_layers.revision+1,body=json_set(station_layers.body,?,json(?)),updated_at=excluded.updated_at").bind(st.key,path,JSON.stringify(value),now,path,JSON.stringify(value)).run();
    await audit(db,me.approver,'facade.import',id,{alias:g.alias,source});
    return json({id,status:'applied'},201);
   }
   if(p==='/api/console/proposals'&&method==='POST'){
    const v=await body(7_000_000),r=await db.prepare('SELECT * FROM reports WHERE id=?').bind(v.report_id).first();
    if(!r||!['review','accepted'].includes(r.status))return json({error:'검토 중이거나 채택된 제보에만 제안을 만들 수 있어요.'},409);
    if(!['facade','structure'].includes(v.kind))return json({error:'파사드 또는 새 구조물 제안을 선택하세요.'},400);
    const isStructure=v.kind==='structure';let structure=null;
    if(isStructure){if(r.type!=='new')return json({error:'새로 생김 제보에서 구조물 초안을 만드세요.'},400);if(r.status!=='accepted')return json({error:'먼저 제보를 채택하세요. 채택은 지도 반영이 아닙니다.'},409);structure=validateStructure(v.target?.structure,r.station_key);}
    const slot=isStructure?{alias:'report-'+r.id,name:structure.name,px:structurePixels(structure.size),image:null}:(await stationData(env,r.station_key)).slots.find(s=>s.alias===v.target?.alias);if(!slot)return json({error:'이 역에서 찾을 수 없는 파사드 자리예요.'},400);
    if(v.faces!==undefined&&(!isStructure||!v.faces||typeof v.faces!=='object'||Array.isArray(v.faces)||Object.keys(v.faces).some(s=>!STRUCTURE_FACES.includes(s))))return json({error:'구조물 사진은 정면·좌측면·우측면·후면만 지정하세요. 주변 사진은 배치 확인용입니다.'},400);
    const rawFaces=isStructure&&v.faces?{...v.faces}:{front:{image:v.image,...v.meta}},prepared={},faceMeta={};let total=0;
    if(!rawFaces.front)return json({error:'구조물의 정면 사진을 보정해 주세요.'},400);
    for(const [side,f] of Object.entries(rawFaces)){
     const dm=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(f?.image||''));if(!dm)return json({error:'보정한 이미지를 PNG 또는 JPEG로 보내 주세요.'},400);
     const bin=Uint8Array.from(atob(dm[2]),c=>c.charCodeAt(0)),info=imageInfo(bin),px=isStructure?structurePixels(structure.size,side):slot.px;
     if(!info||info.mime!==dm[1]||bin.length>LIMITS.photoBytes)return json({error:'이미지 형식이나 크기를 확인하세요. (면당 4MB까지)'},400);
     total+=bin.length;if(total>4_800_000)return json({error:'여러 면 사진의 전체 용량이 너무 큽니다. JPEG로 최적화해 주세요.'},400);
     if(info.width!==px[0]||info.height!==px[1])return json({error:'파사드 규격('+px.join('×')+' px)에 맞춰 보정해 주세요.'},400);
     if(isStructure){const photo=await db.prepare('SELECT id,width,height,view_role FROM report_photos WHERE id=? AND report_id=?').bind(f.photo||'',r.id).first(),q=f.quad;
      if(!photo||!Array.isArray(q)||q.length!==4||!q.every(pt=>Array.isArray(pt)&&pt.length===2&&pt.every(Number.isFinite)&&pt[0]>=0&&pt[0]<=photo.width&&pt[1]>=0&&pt[1]<=photo.height))return json({error:'이 제보의 사진과 사진 안의 네 모서리를 확인하세요.'},400);
      if(photo.view_role!=='unknown'&&photo.view_role!==side)return json({error:'사진의 촬영 면과 구조물에 적용할 면이 다릅니다.'},400);}
     faceMeta[side]={quad:Array.isArray(f.quad)?f.quad.slice(0,4):null,photo:f.photo||null,levels:Boolean(f.levels),people:f.people!==false,blurs:Array.isArray(f.blurs)?f.blurs.filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)).slice(0,40):[],mime:info.mime,px};prepared[side]={bin,info};
    }
    if(isStructure&&v.report_version!==r.updated_at)return json({error:'초안이 다른 창에서 변경됐어요. 다시 불러오세요.'},409);
    const id=crypto.randomUUID(),a=parse(r.analysis,{}),{bin,info}=prepared.front,meta={...faceMeta.front,by:v.meta?.by==='agent'?'agent':'approver',...(isStructure?{faces:faceMeta}:{})};
    for(const [side,{bin,info}] of Object.entries(prepared))await env.UPLOADS.put(faceObject(id,side),bin,{httpMetadata:{contentType:info.mime}});
    const status=isStructure?'draft':'ready',target={alias:slot.alias,name:slot.name,side:'front',px:slot.px,before:slot.image,...(structure?{structure}:{})};
    const insert=db.prepare('INSERT INTO proposals (id,station_key,report_ids,kind,target,meta,mime,size,confidence,status,reviewer,reason,created_at,decided_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reports WHERE id=? AND updated_at=? AND status IN (\'review\',\'accepted\'))')
     .bind(id,r.station_key,JSON.stringify([r.id]),v.kind,JSON.stringify(target),JSON.stringify(meta),info.mime,total,a.confidence??null,status,me.approver,null,now,null,r.id,r.updated_at);
    const out=await db.batch([insert,
     db.prepare("UPDATE proposals SET status='superseded' WHERE report_ids=? AND id<>? AND status IN ('draft','ready') AND EXISTS (SELECT 1 FROM proposals WHERE id=?)").bind(JSON.stringify([r.id]),id,id),
     db.prepare('UPDATE reports SET updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM proposals WHERE id=?)').bind(new Date(Math.max(Date.now(),Date.parse(r.updated_at)+1)).toISOString(),r.id,id)]);
    if(!out[0].meta.changes)return json({error:'다른 창에서 변경됐어요. 다시 불러오세요.'},409);
    await audit(db,me.approver,'proposal.create',id,{report:r.id,alias:slot.alias,by:meta.by});
    return json({id,status,image:'/api/console/proposal-images/'+id},201);
   }
   m=p.match(/^\/api\/console\/proposal-images\/([a-f0-9-]{36})(?:\/(front|left|right|back))?$/);
   if(m&&method==='GET'){const r=await db.prepare('SELECT mime,meta FROM proposals WHERE id=?').bind(m[1]).first(),side=m[2]||'front';const b=r&&proposalFaces(r).includes(side)&&await readObject(env,faceObject(m[1],side));return b?new Response(b,{headers:{'Content-Type':parse(r.meta,{})?.faces?.[side]?.mime||r.mime,'Cache-Control':'private,max-age=600','X-Content-Type-Options':'nosniff'}}):json({error:'이미지가 없어요.'},404);}
   m=p.match(/^\/api\/console\/proposals\/([a-f0-9-]{36})\/(ready|approve|reject)$/);
   if(m&&method==='POST'){
    const pr=await db.prepare('SELECT * FROM proposals WHERE id=?').bind(m[1]).first();if(!pr)return json({error:'제안이 없어요.'},404);
    if(!['draft','ready'].includes(pr.status))return json({error:'이미 판단했거나 새 초안으로 대체된 제안이에요.'},409);
    const v=await body();
    const reportId=parse(pr.report_ids,[])[0],source=await db.prepare('SELECT status FROM reports WHERE id=?').bind(reportId||'').first();
    if(!source||!['review','accepted'].includes(source.status))return json({error:'제보가 보류·종료되었어요. 먼저 다시 검토하세요.'},409);
    if(pr.kind==='structure'&&source.status!=='accepted')return json({error:'새 구조물 제보를 다시 채택한 뒤 확인하세요.'},409);
    if(m[2]==='ready'){
     if(pr.kind!=='structure'||pr.status!=='draft')return json({error:'구조물 초안만 확정할 수 있어요.'},409);
     if(v.geometry_checked!==true||v.privacy_checked!==true||v.preview_checked!==true)return json({error:'위치·실제 크기, 사진 공개 가능 여부와 3D 모형을 모두 확인하세요.'},400);
     const meta={...parse(pr.meta,{}),checks:{geometry:true,privacy:true,preview:true,by:me.approver,at:now}};
     const out=await db.prepare("UPDATE proposals SET status='ready',meta=? WHERE id=? AND status='draft' AND EXISTS (SELECT 1 FROM reports WHERE id=? AND status='accepted')").bind(JSON.stringify(meta),pr.id,reportId).run();
     if(!out.meta.changes)return json({error:'다른 창에서 변경됐어요. 다시 불러오세요.'},409);
     await audit(db,me.approver,'proposal.ready',pr.id);return json({id:pr.id,status:'ready'});
    }
    if(m[2]==='reject'){const reason=String(v.reason||'').trim().slice(0,LIMITS.reason);if(!reason)return json({error:'반려 사유를 적어 주세요.'},400);
     const changed=await db.prepare('UPDATE proposals SET status=?,reason=?,reviewer=?,decided_at=? WHERE id=? AND status=?').bind('rejected',reason,me.approver,now,pr.id,pr.status).run();if(!changed.meta.changes)return json({error:'이미 변경된 제안이에요.'},409);await audit(db,me.approver,'proposal.reject',pr.id,{reason});return json({id:pr.id,status:'rejected'});}
    if(pr.status!=='ready')return json({error:'초안 확인을 마친 뒤 최종 승인하세요.'},409);
    const locked=Boolean(stationByKey(pr.station_key)?.locked),status=locked?'queued':'applied',target=parse(pr.target,{});
    // D1 batch is one transaction: claim → merge one JSON key → report/history → audit → final state.
    // No read/replace of a station layer, so concurrent approvals cannot discard another approved asset.
    const commands=[db.prepare("UPDATE proposals SET status='applying' WHERE id=? AND status='ready' AND EXISTS (SELECT 1 FROM reports WHERE id=? AND (status='accepted' OR (?='facade' AND status='review')))").bind(pr.id,reportId,pr.kind)];
    if(!locked){const assetId='structure-'+pr.id,front='/api/public/proposal-images/'+pr.id;
     const value=pr.kind==='structure'?{...validateStructure(target.structure,pr.station_key),id:assetId,hidden:false,facades:proposalImages(pr,true,true),proposal:pr.id}:{front,proposal:pr.id,at:now};
     const path=pr.kind==='structure'?'$.assets."'+assetId+'"':'$.facades."'+target.alias+'"';
     commands.push(db.prepare("INSERT INTO station_layers (station_key,revision,body,updated_at) SELECT ?,1,json_set('{}',?,json(?)),? WHERE EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying') ON CONFLICT(station_key) DO UPDATE SET revision=station_layers.revision+1,body=json_set(station_layers.body,?,json(?)),updated_at=excluded.updated_at").bind(pr.station_key,path,JSON.stringify(value),now,pr.id,path,JSON.stringify(value)));}
    const note=locked?'지도 반영 잠금으로 대기 중입니다. 잠금 해제 후 별도 반영이 필요해요.':'지도에 반영됐어요';
    commands.push(db.prepare("UPDATE reports SET status=?,reason=NULL,history=json_insert(history,'$[#]',json(?)),updated_at=? WHERE (id=? OR (?='facade' AND group_id IS NOT NULL AND group_id=(SELECT group_id FROM reports WHERE id=?))) AND status IN ('review','accepted','held','analyzing') AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying')").bind(status,JSON.stringify({status,at:now,note}),now,reportId,pr.kind,reportId,pr.id));
    commands.push(db.prepare("INSERT INTO audit_log (id,actor,action,target,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM proposals WHERE id=? AND status='applying')").bind(crypto.randomUUID(),me.approver,'proposal.'+status,pr.id,JSON.stringify({alias:target.alias}),now,pr.id));
    commands.push(db.prepare("UPDATE proposals SET status=?,reviewer=?,decided_at=? WHERE id=? AND status='applying'").bind(status,me.approver,now,pr.id));
    const result=await db.batch(commands);if(!result[0].meta.changes)return json({error:'다른 창에서 처리되었거나 제보 상태가 바뀌었어요.'},409);
    return json({id:pr.id,status,status_label:STATUS[status],note});
   }
   if(p==='/api/console/proposals'&&method==='GET'){const station=u.searchParams.get('station')||'';
    return json({proposals:(await db.prepare("SELECT id,station_key,report_ids,kind,target,status,confidence,reviewer,created_at,decided_at,reason FROM proposals WHERE (?='' OR station_key=?) ORDER BY created_at DESC LIMIT 100").bind(station,station).all()).results.map(x=>({...x,report_ids:parse(x.report_ids,[]),target:parse(x.target,{}),image:'/api/console/proposal-images/'+x.id}))});}
   return json({error:'등록되지 않은 경로입니다.'},404);
  }
  return json({error:'등록되지 않은 경로입니다.'},404);
 }catch(e){return json({error:e.message||'요청을 처리하지 못했어요.'},400);}
}
