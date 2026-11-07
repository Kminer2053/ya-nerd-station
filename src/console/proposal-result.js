import {STATUS,photoViewLabel} from '../reports.js';
import {facadeSlotReview} from './facade-slot.js';
import {artifactReviewMarkup,modelMarkup} from './structure.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const resultKinds={structure:'새 구조물',removal:'장애물 숨김',facade:'파사드 교체'};
const effectKinds={hide:'숨김',create:'생성',replace:'파사드 교체'};
const statusTone={draft:'mute',ready:'info',queued:'lime',applied:'ok'};

function photoLink(src,label,origin){
 if(!src)return '';
 let href;
 try{
  const url=new URL(src,origin);
  if(url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&url.origin===origin))return '';
  href=url.href;
 }catch{return '';}
 return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc(label)+' 확대">'
  +'<img src="'+esc(href)+'" alt="'+esc(label)+'"></a>';
}

function comparison(p,origin){
 const applied=p.status==='applied',removal=p.kind==='removal';
 const beforeText=p.kind==='structure'?'새 구조물 · 기존 지도에 없음':removal?'기존 지도에서 표시':'기본지도 텍스처';
 const afterText=removal?(applied?'지도에서 숨김 · 원본 보존':'숨김 예정 · 원본 보존'):'이미지 확인 대기';
 const pixels=p.target.px?.join('×');
 const figure=(image,text,caption)=>'<figure><div class="proposal-photo">'+(photoLink(image,caption,origin)||'<p>'+text+'</p>')+'</div><figcaption>'+caption+'</figcaption></figure>';
 return '<div class="proposal-comparison">'+figure(p.target.before,beforeText,'변경 전')
  +figure(p.image,afterText,(applied?'반영 결과':'수정안')+(pixels?' · '+esc(pixels)+'px':''))+'</div>';
}

function effectsReview(p){
 if(!p.meta?.ai_job)return '';
 const items=(p.target.effects||[]).map(e=>{
  let before;
  if(e.action==='hide'){try{before=JSON.parse(e.before);}catch{}}
  const geometry=before?.size?'<p>'+esc(before.floor)+' · '+esc(before.position?.join(', '))+' · '+esc(before.size.join(' × '))+'m</p>'
   +modelMarkup(before,before.facades||{}):'';
  return '<li><strong>'+esc(effectKinds[e.action]||'변경')+'</strong> · '+esc(e.label)+geometry+'</li>';
 });
 const sourceNote=p.kind==='facade'?'기본지도 모델은 그대로 두고 사진을 표면에 입힙니다.':p.kind==='removal'?'독립 구조물의 표시만 바꾸며 원본과 복원 정보를 보존합니다.':'';
 return '<section class="proposal-evidence-block"><h4>변경 대상</h4>'
  +(p.meta.summary?'<p>'+esc(p.meta.summary)+'</p>':'')+(items.length?'<ul>'+items.join('')+'</ul>':'')+(sourceNote?'<p class="fine">'+sourceNote+'</p>':'')+'</section>';
}

function structureReview(p,origin){
 const s=p.target.structure;
 if(p.kind!=='structure'||!s||!p.image)return '';
 const faces=Object.entries(p.images||{front:p.image}).map(([side,url])=>{
  const label=photoViewLabel(side),link=photoLink(url,'보정한 '+label,origin);
  return link?'<figure>'+link+'<figcaption>'+esc(label)+'</figcaption></figure>':'';
 }).join('');
 return '<section class="proposal-evidence-block"><h4>구조물 모형 · 보정한 면</h4>'+modelMarkup(s,p.images||p.image)
  +(faces?'<div class="face-results">'+faces+'</div>':'')+'<p class="fine">'+esc(s.floor)+' · '+esc(s.position.join(', '))+' · '+esc(s.heading)+'°<br>크기 근거 · '
  +(s.dimension_basis==='measured'?'실측 / 도면 확인':'사진 참고 추정 · 현장 확인 필요')+'</p></section>';
}

export function proposalResultsMarkup(proposals,{report,approver,origin}){
 const p=proposals.find(x=>['draft','ready','applied','queued'].includes(x.status));
 const previous=proposals.filter(x=>x!==p);
 const history=previous.length?'<details class="previous-drafts"><summary>이전 초안 '+previous.length+'개 · 승인 불가</summary><ul>'
  +previous.map(x=>'<li>'+esc(x.target.name)+' · '+esc(STATUS[x.status]||x.status)+'</li>').join('')+'</ul></details>':'';
 if(!p)return '<p class="draft-empty">수정안이 준비되면 여기에 표시됩니다.</p>'+history;
 const id=esc(p.id),draft=['draft','ready'].includes(p.status),reviewable=approver&&draft&&report.status==='accepted'&&p.meta?.ai_job;
 const previewable=approver&&(p.kind==='facade'?p.image&&p.target.alias:p.kind==='structure'?p.image&&p.target.structure:p.target.effects?.some(e=>e.action==='hide'));
 const proof=p.meta?.structure_provenance;
 const evidence=effectsReview(p)+structureReview(p,origin)+artifactReviewMarkup(p.meta,report.photos)+facadeSlotReview(p)
  +(proof?'<section class="estimate-note"><h4>추정 · 현장 확인 필요</h4><p>근거 · '+esc(proof.evidence)+'</p><p>한계 · '+esc(proof.uncertainty)+'</p></section>':'');
 const checks=reviewable?'<div class="draft-checks" data-checks="'+id+'"><label><input type="checkbox" name="final"> 저장된 수정안의 위치·크기·방향·통행 폭, 모든 보정면의 개인정보, 생성·숨김·교체 대상을 확인했습니다.</label><button type="button" class="primary" data-final="'+id+'">최종 승인 · 지도에 반영</button></div>'
  :approver&&draft?'<p class="fine">이전 수동 초안입니다. Codex에 작업을 맡기면 새 수정안으로 대체됩니다.</p>':'';
 const undo=approver&&p.meta?.ai_job&&p.status==='applied'&&['structure','removal'].includes(p.kind)?'<button type="button" data-undo="'+id+'">이 자동 작업만 되돌리기</button>':'';
 return '<article class="proposal" data-proposal="'+id+'"><header class="proposal-header"><div class="proposal-heading"><h4>'+esc(p.target.name||resultKinds[p.kind])+'</h4><span class="pill '+statusTone[p.status]+'">'+esc(STATUS[p.status]||p.status)+'</span>'
  +'<p class="fine">'+esc(resultKinds[p.kind])+(p.reviewer?' · '+esc(p.reviewer):'')+'</p></div>'
  +(previewable?'<button type="button" data-saved-preview="'+id+'">지도에서 배치 확인</button>':'')+'</header>'
  +(p.reason?'<p class="fine">'+esc(p.reason)+'</p>':'')+comparison(p,origin)
  +(evidence?'<details class="proposal-evidence"><summary>변경 대상과 검토 근거</summary><div class="proposal-evidence-content">'+evidence+'</div></details>':'')
  +checks+(undo?'<div class="buttons">'+undo+'</div>':'')+'</article>'+history;
}
