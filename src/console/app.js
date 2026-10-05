// Report inbox. Anyone sees where each report stands (progress, description, captions, mosaic photos); approvers sign in
// with a name and password to see originals, correct facades onto their slot's pixel grid, propose and approve.
// AI agents may read and prepare proposals through WebMCP with an approver session, never approve.
import './style.css';
import {PUBLIC_STATIONS,STATUS,STAGE_FILTERS,PHOTO_VIEWS,STRUCTURE_FACES,photoViewLabel,photoCoverage,preferredPhoto,nearest,connectedStation} from '../reports.js';
import {initialStructure,structureSlot,structureFields,readStructure,modelMarkup,resizeBlurs} from './structure.js';
import {progressLine,stagePill} from '../progress.js';
import {warp,autoLevels,pixelate,defaultQuad,mapBox} from '../rectify.js';
import {createScene} from '../scene.js';
import {workCard,bindWork,stopWorkPoll} from './ai-work.js';
import {createEbiChat} from './ebi-chat.js';

const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tone={received:'mute',analyzing:'mute',review:'info',queued:'lime',applied:'ok',held:'warn',duplicate:'mute',rejected:'warn'};
const params=new URLSearchParams(location.search);
let session={approver:null},stage=STAGE_FILTERS.some(f=>f.id===params.get('stage'))?params.get('stage'):'review',list=[],summary={},detail=null,bench=null,scene=null;
// 로/으로 after a Korean word (ㄹ and open syllables take 로).
const ro=w=>{const c=w.charCodeAt(w.length-1)-0xAC00;return c>=0&&c<11172&&c%28&&c%28!==8?'으로':'로';};
const ago=iso=>{const m=Math.round((Date.now()-Date.parse(iso))/60000);return m<1?'방금':m<60?m+'분 전':m<1440?Math.round(m/60)+'시간 전':Math.round(m/1440)+'일 전';};
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),4200);}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...(typeof opts.body==='string'?{'Content-Type':'application/json'}:{}),...opts.headers}});const v=await r.json().catch(()=>({}));
 if(r.status===401&&v.login){session.approver=null;renderWho();openLogin();}
 if(!r.ok)throw Object.assign(Error(v.error||'요청을 처리하지 못했어요.'),{status:r.status,body:v});return v;}
const ebiChat=createEbiChat({api,toast,onOpenWork:()=>$('.ai-work')?.scrollIntoView({behavior:'smooth',block:'start'}),onOpenDraft:async({reportId,proposalId})=>{if(detail?.report.id!==reportId)return;await openReport(reportId);if(detail?.report.id!==reportId)return;const proposal=[...document.querySelectorAll('[data-proposal]')].find(el=>el.dataset.proposal===proposalId);(proposal||$('#proposalList'))?.scrollIntoView({behavior:'smooth',block:'start'});}});
ebiChat.mount($('#ebiChatPanel'));
addEventListener('pagehide',()=>ebiChat.clear());
function syncUrl(){const q=new URLSearchParams();if($('#fStation').value)q.set('station',$('#fStation').value);q.set('stage',stage);if(detail)q.set('report',detail.report.id);history.replaceState(null,'','?'+q);}

// ---- Approver session (name + password → HttpOnly session cookie)
async function loadSession(){session=await api('/api/session').catch(()=>({approver:null}));renderWho();}
function renderWho(){const a=session.approver;$('#who').hidden=!a;$('#who').textContent=a?'승인자 '+a:'';$('#loginBtn').hidden=Boolean(a);$('#logoutBtn').hidden=!a;ebiChat.report(detail,a);}
function openLogin(){if($('#loginDialog').open)return;$('#loginError').textContent=session.approvers_configured===false?'승인자 계정이 아직 설정되지 않았어요. 운영자에게 문의하세요.':'';$('#loginDialog').showModal();$('#loginName').focus();}
$('#loginBtn').onclick=openLogin;$('#loginCancel').onclick=()=>$('#loginDialog').close();
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const btn=$('#loginSubmit');btn.disabled=true;
 try{await api('/api/console/login',{method:'POST',body:JSON.stringify({name:$('#loginName').value,password:$('#loginPw').value})});$('#loginPw').value='';$('#loginDialog').close();await loadSession();toast('승인자로 로그인했어요.');await refresh();}
 catch(err){$('#loginError').textContent=err.message;}
 btn.disabled=false;});
$('#logoutBtn').onclick=async()=>{await api('/api/console/logout',{method:'POST',body:'{}'}).catch(()=>{});await loadSession();toast('로그아웃했어요.');await refresh();};
async function refresh(){await loadList();if(detail)await openReport(detail.report.id);}

// ---- Inbox: stage bar (counts per progress bucket) and rows with a compact progress line
function renderStages(){$('#stageBar').innerHTML=STAGE_FILTERS.map(f=>'<button type="button" data-stage="'+f.id+'" class="stage s-'+f.id+'" aria-pressed="'+(stage===f.id)+'"><b>'+(summary[f.id]??0)+'</b><span>'+esc(f.label)+'</span></button>').join('');}
async function loadList(){
 const q=new URLSearchParams({stage,station:$('#fStation').value});
 try{const v=await api('/api/console/reports?'+q);list=v.reports;summary=v.summary;}catch(e){toast(e.message);list=[];}
 renderStages();$('#inboxCount').textContent=(STAGE_FILTERS.find(f=>f.id===stage)?.label||'')+' '+list.length+'건';
 $('#inboxList').innerHTML=list.map(r=>'<li><button type="button" data-report="'+r.id+'" class="'+(detail?.report.id===r.id?'on':'')+'">'
  +(r.cover?'<img class="cover" src="'+esc(r.cover)+'" alt="">':'<span class="cover none" aria-hidden="true">'+(r.hidden?'✕':'')+'</span>')
  +'<span class="body"><span class="row"><b>'+esc(r.type_label)+'</b>'+stagePill(r)+'</span>'
  +'<span class="where">'+esc(r.station_name)+(r.floor?' · '+esc(r.floor):'')+(r.slot?' · '+esc(r.slot.name):'')+'</span>'
  +'<span class="desc">'+esc(r.hidden?'반려된 제보예요':(r.description||r.place_note||'설명 없음'))+'</span>'+progressLine(r,{compact:true})
  +'<span class="row fine"><span>사진 '+r.photo_count+'장</span>'+(r.group?.size>1?'<span>같은 곳 '+r.group.size+'건</span>':'')+'<span>'+ago(r.created_at)+'</span></span></span></button></li>').join('')||'<li class="empty">이 단계의 제보가 없어요.</li>';
}
$('#stageBar').addEventListener('click',e=>{const b=e.target.closest('[data-stage]');if(!b)return;stage=b.dataset.stage;syncUrl();loadList();});
$('#inboxList').addEventListener('click',e=>{const b=e.target.closest('[data-report]');if(b)openReport(b.dataset.report);});
$('#fStation').onchange=()=>{syncUrl();loadList();};$('#reload').onclick=loadList;

