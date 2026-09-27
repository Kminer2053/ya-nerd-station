// Public reports: pick a station, look around the 3D map, point at what differs, then describe it next to the photos.
// Photos are re-encoded in the browser before upload (resized, EXIF and GPS dropped); a 48 px mosaic of each photo is
// what the public inbox shows, the original stays with the reporter and approvers.
import './style.css';
import {REPORT_TYPES,PUBLIC_STATIONS,LIMITS,nearest} from '../reports.js';
import {progressLine,stagePill} from '../progress.js';
import {createScene} from '../scene.js';

const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let stations=PUBLIC_STATIONS.map(s=>({...s,open:0,changes:0})),current=null,data=null,scene=null,project=null,pin=null,step=1,photos=[],type=null,busy=false;
const when=iso=>{const d=new Date(iso);return d.toLocaleDateString('ko-KR',{month:'long',day:'numeric'})+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});};
function toast(text){const t=$('#toast');t.textContent=text;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),4200);}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...(typeof opts.body==='string'?{'Content-Type':'application/json'}:{}),...opts.headers}});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.error||'요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');return v;}

// ---- Stations
function renderStations(){
 const q=$('#stationSearch').value.trim().replace(/역$/,''),rows=stations.filter(s=>!q||s.name.includes(q)).sort((a,b)=>(b.connected-a.connected)||a.name.localeCompare(b.name,'ko'));
 $('#stationCount').textContent=q?rows.length+'개 역':'VWorld 실내지도가 있는 KTX역 '+stations.length+'곳 · 3D 연결 '+stations.filter(s=>s.connected).length+'곳';
 $('#stationList').innerHTML=rows.map(s=>'<li><button type="button" data-station="'+esc(s.key)+'"><span class="name">'+esc(s.name)+'</span><span class="meta">'+(s.connected?'3D 지도에서 위치 찍기':'사진과 위치 설명으로 제보')+(s.changes?' · 승인 '+s.changes+'건':'')+(s.open?' · 검토 중 '+s.open+'건':'')+'</span><span class="badge'+(s.connected?' on':'')+'">'+(s.connected?'3D':'준비 중')+'</span></button></li>').join('')||'<li class="empty">찾는 역이 없어요. 46개 KTX역 중에서 골라 주세요.</li>';
}
$('#stationSearch').addEventListener('input',renderStations);
$('#stationList').addEventListener('click',e=>{const b=e.target.closest('[data-station]');if(b)openStation(b.dataset.station);});
api('/api/public/stations').then(v=>{stations=v.stations;renderStations();}).catch(()=>renderStations());
renderStations();

// ---- Station view
function ensureCesium(){if(window.Cesium)return Promise.resolve();return new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='https://cesium.com/downloads/cesiumjs/releases/1.142/Build/Cesium/Widgets/widgets.css';document.head.append(css);
 const s=document.createElement('script');s.src='https://cesium.com/downloads/cesiumjs/releases/1.142/Build/Cesium/Cesium.js';s.onload=()=>resolve();s.onerror=()=>reject(Error('3D 렌더러를 불러오지 못했어요. 사진과 위치 설명으로도 제보할 수 있어요.'));document.head.append(s);});}
