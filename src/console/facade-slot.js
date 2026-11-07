// The operator confirms one photographic plane; no model or photo invents exact dimensions.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function planeFromFields(floor,{name,longitude,latitude,bottom,height,width,heading,basis,pixelWidth='',pixelHeight=''}){
 const h=Number(height),g={name:String(name||'').trim(),floor,position:[Number(longitude),Number(latitude),Number(bottom)+h/2],heading:Number(heading),surface:[Number(width),h],dimension_basis:basis};
 if(pixelWidth!==''||pixelHeight!=='')g.px=[Number(pixelWidth),Number(pixelHeight)];return g;
}
export function facadeSlotCard(detail){
 const r=detail.report;if(!detail.approver||r.type!=='facade'||!r.position||!r.floor||!['review','accepted','held'].includes(r.status))return '';
 const existing=detail.facade_slots||[],placementNote=r.station_key==='S202103'?'서울역 기준 파사드는 기존 위치와 크기에 사진을 교체할 수 있습니다.':'등록된 파사드가 있는 벽은 작업 채팅에서 이동·확장 범위를 요청할 수 있습니다. 초안에서 사진과 배치를 함께 검토하세요.';
 return '<section class="card facade-slot-card"><h3>사진을 입힐 면의 위치·규격</h3><p>'+placementNote+'</p>'+(existing.length?existing.map(s=>'<p><b>'+esc(s.name)+'</b> · 비공개 면 후보 · '+esc(s.floor)+' · '+esc(s.surface.join(' × '))+'m · '+(s.dimension_basis==='measured'?'실측 / 도면 확인':'추정 · 현장 확인 필요')+'</p>').join(''):'<p>기준이 될 면이 없으면 아래에서 위치·방향과 폭·높이를 확인할 수 있습니다.</p>')
  +'<details><summary>'+(existing.length?'다른 규격으로 면 다시 확인':'새 파사드 면 확인·등록')+'</summary><form id="facadeSlotForm"><p class="fine">이 등록은 비공개 후보입니다. 연결 작업자에게 사진 보정을 맡긴 뒤 수정안의 최종 승인을 마쳐야 면과 이미지가 함께 공개됩니다. 다시 등록하면 이전 작업·수정안은 승인할 수 없습니다.</p><div class="structure-fields">'
  +'<label>시설·면 이름<input name="name" maxlength="100" required placeholder="예: 대합실 편의점 정면"></label><label>치수 확인 방법<select name="basis"><option value="estimated">추정 · 현장 확인 필요</option><option value="measured">실측 / 도면 확인</option></select></label>'
  +'<label>실제 폭(m)<input name="width" type="number" min="0.1" max="30" step="any" required></label><label>실제 높이(m)<input name="height" type="number" min="0.1" max="30" step="any" required></label><label>정면 방향(°)<input name="heading" type="number" min="0" max="359.999" step="any" required value="'+esc(Math.max(0,Math.min(359.999,Number(r.view?.heading)||0)))+'"></label>'
  +'<label>경도<input name="longitude" type="number" step="any" required value="'+esc(r.position[0])+'"></label><label>위도<input name="latitude" type="number" step="any" required value="'+esc(r.position[1])+'"></label><label>면 아래끝 고도(m)<input name="bottom" type="number" step="any" required value="'+esc(r.position[2])+'"></label></div>'
  +'<p class="fine">'+esc(r.floor)+' · 위치는 제보 핀에서 12m 안이어야 합니다. 아래끝 고도의 기본값은 제보한 바닥 높이이며, 면이 바닥보다 높으면 수정하세요. 저장할 면 중심고도 = 아래끝 고도 + 면 높이의 절반입니다.</p><p data-plane-height role="status">실제 높이를 입력하면 면 중심고도를 표시합니다.</p>'
  +'<label>치수 확인 근거<textarea name="evidence" required maxlength="1000" rows="2" placeholder="실측 위치·도면 출처 또는 사진 속 크기 비교 기준"></textarea></label><label>오차·불확실성<textarea name="uncertainty" required maxlength="1000" rows="2" placeholder="예: 폭은 출입문을 기준으로 추정해 오차가 있을 수 있음"></textarea></label>'
  +'<fieldset><legend>확인에 사용한 현장 사진</legend>'+r.photos.map((p,i)=>'<label><input type="checkbox" name="source" value="'+esc(p.id)+'" checked> 사진 '+(i+1)+'</label>').join('')+'</fieldset>'
  +'<details><summary>보정 이미지 픽셀 규격 지정(선택)</summary><p class="fine">비워 두면 실제 면의 비율로 계산합니다. 직접 지정할 때는 32~4,096px, 전체 4MP 이내이며 실제 폭·높이 비율과 맞아야 합니다.</p><label>가로(px)<input name="pixelWidth" type="number" min="32" max="4096"></label><label>세로(px)<input name="pixelHeight" type="number" min="32" max="4096"></label></details>'
  +'<label><input name="checked" type="checkbox" required> 사진에 나온 시설 면의 층·위치·방향·폭·높이와 실측/추정 여부를 확인했습니다.</label><p class="fine">치수 근거는 작업 담당자만 확인합니다. 내부 운영정보나 개인정보를 넣지 마세요.</p><button type="submit">면 후보 저장 · 공개 전 확인</button><p class="error" data-slot-error role="alert"></p></form></details></section>';
}
export function bindFacadeSlot(detail,{api,toast,onSaved}){
 const form=document.querySelector('#facadeSlotForm');if(!form)return;
 const fields=()=>Object.fromEntries(['name','longitude','latitude','bottom','height','width','heading','basis','pixelWidth','pixelHeight'].map(k=>[k,form.elements.namedItem(k).value]));
 form.addEventListener('input',()=>{const h=Number(form.elements.height.value),bottom=Number(form.elements.bottom.value);form.querySelector('[data-plane-height]').textContent=form.elements.height.value&&Number.isFinite(h+bottom)?'저장할 면 중심고도: '+(bottom+h/2).toFixed(3)+'m · 아래끝 '+bottom+'m + 높이 '+h+'m ÷ 2':'실제 높이를 입력하면 면 중심고도를 표시합니다.';});
 const request_id=crypto.randomUUID();
 form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]'),error=form.querySelector('[data-slot-error]');button.disabled=true;error.textContent='';
  try{const result=await api('/api/console/reports/'+detail.report.id+'/facade-slot',{method:'POST',body:JSON.stringify({request_id,report_version:detail.report.updated_at,slot:planeFromFields(detail.report.floor,fields()),source_photo_ids:[...form.querySelectorAll('[name=source]:checked')].map(el=>el.value),evidence:form.elements.evidence.value,uncertainty:form.elements.uncertainty.value,geometry_checked:form.elements.checked.checked})});toast(result.note||'면 후보를 저장했습니다.');await onSaved(detail.report.id);}catch(e){error.textContent=e.message;button.disabled=false;}
 });
}
export function facadeSlotReview(p){
 const s=p.target?.slot,proof=p.meta?.facade_provenance,change=p.target?.facade_reframe;if(!s)return '';
 const movement=change?[change.right_m?'정면에서 '+(change.right_m>0?'오른쪽 ':'왼쪽 ')+Math.abs(change.right_m)+'m':'',change.up_m?(change.up_m>0?'위로 ':'아래로 ')+Math.abs(change.up_m)+'m':''].filter(Boolean).join(' · '):'';
 const comparison=change?'<p>기존 '+esc(change.anchor.surface.join(' × '))+'m → 변경 '+esc(s.surface.join(' × '))+'m · '+esc(movement||'중심 유지')+'<br>새 중심 '+esc(s.position.map(n=>n.toFixed(6)).join(', '))+' · 방향 유지</p><p>지도에서 이웃 면과 맞닿는 경계를 확인하세요. 새 사진 범위 밖에는 원래 3D 지도 표면이 보입니다.</p>':'';
 return '<section class="estimate-note"><b>'+esc(s.name)+' · '+(s.dimension_basis==='measured'?'실측 / 도면 확인':s.dimension_basis==='estimated'?'추정 · 현장 확인 필요':'기존 승인 규격 · 치수 확인 방법 미기록')+(change?' · 같은 벽면 배치 변경':p.target.registration?' · 이미지와 함께 새 면 등록':'')+'</b><p>'+esc(s.floor)+' · 폭 '+s.surface[0]+'m × 높이 '+s.surface[1]+'m · 방향 '+s.heading+'°<br>면 중심고도 '+s.position[2]+'m · '+s.px.join(' × ')+'px</p>'+comparison+(proof?'<p>근거 · '+esc(proof.evidence)+'</p><p>오차·한계 · '+esc(proof.uncertainty)+'</p>':'')+'</section>';
}