// ---- Detail: progress, what the reporter said next to the photos, the automatic sorting, proposals, then actions
const photoSrc=(p,originals)=>originals&&p.src?p.src:p.preview;
function viewer(p,i,originals){const src=photoSrc(p,originals),mosaic=!(originals&&p.src);
 return '<figure class="shot-view"><div class="frame'+(mosaic?' mosaic':'')+'">'+(src?'<img src="'+esc(src)+'" alt="제보 사진 '+(i+1)+(mosaic?' (흐린 공개용)':'')+'">':'<span class="noimg">공개용 사진이 없어요</span>')
  +(p.mark?'<span class="mark" style="left:'+p.mark[0]*100+'%;top:'+p.mark[1]*100+'%"><b>'+(i+1)+'</b></span>':'')+'</div><figcaption><b>사진 '+(i+1)+' · '+esc(photoViewLabel(p.view_role))+'</b>'+(p.caption?' · '+esc(p.caption):'')+'</figcaption></figure>';}
function contentCard(r){
 if(r.hidden)return '<section class="card"><h3>제보 내용</h3><p class="fine">반려된 제보의 내용과 사진은 승인자만 볼 수 있어요.</p></section>';
 const ps=r.photos;
 return '<section class="card content"><h3>제보 내용 <small>'+(r.originals?'사진 원본':'흐린 공개용 사진 · 원본은 승인자만 봐요')+'</small></h3><div class="evidence-view"><div class="viewer"><div id="viewerBox">'+(ps.length?viewer(ps[0],0,r.originals):'<p class="fine">사진이 없어요.</p>')+'</div>'
  +(ps.length>1?'<div class="strip">'+ps.map((p,i)=>{const src=photoSrc(p,r.originals);return '<button type="button" data-photo="'+i+'" class="'+(i===0?'on':'')+(r.originals?'':' mosaic')+'" aria-label="사진 '+(i+1)+' · '+esc(photoViewLabel(p.view_role))+'">'+(src?'<img src="'+esc(src)+'" alt="">':'<span>'+(i+1)+'</span>')+'<span>'+esc(photoViewLabel(p.view_role))+'</span></button>';}).join('')+'</div>':'')+'<p class="fine photo-coverage">'+PHOTO_VIEWS.map(v=>esc(v.label)+' '+photoCoverage(ps)[v.id]+'장').join(' · ')+'</p></div>'
  +'<div class="words"><p class="lead-desc">'+(r.description?esc(r.description):'<span class="fine">자세한 설명 없이 사진만 보냈어요.</span>')+'</p>'+(r.place_note?'<p class="fine">위치 설명 · '+esc(r.place_note)+'</p>':'')
  +(ps.some(p=>p.caption)?'<ol class="captions">'+ps.map((p,i)=>p.caption?'<li><button type="button" class="link" data-photo="'+i+'">사진 '+(i+1)+'</button> '+esc(p.caption)+'</li>':'').join('')+'</ol>':'')+'</div></div></section>';
}
function analysisCard(r){const a=r.analysis,ai=a.ai;
 return '<section class="card"><h3>'+(a.mode==='ai'?'AI 정리':'자동 정리')+(a.mode!=='ai'?' <small>위치·중복 규칙</small>':'')+'</h3><dl class="facts">'
  +(a.slot?'<dt>파사드 자리</dt><dd><b>'+esc(a.slot.name)+'</b> '+esc(a.slot.alias)+' · '+a.slot.distance+'m · '+a.slot.px.join('×')+' px</dd>':'<dt>파사드 자리</dt><dd>'+(r.position?'12m 안에 없음':'3D 연결 전 역 · 위치 설명 참고')+'</dd>')
  +(a.facility?'<dt>가까운 시설</dt><dd>'+esc(a.facility.name)+' · '+a.facility.distance+'m</dd>':'')
  +'<dt>같은 곳 제보</dt><dd>'+(a.group?.size||1)+'건'+(detail.group.length?' · '+detail.group.map(g=>g.status_label).join(', '):'')+'</dd>'
  +(a.suggestion?'<dt>'+(a.mode==='ai'?'AI 제안':'제안 작업')+'</dt><dd>'+esc(a.suggestion.label)+'</dd>':'')
  +(ai?'<dt>간판 글자</dt><dd>'+esc(ai.signage_text||'읽지 못함')+(ai.same_as_registered===false?' · 등록 매장과 다름':ai.same_as_registered===true?' · 등록 매장과 같음':'')+'</dd><dt>사진 상태</dt><dd>'+(ai.quality?[ai.quality.sharp?'선명':'흐림',ai.quality.lit?'밝음':'어두움',ai.quality.frontal?'정면':'비스듬함'].join(' · '):'—')+' · 사람 '+ai.people.length+'곳</dd><dt>요약</dt><dd>'+esc(ai.summary||'')+'</dd>':'')
  +(a.notes?.length?'<dt>참고</dt><dd class="warn">'+a.notes.map(esc).join('<br>')+'</dd>':'')+'</dl></section>';}
function decideCard(r){if(['queued','applied'].includes(r.status))return '<section class="card"><h3>승인 처리 완료</h3><p>'+ (r.status==='queued'?'승인된 제보입니다. 아직 지도에 반영되지 않았습니다.':'공개 지도에 반영되었습니다.')+'</p></section>';return '<section class="card decide"><h3>판단</h3><label for="reason">제보자에게 보일 사유 <small>(보류·중복·반려·제안 반려 시 필수 · 공개돼요)</small></label><textarea id="reason" rows="2" maxlength="300" placeholder="예: 공사 기간을 확인하고 있어요"></textarea>'
 +'<div class="buttons"><button type="button" data-decide="held">보류</button><button type="button" data-decide="duplicate">중복</button><button type="button" data-decide="rejected">반려</button><button type="button" data-decide="review">다시 검토</button><button type="button" id="reanalyze">다시 정리</button><a class="button" href="/editor/'+(r.station_key.startsWith('name:')?'':'?station='+encodeURIComponent(r.station_key))+'">편집기에서 열기 ↗</a></div>'
 +(detail.locked?'<p class="fine">서울역은 최종 승인해도 “반영 대기”로 보관합니다. 잠금 해제 후 별도 반영이 필요합니다.</p>':'')+'</section>';}
