import {metres,PHOTO_VIEWS} from '../reports.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={queued:'작업 대기',running:'AI 분석·보정 중',needs_info:'추가정보 필요',needs_config:'AI 연결 설정 필요',draft:'초안 생성 완료',failed:'작업 실패 · 재시도 가능',cancelled:'작업 취소'};
let poll=null;
export function stopWorkPoll(){clearTimeout(poll);poll=null;}
export function workCard(detail){
 const r=detail.report,w=detail.work;if(!w||!['review','held','accepted'].includes(r.status))return '';
 const j=w.jobs[0],i=j?.input||{},s=i.structure||{},kind=i.kind||({new:'structure',removed:'removal'}[r.type]||'facade'),busy=['queued','running'].includes(j?.status);
 return '<section class="card ai-work"><h3>AI 자동 작업 <small>작업종류 승인 → 초안 → 최종 승인</small></h3><p>사진의 모서리를 찾고 면별 밝기·개인정보 가림을 보정합니다. 새 구조물은 입력한 크기로 만들고, 선택한 독립 구조물만 숨깁니다. 최종 승인 전 공개 지도는 바뀌지 않습니다.</p>'
 +(!w.configured?'<p class="ai-warning">AI API 연결이 아직 없습니다. 요청·추가정보는 저장되지만 실제 자동 분석은 운영자의 연결 설정 후 실행됩니다. 수동 작업대도 계속 사용할 수 있습니다.</p>':'')
 +(j?'<div class="job-status" role="status"><b>'+esc(labels[j.status]||j.status)+'</b>'+(j.error?'<p>'+esc(j.error)+'</p>':'')+(j.questions?.length?'<ol>'+j.questions.map(q=>'<li>'+esc(q)+'</li>').join('')+'</ol>':'')+(j.plan?.summary?'<p>'+esc(j.plan.summary)+'</p>':'')+(busy?'<button type="button" id="aiCancel">작업 취소</button>':'')+'</div>':'')
 +'<form id="aiWorkForm"><label>승인할 작업 종류<select name="kind">'+[['facade','파사드만 교체'],['structure','새 구조물 생성 · 필요시 기존 장애물 숨김'],['removal','기존 장애물 숨김']].map(([id,label])=>'<option value="'+id+'"'+(kind===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'
 +'<label data-ai-kind="facade">파사드 자리<select name="alias"><option value="">자리 선택</option>'+(i.alias||r.analysis?.slot?.alias?'<option selected value="'+esc(i.alias||r.analysis.slot.alias)+'">'+esc(r.analysis?.slot?.name||i.alias)+'</option>':'')+'</select></label>'
 +'<div class="ai-geometry" data-ai-kind="structure"><label>구조물 이름<input name="name" maxlength="100" value="'+esc(s.name||'')+'" placeholder="예: AI 역무원 키오스크"></label><div class="ai-measures">'+[['width','폭',s.size?.[0]],['depth','깊이',s.size?.[1]],['height','높이',s.size?.[2]],['heading','정면 방향(°)',s.heading]].map(([n,label,v])=>'<label>'+label+'<input type="number" name="'+n+'" step="any" value="'+(v??'')+'"'+(n==='heading'?'':' min="0.1" max="30"')+' placeholder="'+(n==='heading'?'0~360':'m')+'"></label>').join('')+'</div><label>크기 근거<select name="basis"><option value="estimated"'+(s.dimension_basis!=='measured'?' selected':'')+'>추정 · 현장 확인 필요</option><option value="measured"'+(s.dimension_basis==='measured'?' selected':'')+'>실측 / 도면 확인</option></select></label><p class="fine">층·배치는 제보 핀을 사용합니다. 사진에서 실제 크기를 임의로 확정하지 않습니다. 촬영하지 않은 면은 기본색으로 남습니다.</p></div>'
 +'<fieldset data-ai-kind="hide"><legend>AI가 숨김을 검토해도 되는 독립 구조물</legend>'+(w.candidates.length?w.candidates.map(a=>'<label><input type="checkbox" name="target" value="'+esc(a.id)+'"'+(i.permitted_ids?.includes(a.id)?' checked':'')+'> '+esc(a.name)+' · '+esc(a.floor)+' · '+a.distance+'m <small>'+esc(a.id)+'</small></label>').join(''):'<p class="fine">12m 안에 독립 등록된 구조물이 없습니다. 원본 지도 모델은 ID가 공유될 수 있어 자동으로 추측·제거하지 않습니다. 정확한 대상 확인을 요청합니다.</p>')+'</fieldset>'
 +'<label>추가정보 / AI 질문에 대한 답변<textarea name="notes" maxlength="1000" rows="3" placeholder="위치·크기 근거, 사진별 설명, 숨길 대상 등을 적으세요.">'+esc(i.notes||'')+'</textarea></label><p class="fine">원본 사진은 해당 제보자와 승인자만 볼 수 있으며 AI API로 분석 전송됩니다.</p>'
 +'<label><input type="checkbox" name="consent" required> 작업 종류와 선택 대상에 동의하며 사진을 AI로 분석하는 초안 작업을 승인합니다.</label><button class="primary" type="submit"'+(busy?' disabled':'')+'>'+(j?'추가정보 반영 · 새 AI 초안 만들기':'작업종류 승인 · AI 초안 만들기')+'</button><p class="error" id="aiWorkError" role="alert"></p></form>'
 +(r.photos.length<5?'<div class="ai-supplement"><h4>AI 요청 사진 보완</h4><label>촬영한 면<select id="aiPhotoRole">'+PHOTO_VIEWS.map(v=>'<option value="'+v.id+'">'+esc(v.label)+'</option>').join('')+'</select></label><label>보완 사진<input id="aiPhotoFile" type="file" accept="image/jpeg,image/png"></label><p class="fine">사진 추가 시 이전 초안의 확인·승인은 무효화됩니다. 새 AI 초안을 생성해 주세요. 남은 사진 '+(5-r.photos.length)+'장.</p></div>':'<p class="fine">이 제보에는 최대 5장이 등록돼 있습니다. 추가 사진은 새 제보로 보내고 기존 제보 번호를 적어 주세요.</p>')+'</section>';
}
export function bindWork(detail,{api,refresh,toast,isCurrent}){
 stopWorkPoll();const form=document.querySelector('#aiWorkForm');if(!form)return;
 const update=()=>{const kind=form.elements.kind.value;for(const e of form.querySelectorAll('[data-ai-kind]'))e.hidden=e.dataset.aiKind==='hide'?kind==='facade':e.dataset.aiKind!==kind;};form.elements.kind.onchange=update;update();
 api('/api/console/station?key='+encodeURIComponent(detail.report.station_key)).then(v=>{if(!isCurrent(detail.report.id))return;const r=detail.report,select=form.elements.alias,current=select.value;select.innerHTML='<option value="">자리 선택</option>'+v.slots.filter(s=>s.floor===r.floor&&r.position&&metres(s.position,r.position)<=12).map(s=>'<option value="'+esc(s.alias)+'"'+(s.alias===current?' selected':'')+'>'+esc(s.name)+' · '+esc(s.alias)+'</option>').join('');}).catch(()=>{});
 form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('[type=submit]'),err=document.querySelector('#aiWorkError');btn.disabled=true;err.textContent='';
  try{const f=form.elements,kind=f.kind.value,v={report_id:detail.report.id,report_version:detail.report.updated_at,request_id:crypto.randomUUID(),kind,operation_approved:f.consent.checked,alias:f.alias.value||null,notes:f.notes.value,permitted_ids:[...form.querySelectorAll('[name=target]:checked')].map(x=>x.value)};
   if(kind==='structure'&&[f.name.value,f.width.value,f.depth.value,f.height.value,f.heading.value].some(x=>x!=='')){
    if([f.name.value,f.width.value,f.depth.value,f.height.value,f.heading.value].some(x=>x===''))throw Error('이름·폭·깊이·높이·정면 방향을 모두 입력해 주세요.');
    v.structure={name:f.name.value,floor:detail.report.floor,position:detail.report.position,size:[+f.width.value,+f.depth.value,+f.height.value],heading:+f.heading.value,color:'#c8cbcb',dimension_basis:f.basis.value};}
   await api('/api/console/ai-work',{method:'POST',body:JSON.stringify(v)});toast('작업 요청을 저장했습니다. 최종 승인 전 지도는 바뀌지 않습니다.');await refresh();
  }catch(e){err.textContent=e.message;btn.disabled=false;}
 };
 const photo=document.querySelector('#aiPhotoFile');if(photo)photo.onchange=async()=>{const file=photo.files[0];if(!file)return;photo.disabled=true;try{
  const image=await createImageBitmap(file),k=Math.min(1,2048/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*k);canvas.height=Math.round(image.height*k);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));if(!blob||blob.size>4_000_000)throw Error('사진을 4MB 이하로 줄여 주세요.');
  await api('/api/console/reports/'+detail.report.id+'/photos',{method:'POST',body:blob,headers:{'Content-Type':'image/jpeg','X-Report-Version':detail.report.updated_at,'X-Photo-View':document.querySelector('#aiPhotoRole').value}});toast('보완 사진을 등록했습니다. 추가정보와 함께 새 AI 초안을 요청하세요.');await refresh();
 }catch(e){toast(e.message);photo.disabled=false;}};
 const j=detail.work.jobs[0];if(!j)return;
 const cancel=document.querySelector('#aiCancel');if(cancel)cancel.onclick=async()=>{cancel.disabled=true;try{await api('/api/console/ai-work/'+j.id+'/cancel',{method:'POST',body:'{}'});await refresh();}catch(e){toast(e.message);cancel.disabled=false;}};
 if(['queued','running'].includes(j.status)){
  const check=async()=>{if(!isCurrent(detail.report.id))return;try{const v=await api('/api/console/ai-work/'+j.id);if(!['queued','running'].includes(v.job.status)){toast(labels[v.job.status]||'자동 작업 상태 변경');await refresh();return;}}catch(e){toast(e.message);}poll=setTimeout(check,4000);};poll=setTimeout(check,4000);
 }
}