function buildProject(v){
 const st={id:v.station.key,name:v.station.name,centre:v.station.centre,floors:v.station.floors,heights:v.station.heights,default_floor:v.station.default_floor};
 return {schema_version:1,site_id:st.id,station:st,name:st.name,source:st.id==='S202103'?'seoul-snapshot':'vworld',tileset_url:'',assets:[],connections:[],routes:[],observations:[],
  points:[...v.facilities.map(f=>({id:'F:'+f.id,name:f.kind==='group'?'':f.name,floor:f.floor,role:f.kind==='group'?'via':'facility',position:f.position})),...v.endpoints.map(e=>({id:'E:'+e.id,name:e.name,floor:e.floor,role:'origin',position:e.position}))],
  overlays:v.overlays||[]};
}
function renderChanges(list){const drawn=new Set((data?.overlays||[]).map(o=>o.alias));$('#changeList').innerHTML=list.length?list.map(c=>'<li><figure>'+(c.before?'<img src="'+esc(c.before)+'" alt="이전 '+esc(c.name)+'" loading="lazy">':'<span class="blank">이전</span>')+'<span aria-hidden="true">→</span><img src="'+esc(c.after)+'" alt="바뀐 '+esc(c.name)+'" loading="lazy"></figure><div><b>'+esc(c.name)+'</b><small>'+esc(c.status_label)+' · '+when(c.decided_at)+'</small>'+(drawn.has(c.alias)?'<button type="button" class="link" data-overlay="'+esc(c.alias)+'">지도에서 보기</button>':'')+'</div></li>').join(''):'<li class="empty">아직 승인된 변경이 없어요. 첫 제보를 보내 주세요.</li>';}
$('#changeList').addEventListener('click',e=>{const b=e.target.closest('[data-overlay]'),o=b&&data?.overlays?.find(x=>x.alias===b.dataset.overlay);if(!o||!scene)return;$('#floor').value=o.floor;
 scene.focusFacade({floor:o.floor,longitude:o.position[0],latitude:o.position[1],height:o.position[2],cameraHeading:o.heading,surfaceWidth:o.surface?.[0],surfaceHeight:o.surface?.[1],label:o.name,imageId:o.alias});$('#map').scrollIntoView({block:'nearest',behavior:'smooth'});});
function updatePin(){const connected=current?.connected;$('#pinStatus').textContent=!connected?'':pin?pin.floor+' · 고른 위치'+(pin.near?' · '+pin.near+' 근처':''):'지도를 눌러 현장과 다른 곳을 골라 주세요';$('#reportHere').classList.toggle('ready',!connected||Boolean(pin));}
function onPick(p){if(!current?.connected||!project||!Array.isArray(p?.position))return;
 pin={floor:p.floor,position:p.position,view:p.view||null,near:nearest(data.facilities,p.position,p.floor,15)?.name||null};
 project.points=project.points.filter(x=>x.id!=='PIN').concat({id:'PIN',name:'제보할 위치',floor:p.floor,role:'connection',position:p.position});
 scene.render(project);updatePin();}
async function openStation(key,{push=true}={}){
 current=stations.find(s=>s.key===key);if(!current)return;
 $('#home').hidden=true;$('#station').hidden=false;$('#stationTitle').innerHTML=esc(current.name)+' <span class="badge'+(current.connected?' on':'')+'">'+(current.connected?'3D':'준비 중')+'</span>';
 $('#stationInbox').href='/console/?station='+encodeURIComponent(key)+'&stage=all';
 if(push)history.pushState({station:key},'','?station='+encodeURIComponent(key));
 pin=null;project=null;updatePin();$('#stationNote').textContent='';$('#changeList').innerHTML='<li class="empty">불러오는 중…</li>';
 try{data=await api('/api/public/station?key='+encodeURIComponent(key));}catch(e){data={station:current,facilities:[],endpoints:[],changes:[]};toast(e.message);}
 renderChanges(data.changes||[]);$('#stationNote').textContent=data.note||'';
 const connected=current.connected&&data.station.floors;
 $('#noMap').hidden=Boolean(connected);$('#map').hidden=!connected;$('#floor').disabled=!connected;$('#sceneStatus').hidden=!connected;
 $('#floor').innerHTML=connected?data.station.floors.map(f=>'<option'+(f===data.station.default_floor?' selected':'')+'>'+f+'</option>').join(''):'<option>—</option>';
 if(!connected){updatePin();return;}
 project=buildProject(data);
 try{if(key!=='S202103')await ensureCesium();
  scene||=await createScene(onPick,{labels:{loading:current.name+' 3D 지도를 불러오는 중…',ready:'지도를 눌러 현장과 다른 곳을 고르세요'}});
  await scene.connect(project);scene.setGrid(false);
 }catch(e){$('#sceneStatus').textContent=e.message;}
}
function showHome(){current=null;$('#station').hidden=true;$('#home').hidden=false;}
$('#backHome').onclick=()=>{history.pushState({},'','/');showHome();};
addEventListener('popstate',()=>{const k=new URLSearchParams(location.search).get('station');if(k)openStation(k,{push:false});else showHome();});
$('#floor').onchange=()=>scene?.setFloor($('#floor').value);
$('#reportHere').onclick=()=>{if(current?.connected&&!pin){toast('먼저 지도에서 현장과 다른 곳을 눌러 주세요.');$('#pinStatus').classList.add('nudge');setTimeout(()=>$('#pinStatus').classList.remove('nudge'),900);return;}openSheet();};