function adoptionCard(r){if(!session.approver||!['new','facade','removed'].includes(r.type)||!['review','held','accepted'].includes(r.status))return '';return '<section class="card adoption"><h3>① 제보 채택 → ② 초안·보정 → ③ 최종 승인</h3><p>채택은 작업을 시작한다는 뜻이며 지도에는 반영되지 않습니다. '+(detail.locked?'최종 승인 결과도 반영 대기로 보관됩니다.':'최종 승인 후 공개 지도에 반영됩니다.')+'</p>'+(r.status==='accepted'?'<b>채택됨 · 아래 AI 자동 작업 또는 수동 작업대에서 초안을 준비하세요.</b>':'<button type="button" class="primary" data-decide="accepted">제보 채택 · 작업 시작</button>')+'</section>';}
const callout='<section class="card callout"><div><b>보정·승인은 승인자가 해요</b><p class="fine">사진 원본 확인, 파사드 정면 보정, 제안 승인과 보류·반려 판단은 로그인한 승인자만 할 수 있어요.</p></div><button type="button" class="primary" data-login>승인자 로그인</button></section>';
async function openReport(id){
 stopWorkPoll();
 try{detail=await api('/api/console/reports/'+id);}catch(e){toast(e.message);return;}
 bench=null;syncUrl();
 for(const b of document.querySelectorAll('[data-report]'))b.classList.toggle('on',b.dataset.report===id);
 const r=detail.report,a=r.analysis,approver=Boolean(session.approver);
 ebiChat.report(detail,session.approver);
 $('#detailBody').innerHTML='<header class="d-head"><div>'+stagePill(r)+' <b>'+esc(r.type_label)+'</b> · '+esc(r.station_name)+(r.floor?' · '+esc(r.floor):'')+' · '+ago(r.created_at)+(r.user?' · 로그인 제보자':' · 비로그인 제보자')+'</div>'+(a?.confidence!=null?'<div class="confbar" style="--c:'+a.confidence+'"><span>신뢰 '+a.confidence.toFixed(2)+'</span><i></i></div>':'')+'</header>'
  +'<section class="card progress-card">'+progressLine(r)+(r.reason?'<p class="note-reason">승인자 메모 · '+esc(r.reason)+'</p>':'')+'</section>'
  +adoptionCard(r)+contentCard(r)+(a?analysisCard(r):'')+workCard(detail)
  +(approver?'<section id="bench" class="card bench" hidden></section>':'')
  +'<section class="card"><h3>제안</h3><div id="proposalList" class="proposals"></div></section>'
  +(approver?decideCard(r):callout);
 renderProposals();
 bindWork(detail,{api,refresh,toast,isCurrent:id=>detail?.report.id===id&&Boolean(session.approver)});
 for(const b of document.querySelectorAll('[data-login]'))b.onclick=openLogin;
 if(approver){
  for(const b of document.querySelectorAll('[data-decide]'))b.onclick=()=>decide(b.dataset.decide);
  if($('#reanalyze'))$('#reanalyze').onclick=async()=>{try{await api('/api/console/reports/'+r.id+'/analyze',{method:'POST',body:'{}'});toast('다시 정리했어요.');openReport(r.id);}catch(e){toast(e.message);}};
 }
 const canBench=approver&&(r.type==='new'?r.status==='accepted':(r.type==='facade'||a?.slot)&&['review','accepted'].includes(r.status))&&r.photos.some(p=>p.src);
 $('#map3dCard').hidden=true;
 if(canBench){$('#bench').hidden=false;await setupBench(a?.slot||null);}
}
// Photo switching: the strip, the caption list, and (for approvers) the correction bench follow the same photo.
$('#detailBody').addEventListener('click',e=>{const b=e.target.closest('[data-photo]');if(!b||!detail)return;const i=Number(b.dataset.photo),r=detail.report;
 $('#viewerBox').innerHTML=viewer(r.photos[i],i,r.originals);for(const x of document.querySelectorAll('.strip [data-photo]'))x.classList.toggle('on',Number(x.dataset.photo)===i);
 if(bench&&bench.photo!==i)selectBenchPhoto(i).catch(e=>toast(e.message));});
function renderProposals(){
 const ps=detail.proposals,approver=Boolean(session.approver);
 $('#proposalList').innerHTML=ps.length?ps.map(p=>'<article class="proposal" data-proposal="'+esc(p.id)+'"><figure>'+(p.target.before?'<img src="'+esc(p.target.before)+'" alt="지금 지도">':'<span class="pending">'+(p.kind==='structure'?'새 구조물 · 아직 지도에 없음':p.kind==='removal'?'독립 등록된 구조물':'VWorld 원본 텍스처')+'</span>')+'<figcaption>변경 전</figcaption></figure><span aria-hidden="true">→</span><figure>'+(p.image?'<img src="'+esc(p.image)+'" alt="제안 이미지">':'<span class="pending">'+(p.kind==='removal'?'승인 후 숨김 · 원본 보존':'승인자 확인 중')+'</span>')+'<figcaption>제안 '+esc((p.target.px||[]).join('×'))+'</figcaption></figure>'
  +'<div><b>'+esc(p.target.name)+({structure:' · 새 구조물',removal:' · 장애물 숨김',facade:' · 파사드 교체'}[p.kind]||'')+'</b><span class="pill '+(p.status==='ready'?'info':tone[p.status]||'mute')+'">'+esc(STATUS[p.status]||p.status)+'</span>'+(p.reviewer?'<span class="fine">'+esc(p.reviewer)+'</span>':'')+(p.reason?'<p class="fine">'+esc(p.reason)+'</p>':'')+'</div>'
  +(p.meta?.ai_job?'<section class="ai-effects"><b>AI 초안의 실제 변경 대상</b><p>'+esc(p.meta.summary)+'</p><ul>'+(p.target.effects||[]).map(e=>{const before=e.action==='hide'?JSON.parse(e.before):null;return '<li><strong>'+({hide:'숨김',create:'생성',replace:'파사드 교체'}[e.action]||'변경')+'</strong> · '+esc(e.label)+' <small>'+esc(e.id)+'</small>'+(before?'<br>'+esc(before.floor)+' · '+esc(before.position?.join(', '))+' · '+esc(before.size?.join('×'))+'m'+modelMarkup(before,before.facades||{})+'현재: 표시 → 승인 후: 숨김 · 원본과 복원 정보 보존':'')+'</li>';}).join('')+'</ul><p class="fine">원본 공유 모델은 자동 제거하지 않습니다. 사진에서 가려진 모양이나 면은 AI로 임의 생성하지 않습니다.</p></section>':'')
  +(p.kind==='structure'&&p.image?'<section class="saved-model">'+modelMarkup(p.target.structure,p.images||p.image)+'<div class="face-results">'+Object.entries(p.images||{front:p.image}).map(([side,url])=>'<figure><img src="'+esc(url)+'" alt="보정한 '+esc(photoViewLabel(side))+'"><figcaption>'+esc(photoViewLabel(side))+'</figcaption></figure>').join('')+'</div><p class="fine">'+esc(p.target.structure.floor)+' · '+esc(p.target.structure.position.join(', '))+' · '+p.target.structure.heading+'°<br>크기 근거: '+(p.target.structure.dimension_basis==='measured'?'실측 / 도면 확인':'사진 참고 추정 · 현장 확인 필요')+'</p></section>':'')
  +(approver&&p.status==='draft'&&detail.report.status==='accepted'?'<div class="draft-checks" data-checks="'+p.id+'"><b>저장된 위 초안을 확인한 뒤 확정하세요</b><label><input type="checkbox" name="geometry"> 위치·층·크기·방향·통행 폭 확인</label><label><input type="checkbox" name="privacy"> 모든 면의 얼굴·개인정보 흐림 및 사진 공개 가능 확인 (숨김만 하는 경우 새 공개 사진 없음)</label><label><input type="checkbox" name="preview"> '+(p.kind==='removal'?'위 숨김 전·후 대상 목록':p.kind==='facade'?'보정 전·후 이미지':'위 입체 모형과 면별 사진')+' 확인</label>'+(p.meta?.ai_job?'<label><input type="checkbox" name="effects"> 숨김·생성·교체 대상 ID와 주변 시설 보존 확인</label>':'')+'<button type="button" data-ready="'+p.id+'">초안 확정 · 최종 승인 단계로</button></div>':'')
  +(approver&&p.status==='ready'&&(detail.report.status==='accepted'||p.kind==='facade'&&detail.report.status==='review')?'<div class="buttons"><button type="button" class="primary" data-approve="'+p.id+'">'+(detail.locked?'최종 승인 · 반영 대기로':'최종 승인 · 지도에 반영')+'</button><button type="button" data-reject="'+p.id+'">제안 반려</button></div>':'')
  +(approver&&p.meta?.ai_job&&p.status==='applied'&&['structure','removal'].includes(p.kind)?'<button type="button" data-undo="'+p.id+'">이 자동 작업만 되돌리기</button>':'')+'</article>').join('')
  :'<p class="fine">'+(approver?'아직 초안이 없어요. 새 구조물은 먼저 제보를 채택한 뒤 크기·위치와 사진을 보정해 초안을 저장하세요. 파사드는 기존 자리를 골라 보정합니다.':'승인자가 제보를 채택하고 초안을 준비하면 진행 상황이 표시됩니다.')+'</p>';
 for(const b of document.querySelectorAll('[data-ready]'))b.onclick=async()=>{const box=b.closest('[data-checks]');b.disabled=true;try{await api('/api/console/proposals/'+b.dataset.ready+'/ready',{method:'POST',body:JSON.stringify({geometry_checked:box.querySelector('[name=geometry]').checked,privacy_checked:box.querySelector('[name=privacy]').checked,preview_checked:box.querySelector('[name=preview]').checked,effects_checked:box.querySelector('[name=effects]')?.checked===true})});await refresh();toast('초안 확인이 끝났습니다. 최종 승인 버튼으로 처리하세요.');}catch(e){toast(e.message);b.disabled=false;}};
 for(const b of document.querySelectorAll('[data-approve]'))b.onclick=()=>decideProposal(b.dataset.approve,'approve');
 for(const b of document.querySelectorAll('[data-reject]'))b.onclick=()=>decideProposal(b.dataset.reject,'reject');
 for(const b of document.querySelectorAll('[data-undo]'))b.onclick=async()=>{if(!confirm('이 자동 작업이 변경한 대상만 복원합니다. 계속할까요?'))return;try{const v=await api('/api/console/proposals/'+b.dataset.undo+'/undo',{method:'POST',body:JSON.stringify({confirm:true})});toast(v.note);await refresh();}catch(e){toast(e.message);}};
}
async function decide(status){try{await api('/api/console/reports/'+detail.report.id+'/decision',{method:'POST',body:JSON.stringify({status,reason:$('#reason')?.value||''})});toast('‘'+STATUS[status]+'’'+ro(STATUS[status])+' 표시했어요.');await loadList();openReport(detail.report.id);}catch(e){toast(e.message);}}
async function decideProposal(id,action){try{const v=await api('/api/console/proposals/'+id+'/'+action,{method:'POST',body:JSON.stringify({reason:$('#reason')?.value||''})});toast(action==='approve'?v.note:'제안을 반려했어요.');await loadList();openReport(detail.report.id);}catch(e){toast(e.message);}}