// ---- Report sheet: 1 위치 → 2 사진·내용 (photos, their captions and marks, and the description together)
function openSheet(){step=1;photos.forEach(p=>URL.revokeObjectURL(p.url));photos=[];type=null;$('#description').value='';$('#consent').checked=false;$('#sheetError').textContent='';renderSheet();$('#sheet').showModal();}
function placeBox(){
 if(current.connected)return '<div class="place"><b>'+esc(current.name)+' · '+esc(pin.floor)+'</b><span>지도에서 고른 위치'+(pin.near?' · '+esc(pin.near)+' 근처':'')+'</span><button type="button" id="repick" class="link">지도에서 다시 고르기</button></div>';
 return '<p class="fine">'+esc(current.name)+'은 3D 지도 연결 전이라 위치를 글로 적어 주세요.</p><label for="placeFloor">층 <small>(선택 · 예: 2F, B1)</small></label><input id="placeFloor" maxlength="3" autocomplete="off"><label for="placeNote">위치 설명</label><textarea id="placeNote" rows="2" maxlength="200" placeholder="예: 2층 대합실 동쪽 출구 옆"></textarea>';
}
function renderSheet(){
 for(const s of document.querySelectorAll('[data-panel]'))s.hidden=s.dataset.panel!==String(step);
 for(const li of document.querySelectorAll('.steps li')){li.classList.toggle('on',Number(li.dataset.step)===step);li.classList.toggle('done',step==='done'||Number(li.dataset.step)<step);}
 $('#sheet').classList.toggle('wide',step===2);
 if(step===1){$('#placeBox').innerHTML=placeBox();$('#repick')&&($('#repick').onclick=()=>$('#sheet').close());}
 if(step===2){renderTypes();renderShots();countDesc();}
 $('#prevStep').hidden=step===1||step==='done';$('#nextStep').hidden=step==='done';$('#nextStep').textContent=step===2?'제보 보내기':'다음';$('#nextStep').disabled=busy;
}
function renderTypes(){
 $('#typeChoices').innerHTML=REPORT_TYPES.map(t=>'<label class="chip"><input type="radio" name="type" value="'+t.id+'"'+(type===t.id?' checked':'')+'><span>'+esc(t.label)+'</span></label>').join('');
 $('#typeHint').textContent=REPORT_TYPES.find(t=>t.id===type)?.hint||'유형을 하나 골라 주세요.';
}
const countDesc=()=>{$('#descCount').textContent=$('#description').value.length+' / '+LIMITS.description+'자';};
$('#description').addEventListener('input',countDesc);
$('#typeChoices').addEventListener('change',e=>{if(e.target.name==='type'){type=e.target.value;$('#sheetError').textContent='';$('#typeHint').textContent=REPORT_TYPES.find(t=>t.id===type)?.hint||'';}});
// Each photo: tap the picture to mark what differs, caption it right below.
function renderShots(){
 $('#shots').innerHTML=photos.map((p,i)=>'<li class="shot"><div class="frame" data-frame="'+i+'" role="button" tabindex="0" aria-label="사진 '+(i+1)+' · 눌러서 달라진 곳 표시"><img src="'+p.url+'" alt="사진 '+(i+1)+'">'+(p.mark?'<span class="mark" style="left:'+p.mark[0]*100+'%;top:'+p.mark[1]*100+'%"><b>'+(i+1)+'</b></span>':'<span class="tap">눌러서 표시</span>')+'</div>'
  +'<div class="shot-foot"><input class="caption" data-caption="'+i+'" maxlength="'+LIMITS.caption+'" value="'+esc(p.caption||'')+'" placeholder="사진 '+(i+1)+'에서 달라진 점 (선택)" aria-label="사진 '+(i+1)+' 설명">'
  +(p.mark?'<button type="button" class="link" data-unmark="'+i+'">표시 지우기</button>':'')+'<button type="button" class="link" data-remove="'+i+'" aria-label="사진 '+(i+1)+' 빼기">빼기</button></div></li>').join('');
 $('#pickLabel').innerHTML=photos.length?'＋ 사진 더 추가 <small>('+photos.length+'/'+LIMITS.photos+'장)</small>':'＋ 사진 추가 <small>(1~'+LIMITS.photos+'장)</small>';
 $('#pickLabel').parentElement.hidden=photos.length>=LIMITS.photos;
}
$('#shots').addEventListener('click',e=>{
 const rm=e.target.closest('[data-remove]');if(rm){const [p]=photos.splice(Number(rm.dataset.remove),1);URL.revokeObjectURL(p.url);renderShots();return;}
 const um=e.target.closest('[data-unmark]');if(um){photos[Number(um.dataset.unmark)].mark=null;renderShots();return;}
 const f=e.target.closest('[data-frame]');if(!f)return;const img=f.querySelector('img').getBoundingClientRect(),i=Number(f.dataset.frame);
 photos[i].mark=[Math.min(1,Math.max(0,(e.clientX-img.left)/img.width)),Math.min(1,Math.max(0,(e.clientY-img.top)/img.height))];
 renderShots();document.querySelector('[data-caption="'+i+'"]')?.focus();
});
$('#shots').addEventListener('keydown',e=>{const f=e.target.closest('[data-frame]');if(!f||!['Enter',' '].includes(e.key))return;e.preventDefault();const i=Number(f.dataset.frame);photos[i].mark||=[.5,.5];renderShots();document.querySelector('[data-caption="'+i+'"]')?.focus();});
$('#shots').addEventListener('input',e=>{const c=e.target.closest('[data-caption]');if(c)photos[Number(c.dataset.caption)].caption=c.value;});
$('#closeSheet').onclick=()=>$('#sheet').close();
$('#prevStep').onclick=()=>{if(step===2){step=1;renderSheet();}};
$('#nextStep').onclick=()=>{
 $('#sheetError').textContent='';
 if(step===1){if(!current.connected&&!$('#placeNote').value.trim()){$('#sheetError').textContent='위치를 글로 적어 주세요.';return;}
  if(!current.connected){pin={floor:$('#placeFloor').value.trim().toUpperCase()||null,note:$('#placeNote').value.trim()};}step=2;return renderSheet();}
 if(step===2)submit();
};
// Resize to 2048 px and re-encode as JPEG (no EXIF/GPS leaves the phone); the 48 px mosaic is what strangers see.
async function prepare(file){
 let src;try{src=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{src=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(Error(file.name+'은(는) 열 수 없는 사진이에요. JPEG나 PNG로 올려 주세요.'));im.src=URL.createObjectURL(file);});}
 const w=src.width,h=src.height,k=Math.min(1,2048/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(src,0,0,c.width,c.height);
 let q=.88,blob;do{blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));q-=.12;}while(blob&&blob.size>LIMITS.photoBytes&&q>.4);
 if(!blob)throw Error('사진을 준비하지 못했어요.');
 const m=document.createElement('canvas'),km=48/Math.max(c.width,c.height),mx=m.getContext('2d');m.width=Math.max(1,Math.round(c.width*km));m.height=Math.max(1,Math.round(c.height*km));mx.imageSmoothingQuality='high';mx.drawImage(c,0,0,m.width,m.height);
 return {blob,url:URL.createObjectURL(blob),width:c.width,height:c.height,preview:m.toDataURL('image/jpeg',.7),caption:'',mark:null};
}
$('#photoInput').addEventListener('change',async e=>{const files=[...e.target.files];e.target.value='';
 for(const f of files){if(photos.length>=LIMITS.photos){toast('사진은 '+LIMITS.photos+'장까지 올릴 수 있어요.');break;}try{photos.push(await prepare(f));}catch(err){toast(err.message);}}renderShots();});