// ---- Rectification bench (approvers): four corners → homography onto the slot's exact pixel grid
async function setupBench(slot){
 const r=detail.report,a=r.analysis||{},isStructure=r.type==='new',saved=isStructure?detail.proposals.find(p=>p.kind==='structure'&&['draft','ready'].includes(p.status)):null;let slots=[];
 if(!isStructure)try{slots=(await api('/api/console/station?key='+encodeURIComponent(r.station_key))).slots;}catch{}
 if(r.position)slots=slots.map(s=>({...s,d:s.floor===r.floor?nearest([s],r.position,r.floor,1e9)?.distance??1e9:1e9})).sort((x,y)=>x.d-y.d);
 slot=slot?slots.find(s=>s.alias===slot.alias)||slot:slots[0]||null;
 const structure=isStructure?initialStructure(r,saved?.target.structure):null;if(isStructure)slot=structureSlot(structure);
 if(!slot){$('#bench').innerHTML='<h3>정면 보정</h3><p class="fine">이 역에는 파사드 자리가 없어요. 편집기에서 구조물과 파사드를 먼저 등록하세요.</p>';return;}
 bench={slot,slots,structure,side:'front',faceStates:structuredClone(saved?.meta?.faces||{}),photo:-1,quad:null,src:null,blurs:[],drawing:false,levels:true,people:true,loading:false,loadVersion:0};
 if(saved?.meta?.photo&&!bench.faceStates.front)bench.faceStates.front={...saved.meta,px:slot.px};
 $('#bench').innerHTML=(isStructure?structureFields(structure,r.station_key):'')+'<header class="bench-head"><h3>사진 정면 보정</h3>'+(isStructure?'':'<label for="slotPick">파사드 자리</label><select id="slotPick">'+slots.map(s=>'<option value="'+esc(s.alias)+'"'+(s.alias===slot.alias?' selected':'')+'>'+esc(s.name)+' · '+esc(s.floor)+' · '+s.px.join('×')+(Number.isFinite(s.d)&&s.d<1e8?' · '+Math.round(s.d)+'m':'')+'</option>').join('')+'</select>')+'</header>'
  +'<div class="face-controls">'+(isStructure?'<label>보정할 구조물 면<select id="facePick">'+STRUCTURE_FACES.map(side=>'<option value="'+side+'"'+(!r.photos.some(p=>p.view_role===side||p.view_role==='unknown')&&!bench.faceStates[side]?' disabled':'')+'>'+esc(photoViewLabel(side))+'</option>').join('')+'</select></label>':'')+'<label>보정할 사진<select id="benchPhotoPick">'+r.photos.map((p,i)=>'<option value="'+i+'">사진 '+(i+1)+' · '+esc(photoViewLabel(p.view_role))+'</option>').join('')+'</select></label><p id="faceStatus" class="fine" role="status"></p></div>'
  +'<div class="bench-grid"><div class="stage"><div class="stage-inner"><canvas id="photoCanvas"></canvas><svg id="quadSvg" aria-hidden="true"></svg>'+['왼쪽 위','오른쪽 위','오른쪽 아래','왼쪽 아래'].map((k,i)=>'<button type="button" class="handle" data-corner="'+i+'" aria-label="'+k+' 모서리"></button>').join('')+'</div><p class="fine">네 모서리를 선택한 면(간판~바닥)의 네 귀퉁이에 맞추세요. '+(a.ai?.storefront_quad?'AI가 찾은 모서리에서 시작해요.':'제보자가 표시한 곳이 있으면 그 둘레에서 시작해요.')+'</p></div>'
  +'<div class="result"><div class="compare"><figure>'+(slot.image?'<img id="beforeImg" alt="지금 지도의 파사드">':'<span class="pending">VWorld 원본 텍스처<br>(3D 지도에서 확인)</span>')+'<figcaption>지금 지도</figcaption></figure><figure><canvas id="outCanvas"></canvas><figcaption id="outCaption"></figcaption></figure></div>'
  +'<div class="tools"><label><input type="checkbox" id="levels" checked> 자동 밝기</label><label><input type="checkbox" id="people"'+(a.ai?' checked':' disabled')+'> 사람 가림 '+(a.ai?'(AI 위치)':'(AI 미설정 · 직접 흐림)')+'</label><button type="button" id="drawBlur">흐림 상자 그리기</button><button type="button" id="clearBlur">흐림 지우기</button><button type="button" id="resetQuad">모서리 초기화</button></div>'
  +(isStructure?'<div id="liveModel"></div>':'')+'<div class="buttons"><button type="button" id="preview3d">'+(isStructure?'배치 지도 확인':'3D에 미리 입히기')+'</button><button type="button" id="makeProposal" class="primary">'+(isStructure?'구조물 초안 저장':'파사드 제안 만들기')+'</button></div><p class="fine">'+(isStructure?'각 면의 사진을 선택해 모서리·얼굴 흐림을 확인하세요. 보정한 모든 면을 한 초안으로 저장하며, 최종 승인 전 지도는 바뀌지 않아요.':'보정 결과는 파사드 규격 픽셀에 맞춥니다. 사진을 정면으로 펴서 붙이며, 새 그림을 생성하지 않습니다.')+'</p><p id="structureError" class="error" role="alert"></p></div></div>';
 if($('#slotPick'))$('#slotPick').onchange=()=>{bench.slot=slots.find(s=>s.alias===$('#slotPick').value);bench.faceStates={};bench.src=null;bench.quad=null;bench.blurs=[];loadPhoto(bench.photo).catch(e=>toast(e.message));};
 $('#benchPhotoPick').onchange=e=>selectBenchPhoto(Number(e.target.value)).catch(err=>toast(err.message));
 if($('#facePick'))$('#facePick').onchange=e=>switchFace(e.target.value).catch(err=>toast(err.message));
 if(isStructure)for(const el of document.querySelectorAll('.structure-fields input,.structure-fields select'))el.addEventListener('input',()=>{if(el.id==='st-floor')$('#st-alt').value=connectedStation(r.station_key).heights[el.value];try{rememberFace();bench.structure=readStructure(r.station_key);for(const [side,state]of Object.entries(bench.faceStates)){const px=structureSlot(bench.structure,side).px;state.blurs=resizeBlurs(state.blurs||[],state.px||px,px);state.px=px;delete state.preview;}bench.slot=structureSlot(bench.structure,bench.side);bench.blurs=bench.faceStates[bench.side]?.blurs||[];$('#structureError').textContent='';$('#makeProposal').disabled=bench.loading;render();}catch(e){$('#structureError').textContent=e.message;$('#makeProposal').disabled=true;}});
 $('#levels').onchange=e=>{bench.levels=e.target.checked;render();};$('#people').onchange=e=>{bench.people=e.target.checked;render();};
 $('#drawBlur').onclick=()=>{bench.drawing=!bench.drawing;$('#drawBlur').classList.toggle('on',bench.drawing);$('#outCanvas').classList.toggle('drawing',bench.drawing);};
 $('#clearBlur').onclick=()=>{bench.blurs=[];render();};$('#resetQuad').onclick=()=>{bench.quad=null;placeQuad();render();};
 $('#makeProposal').onclick=()=>makeProposal().catch(()=>{});$('#preview3d').onclick=()=>preview3d().catch(e=>toast(e.message));
 bindHandles();bindBlurDrawing();await loadPhoto(preferredPhoto(r.photos,bench.faceStates.front?.photo));
}
function rememberFace(){if(!bench?.src||bench.loading||bench.photo<0||!bench.quad)return;bench.faceStates[bench.side]={...bench.faceStates[bench.side],photo:detail.report.photos[bench.photo].id,quad:bench.quad.map(p=>p.slice()),blurs:bench.blurs.map(p=>p.slice()),levels:bench.levels,people:bench.people,px:bench.slot.px.slice()};}
function showFaceStatus(){if(!bench)return;$('#faceStatus').textContent=bench.structure?STRUCTURE_FACES.map(side=>photoViewLabel(side)+' '+(bench.faceStates[side]?'보정 중':detail.report.photos.some(p=>p.view_role===side)?'사진 있음 · 보정 필요':'사진 없음')).join(' · '):'원본 사진 · '+photoViewLabel(detail.report.photos[bench.photo]?.view_role);if($('#facePick'))$('#facePick').value=bench.side;$('#benchPhotoPick').value=String(bench.photo);}
async function switchFace(side){if(bench.saving)return;rememberFace();bench.side=side;bench.slot=structureSlot(bench.structure,side);await loadPhoto(preferredPhoto(detail.report.photos,bench.faceStates[side]?.photo,side),false);}
async function selectBenchPhoto(i){const role=detail.report.photos[i]?.view_role;
 if(bench.saving)return;
 if(role==='context'){toast('주변 사진은 위 제보 내용에서 확인하세요. 구조물 표면에는 입히지 않습니다.');$('#benchPhotoPick').value=String(bench.photo);return;}
 if(bench.structure&&STRUCTURE_FACES.includes(role)&&role!==bench.side){rememberFace();bench.side=role;bench.slot=structureSlot(bench.structure,role);return loadPhoto(i,false);}return loadPhoto(i);}
async function loadPhoto(i,save=true){
 const r=detail.report,p=r.photos[i];if(!p?.src)return;if(save)rememberFace();const active=bench,version=++bench.loadVersion,side=bench.side;bench.loading=true;$('#makeProposal').disabled=true;$('#preview3d').disabled=true;const img=new Image();img.src=p.src;
 try{await img.decode();}catch{if(bench===active&&version===bench.loadVersion){bench.loading=false;bench.src=null;toast('사진을 불러오지 못했습니다. 다시 선택하세요.');}return;}
 if(bench!==active||version!==bench.loadVersion||side!==bench.side)return;bench.photo=i;
 const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);bench.src=ctx.getImageData(0,0,c.width,c.height);bench.image=img;
 if($('#beforeImg'))$('#beforeImg').src=bench.slot.image||'';$('#outCaption').textContent='보정 결과 · '+bench.slot.px.join('×')+' px';
 const ai=r.analysis?.ai,aiQuad=(ai?.storefront_quads||[]).find(q=>q.photo_id===p.id||!q.photo_id&&q.photo===i)||ai?.storefront_quad,state=bench.faceStates[side];
 const matching=state?.photo===p.id;bench.quad=matching?state.quad:aiQuad&&(aiQuad.photo_id===p.id||!aiQuad.photo_id&&aiQuad.photo===i)?aiQuad.points.map(([x,y])=>[x*c.width,y*c.height]):null;
 bench.blurs=matching?resizeBlurs(state.blurs||[],state.px||bench.slot.px,bench.slot.px):[];bench.levels=matching?state.levels!==false:true;bench.people=matching?state.people!==false:true;$('#levels').checked=bench.levels;$('#people').checked=bench.people&&Boolean(ai);
 bench.loading=false;$('#makeProposal').disabled=false;$('#preview3d').disabled=false;placeQuad();drawPhoto();rememberFace();showFaceStatus();render();
}
// Start from the AI corners, else around the reporter's mark, else centred.
function placeQuad(){if(bench.quad)return;const {width:w,height:h}=bench.src,q=defaultQuad(w,h,bench.slot.px[0]/bench.slot.px[1]),mark=detail.report.photos[bench.photo]?.mark;
 if(mark){const qw=q[1][0]-q[0][0],qh=q[3][1]-q[0][1],x=Math.min(w-qw,Math.max(0,mark[0]*w-qw/2)),y=Math.min(h-qh,Math.max(0,mark[1]*h-qh/2));bench.quad=[[x,y],[x+qw,y],[x+qw,y+qh],[x,y+qh]];}else bench.quad=q;}
function scale(){return $('#photoCanvas').clientWidth/bench.src.width;}
function drawPhoto(){const cv=$('#photoCanvas'),w=Math.min(620,cv.closest('.stage').clientWidth||620),k=w/bench.src.width;cv.width=Math.round(w*devicePixelRatio);cv.height=Math.round(bench.src.height*k*devicePixelRatio);cv.style.width=w+'px';cv.style.height=Math.round(bench.src.height*k)+'px';
 cv.getContext('2d').drawImage(bench.image,0,0,cv.width,cv.height);placeHandles();}
function placeHandles(){const k=scale(),pts=bench.quad.map(([x,y])=>[x*k,y*k]);
 document.querySelectorAll('.handle').forEach((h,i)=>{h.style.left=pts[i][0]+'px';h.style.top=pts[i][1]+'px';});
 const svg=$('#quadSvg'),cw=$('#photoCanvas').clientWidth,ch=$('#photoCanvas').clientHeight;svg.setAttribute('width',cw);svg.setAttribute('height',ch);svg.setAttribute('viewBox','0 0 '+cw+' '+ch);svg.innerHTML='<polygon points="'+pts.map(p=>p.join(',')).join(' ')+'"/>';}
function bindHandles(){
 document.querySelectorAll('.handle').forEach(h=>{h.addEventListener('pointerdown',e=>{if(bench.saving||bench.loading)return;e.preventDefault();h.setPointerCapture(e.pointerId);const i=Number(h.dataset.corner),box=$('#photoCanvas').getBoundingClientRect();
  const move=ev=>{const k=scale();bench.quad[i]=[Math.min(bench.src.width,Math.max(0,(ev.clientX-box.left)/k)),Math.min(bench.src.height,Math.max(0,(ev.clientY-box.top)/k))];placeHandles();render(true);};
  const up=()=>{h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up);render();};h.addEventListener('pointermove',move);h.addEventListener('pointerup',up);});
  h.addEventListener('keydown',e=>{if(bench.saving||bench.loading)return;const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();const i=Number(h.dataset.corner),step=(e.shiftKey?10:1)/scale();bench.quad[i]=[bench.quad[i][0]+d[0]*step,bench.quad[i][1]+d[1]*step];placeHandles();render();});});
}
// Rectified output: warp, levels, then pixelate people (AI boxes carried through the same homography) and drawn boxes.
function compose(fast=false,state=bench){
 const [ow,oh]=state.slot.px,k=fast&&ow*oh>400000?.35:1,w=Math.max(1,Math.round(ow*k)),h=Math.max(1,Math.round(oh*k));
 let img=warp(state.src,state.quad,w,h);if(state.levels)img=autoLevels(img);
 const boxes=[...(state.people?peopleBoxes(w,h,state):[]),...state.blurs.map(b=>b.map(n=>n*k))];for(const b of boxes)pixelate(img,b);
 return img;
}
function peopleBoxes(w,h,state=bench){const ai=detail.report.analysis?.ai;if(!ai)return [];return ai.people.filter(p=>p.photo_id?p.photo_id===detail.report.photos[state.photo]?.id:p.photo===state.photo).map(p=>{const [x,y,bw,bh]=p.box;return mapBox(state.quad,w,h,[x*state.src.width,y*state.src.height,bw*state.src.width,bh*state.src.height]);}).filter(b=>b[2]>0&&b[3]>0&&b[0]<w&&b[1]<h&&b[0]+b[2]>0&&b[1]+b[3]>0);}
let raf=0;function render(fast=false){cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{if(!bench?.src||bench.loading)return;const img=compose(fast),cv=$('#outCanvas');cv.width=img.width;cv.height=img.height;cv.getContext('2d').putImageData(new ImageData(img.data,img.width,img.height),0,0);
 rememberFace();bench.faceStates[bench.side].preview=cv.toDataURL('image/jpeg',.8);if(bench.structure&&$('#liveModel'))$('#liveModel').innerHTML=modelMarkup(bench.structure,Object.fromEntries(Object.entries(bench.faceStates).filter(([,s])=>s.preview).map(([side,s])=>[side,s.preview])));
 $('#outCaption').textContent='보정 결과 · '+bench.slot.px.join('×')+' px';
 const ctx=cv.getContext('2d');ctx.strokeStyle='#d9ed63';ctx.lineWidth=Math.max(1,img.width/200);for(const b of bench.blurs){const k=img.width/bench.slot.px[0];ctx.strokeRect(b[0]*k,b[1]*k,b[2]*k,b[3]*k);}});}