async function submit(){
 if(!type){$('#sheetError').textContent='무엇이 달라졌는지 골라 주세요.';return;}
 if(!photos.length){$('#sheetError').textContent='사진을 한 장 이상 올려 주세요.';return;}
 if(!$('#consent').checked){$('#sheetError').textContent='사진과 내용 사용 동의에 체크해 주세요.';return;}
 busy=true;renderSheet();const btn=$('#nextStep');
 try{
  btn.textContent='보내는 중…';
  const r=await api('/api/reports',{method:'POST',body:JSON.stringify({station:current.key,floor:pin?.floor??null,position:current.connected?pin.position:null,view:pin?.view||null,place_note:current.connected?'':pin?.note||'',type,description:$('#description').value.trim(),consent:true})});
  const ids=[];
  for(const [i,p] of photos.entries()){btn.textContent='사진 올리는 중 '+(i+1)+'/'+photos.length;const up=await fetch(r.photos,{method:'POST',headers:{'Content-Type':p.blob.type},body:p.blob});const v=await up.json().catch(()=>({}));if(!up.ok)throw Error(v.error||'사진을 올리지 못했어요.');ids.push(v.id);}
  btn.textContent='정리하는 중…';
  const s=await api('/api/reports/'+r.id+'/submit',{method:'POST',body:JSON.stringify({photos:photos.map((p,i)=>({id:ids[i],caption:p.caption||'',mark:p.mark,preview:p.preview}))})});
  step='done';$('#doneText').textContent=current.name+' 제보가 '+(s.status_label||'접수')+' 상태예요. 제보함에서 누구나 진행 상황을 볼 수 있고, 승인자가 확인하면 내 제보에 결과가 남아요.';
  if(current.connected){pin=null;project.points=project.points.filter(x=>x.id!=='PIN');scene?.render(project);updatePin();}
 }catch(e){$('#sheetError').textContent=e.message;}
 busy=false;renderSheet();
}
$('#doneMore').onclick=()=>$('#sheet').close();
$('#doneMine').onclick=()=>{$('#sheet').close();openMine();};