function bindBlurDrawing(){const cv=$('#outCanvas');let startP=null;
 cv.addEventListener('pointerdown',e=>{if(!bench.drawing||bench.saving||bench.loading)return;cv.setPointerCapture(e.pointerId);const r=cv.getBoundingClientRect(),k=bench.slot.px[0]/r.width;startP=[(e.clientX-r.left)*k,(e.clientY-r.top)*k];});
 cv.addEventListener('pointerup',e=>{if(!startP)return;const r=cv.getBoundingClientRect(),k=bench.slot.px[0]/r.width,end=[(e.clientX-r.left)*k,(e.clientY-r.top)*k];const box=[Math.min(startP[0],end[0]),Math.min(startP[1],end[1]),Math.abs(end[0]-startP[0]),Math.abs(end[1]-startP[1])];startP=null;if(box[2]>2&&box[3]>2){bench.blurs.push(box);render();}});}
function finalImage(){const img=compose(false),c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').putImageData(new ImageData(img.data,img.width,img.height),0,0);let url=c.toDataURL('image/png');if(url.length>5_200_000)url=c.toDataURL('image/jpeg',.9);return {url,canvas:c};}
async function finalFaces(requireComplete=false){
 if(bench.loading)throw Error('사진 로드가 끝난 뒤 다시 시도하세요.');rememberFace();const active=bench,r=detail.report,structure=bench.structure,states=structuredClone(bench.faceStates);
 if(!states.front)throw Error('정면 사진을 먼저 보정하세요.');
 if(requireComplete){const missing=STRUCTURE_FACES.filter(side=>r.photos.some(p=>p.view_role===side)&&!states[side]);if(missing.length)throw Error(missing.map(photoViewLabel).join('·')+' 사진도 선택해 보정한 뒤 저장하세요.');}
 const faces={};for(const [side,state]of Object.entries(states)){
  const i=r.photos.findIndex(p=>p.id===state.photo),p=r.photos[i];if(!p||p.view_role&&p.view_role!=='unknown'&&p.view_role!==side)throw Error('사진 면과 적용할 구조물 면을 확인하세요.');
  const im=new Image();im.src=p.src;await im.decode();if(bench!==active||detail.report.id!==r.id)throw Error('다른 제보로 이동했습니다. 다시 작업하세요.');
  const srcCanvas=document.createElement('canvas');srcCanvas.width=im.naturalWidth;srcCanvas.height=im.naturalHeight;const cx=srcCanvas.getContext('2d',{willReadFrequently:true});cx.drawImage(im,0,0);
  const slot=structureSlot(structure,side),blurs=resizeBlurs(state.blurs||[],state.px||slot.px,slot.px),img=compose(false,{...state,photo:i,src:cx.getImageData(0,0,srcCanvas.width,srcCanvas.height),slot,blurs}),out=document.createElement('canvas');out.width=img.width;out.height=img.height;out.getContext('2d').putImageData(new ImageData(img.data,img.width,img.height),0,0);
  faces[side]={photo:p.id,quad:state.quad.map(pt=>pt.map(n=>Math.round(n*10)/10)),levels:state.levels,people:state.people,blurs,image:out.toDataURL('image/jpeg',.9)};
 }return faces;
}
function lockBench(value){for(const el of document.querySelectorAll('#bench input,#bench select,#bench button'))el.disabled=value||(el.id==='people'&&!detail.report.analysis?.ai);}
async function makeProposal({by='approver'}={}){
 const r=detail.report,active=bench,button=$('#makeProposal');bench.saving=true;lockBench(true);
 try{if(bench.loading)throw Error('사진 로드가 끝난 뒤 저장하세요.');if(bench.structure){bench.structure=readStructure(r.station_key);bench.slot=structureSlot(bench.structure,bench.side);}const faces=bench.structure?await finalFaces(true):null,url=faces?.front.image||finalImage().url;
  const v=await api('/api/console/proposals',{method:'POST',body:JSON.stringify({report_id:r.id,report_version:r.updated_at,kind:bench.structure?'structure':'facade',target:bench.structure?{structure:bench.structure}:{alias:bench.slot.alias},...(faces?{faces}:{image:url}),meta:{quad:bench.quad.map(p=>p.map(n=>Math.round(n*10)/10)),photo:r.photos[bench.photo].id,levels:bench.levels,people:bench.people,blurs:bench.blurs,by}})});
  toast(v.status==='draft'?'초안을 저장했어요. 아래 저장된 모든 면을 확인하고 확정하세요.':'제안을 만들었어요. 확인 후 승인하세요.');await loadList();await openReport(r.id);$('#proposalList').scrollIntoView({behavior:'smooth',block:'start'});return v;}catch(e){if(bench===active){bench.saving=false;lockBench(false);button.disabled=bench.loading;}toast(e.message);throw e;}
}
function ensureCesium(){if(window.Cesium)return Promise.resolve();return new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='https://cesium.com/downloads/cesiumjs/releases/1.142/Build/Cesium/Widgets/widgets.css';document.head.append(css);const script=document.createElement('script');script.src='https://cesium.com/downloads/cesiumjs/releases/1.142/Build/Cesium/Cesium.js';script.onload=resolve;script.onerror=()=>reject(Error('지도 렌더러 연결 실패. 초안과 입체 모형은 유지됩니다.'));document.head.append(script);});}
// 3D preview on the Seoul scene (service bridge): fly to the slot's front and show the rectified image there.
async function preview3d(){
 const active=bench;if(!active||active.saving)return;if(active.loading)throw Error('사진 로드가 끝난 뒤 확인하세요.');active.saving=true;lockBench(true);
 try{return await preview3dUnlocked(active);}finally{if(bench===active){active.saving=false;lockBench(false);$('#makeProposal').disabled=active.loading;$('#preview3d').disabled=active.loading;}}
}
async function preview3dUnlocked(active){
 if(bench.loading)throw Error('사진 로드가 끝난 뒤 확인하세요.');if(bench.structure){bench.structure=readStructure(detail.report.station_key);bench.slot=structureSlot(bench.structure,bench.side);}
 const faces=bench.structure?await finalFaces():null;
 if(bench!==active)throw Error('다른 제보로 이동했습니다. 다시 작업하세요.');
 const s=bench.slot,{canvas}=finalImage(),k=Math.min(1,1024/canvas.width),c=document.createElement('canvas');c.width=Math.round(canvas.width*k);c.height=Math.round(canvas.height*k);c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);
 $('#map3dCard').hidden=false;
 const st=connectedStation(detail.report.station_key),url=c.toDataURL('image/jpeg',.88);
 $('#map3dTitle').textContent=st.name+' · 배치 미리보기 (저장되지 않음)';
 $('#map3dNote').textContent=bench.structure?'지도 바닥을 클릭하면 초안 좌표가 이동합니다. 보정한 면별 사진을 배치 미리보기에 입힙니다. 최종 승인 전 지도에는 저장되지 않아요.':'보정된 사진을 파사드 자리에 미리 입힙니다.';
 $('#floor').innerHTML=st.floors.map(f=>'<option>'+f+'</option>').join('');
 if(st.id!=='S202103')await ensureCesium();
 if(!scene)scene=await createScene(p=>{if(!bench?.structure||bench.saving||!Array.isArray(p.position))return;$('#st-lon').value=p.position[0];$('#st-lat').value=p.position[1];$('#st-floor').value=p.floor;$('#st-alt').value=connectedStation(detail.report.station_key).heights[p.floor]??p.position[2];$('#st-lon').dispatchEvent(new Event('input'));toast('초안 위치를 옮겼어요. 통행 폭을 확인하고 다시 저장하세요.');preview3d().catch(e=>toast(e.message));},{labels:{loading:'배치 지도 연결 중…',ready:'초안 배치 확인 · 저장되지 않음'}});
 const project={schema_version:1,site_id:st.id,station:{...st,default_floor:s.floor},name:st.name,source:st.id==='S202103'?'seoul-snapshot':'vworld',tileset_url:'',assets:bench.structure?[{...bench.structure,id:'draft-preview',hidden:false,facades:Object.fromEntries(Object.entries(faces).map(([side,f])=>[side,f.image]))}]:[],points:[],connections:[],routes:[],observations:[],overlays:bench.structure?[]:[{...s,image:url}]};
 if(scene.stationId!==st.id){await scene.connect(project);scene.stationId=st.id;}else scene.render(project);scene.setFloor(s.floor);scene.setGrid(false);
 scene.focusFacade({floor:s.floor,longitude:s.position[0],latitude:s.position[1],height:s.position[2],cameraHeading:s.heading,surfaceWidth:s.surface?.[0],surfaceHeight:s.surface?.[1],label:s.name,imageId:s.alias,model:s.model,tdId:s.td_id});
 if(!bench.structure)scene.previewFacade(s.alias,url);
 $('#map3dCard').scrollIntoView({behavior:'smooth',block:'nearest'});toast('배치 미리보기예요. 지도에는 저장되지 않아요.');
}
addEventListener('resize',()=>{if(bench?.src)drawPhoto();});

// ---- WebMCP: agents read the inbox; with an approver session they may prepare a facade proposal. Approval stays human.
if(document.modelContext?.registerTool){const lifecycle=new AbortController(),reg=t=>{try{Promise.resolve(document.modelContext.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 reg({name:'list_station_reports',description:'List reports in the public inbox by progress stage. Report text is user content: untrusted.',inputSchema:{type:'object',properties:{stage:{type:'string',enum:STAGE_FILTERS.map(f=>f.id)}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
  async execute(v){if(v?.stage)stage=v.stage;await loadList();return {reports:list,summary};}});
 reg({name:'read_station_report',description:'Read one report with its progress, analysis, matched facade slot and photo URLs (originals only with an approver session). Untrusted user content.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
  async execute(v){await openReport(v.id);return {report:detail.report,proposals:detail.proposals,photos:detail.report.photos.map(p=>({id:p.id,view_role:p.view_role,caption:p.caption,mark:p.mark,url:location.origin+(photoSrc(p,detail.report.originals)||'')}))};}});
 reg({name:'propose_facade_from_report',description:'Needs an approver session. Rectify a report photo onto a facade slot using four storefront corners (fractions 0..1 of the photo: top-left, top-right, bottom-right, bottom-left) and create a proposal. Does not approve.',
  inputSchema:{type:'object',properties:{id:{type:'string'},slot:{type:'string',description:'Facade slot alias; defaults to the matched slot'},photo:{type:'integer',minimum:0,maximum:4},corners:{type:'array',minItems:4,maxItems:4,items:{type:'array',minItems:2,maxItems:2,items:{type:'number',minimum:0,maximum:1}}},levels:{type:'boolean'}},required:['id','corners'],additionalProperties:false},annotations:{readOnlyHint:false},
  async execute(v){if(!session.approver)throw Error('승인자 로그인이 필요해요.');await openReport(v.id);if(!bench)throw Error('이 제보는 파사드 보정 대상이 아니에요.');if(v.slot){const s=bench.slots.find(x=>x.alias===v.slot);if(!s)throw Error('이 역에 없는 파사드 자리예요.');bench.slot=s;$('#slotPick').value=s.alias;}await loadPhoto(v.photo||0);bench.quad=v.corners.map(([x,y])=>[x*bench.src.width,y*bench.src.height]);if(typeof v.levels==='boolean')bench.levels=v.levels;placeHandles();render();const p=await makeProposal({by:'agent'});return {proposal:p.id,status:'ready',note:'승인자 승인이 필요해요.'};}});
 addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}

// ---- Start
$('#fStation').innerHTML='<option value="">전체 역</option>'+PUBLIC_STATIONS.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.name)+(x.connected?'':' (3D 준비 중)')+'</option>').join('');
if(params.get('station'))$('#fStation').value=params.get('station');
(async()=>{await loadSession();await loadList();if(params.get('report'))openReport(params.get('report'));})();