// ---- My reports: progress line, photos with what I said about them, the approver's note
const photoCard=p=>'<figure class="note-photo"><div class="frame"><img src="'+esc(p.src)+'" alt="" loading="lazy">'+(p.mark?'<span class="mark" style="left:'+p.mark[0]*100+'%;top:'+p.mark[1]*100+'%"></span>':'')+'</div>'+(p.caption?'<figcaption>'+esc(p.caption)+'</figcaption>':'')+'</figure>';
async function openMine(){
 $('#mine').showModal();$('#mineList').innerHTML='<p class="fine">불러오는 중…</p>';
 try{const v=await api('/api/reports/mine');
  $('#mineList').innerHTML=v.reports.length?v.reports.map(r=>'<article class="report"><header><b>'+esc(r.station_name)+(r.floor?' · '+esc(r.floor):'')+'</b>'+stagePill(r)+'</header>'+progressLine(r)
   +'<p class="what"><b>'+esc(r.type_label)+'</b>'+(r.description?' · '+esc(r.description):'')+(r.place_note?'<br><small>'+esc(r.place_note)+'</small>':'')+'</p>'
   +(r.reason?'<p class="reason">승인자 메모: '+esc(r.reason)+'</p>':'')+(r.photos.length?'<div class="note-photos">'+r.photos.map(photoCard).join('')+'</div>':'')
   +(r.status==='received'?'':'<a class="inbox-link" href="/console/?report='+esc(r.id)+'">제보함에서 보기 →</a>')+'</article>').join(''):'<p class="fine">아직 보낸 제보가 없어요. 역을 골라 현장과 다른 곳을 알려 주세요.</p>';
 }catch(e){$('#mineList').innerHTML='<p class="error">'+esc(e.message)+'</p>';}
}
$('#openMine').onclick=openMine;$('#closeMine').onclick=()=>$('#mine').close();

const first=new URLSearchParams(location.search).get('station');if(first)openStation(first,{push:false});
