import {connectedStation,structurePixels,validateStructure} from '../reports.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initialStructure(report,saved){
 const st=connectedStation(report.station_key);
 return saved||{name:report.photos[0]?.caption||report.analysis?.ai?.signage_text||'',floor:report.floor,position:[...report.position.slice(0,2),st.heights[report.floor]??report.position[2]],size:[1,.6,2.2],heading:report.view?.heading||0,color:'#a9b6b0',dimension_basis:'estimated'};
}
export function structureSlot(s){return {alias:'new-structure',name:s.name,floor:s.floor,position:[s.position[0],s.position[1],s.position[2]+s.size[2]/2],surface:[s.size[0],s.size[2]],heading:(s.heading+180)%360,px:structurePixels(s.size),image:null};}
export function resizeBlurs(boxes,before,after){const sx=after[0]/before[0],sy=after[1]/before[1];return boxes.map(([x,y,w,h])=>[x*sx,y*sy,w*sx,h*sy]);}
export function structureFields(s,key){const st=connectedStation(key),field=(id,label,value,step='.1')=>'<label>'+label+'<input id="st-'+id+'" type="number" step="'+step+'" value="'+value+'"></label>';
 return '<div class="structure-info"><h3>새 구조물 초안</h3><p class="fine">사진을 직육면체의 정면에 입힙니다. 사진만으로 실제 크기·뒷면을 복원하지 않아요. 기본 크기는 예시이므로 현장에 맞게 확인하세요.</p><div class="structure-fields">'
 +'<label>시설 이름<input id="st-name" maxlength="100" placeholder="예: AI역무원 키오스크" value="'+esc(s.name)+'"></label><label>층<select id="st-floor">'+st.floors.map(f=>'<option'+(f===s.floor?' selected':'')+'>'+f+'</option>').join('')+'</select></label>'
 +field('width','폭 (m)',s.size[0])+field('depth','깊이 (m)',s.size[1])+field('height','높이 (m)',s.size[2])+field('heading','회전 (°)',s.heading,'1')
 +field('lon','경도',s.position[0],'.000001')+field('lat','위도',s.position[1],'.000001')+field('alt','바닥 높이 (m)',s.position[2])
 +'<label>크기 근거<select id="st-basis"><option value="estimated"'+(s.dimension_basis==='estimated'?' selected':'')+'>사진 참고 추정 · 현장 확인 필요</option><option value="measured"'+(s.dimension_basis==='measured'?' selected':'')+'>실측 / 도면 확인</option></select></label><label>옆·뒷면 색<input id="st-color" type="color" value="'+s.color+'"></label></div><p class="fine">정면은 회전 0°에서 남쪽을 봅니다. 아래 ‘배치 지도 확인’을 누른 뒤 지도 바닥을 클릭하면 좌표를 옮길 수 있어요. 지도 위치와 별도로 통행 폭·충돌 여부를 확인하세요.</p></div>';
}
export function readStructure(key){const get=id=>document.getElementById('st-'+id).value,n=id=>Number(get(id));return validateStructure({name:get('name'),floor:get('floor'),position:[n('lon'),n('lat'),n('alt')],size:[n('width'),n('depth'),n('height')],heading:n('heading'),color:get('color'),dimension_basis:get('basis')},key);}
// Perspective box preview uses the exact proposed proportions. No map, light reconstruction or AI geometry claim.
export function modelMarkup(s,image){const k=170/Math.max(...s.size),[w,d,h]=s.size.map(n=>n*k);return '<div class="model-preview" aria-label="구조물 입체 모형"><div class="model-box" style="--w:'+w+'px;--d:'+d+'px;--h:'+h+'px;--color:'+s.color+'"><div class="model-front"><img src="'+esc(image)+'" alt="보정한 정면"></div><div class="model-back"></div><div class="model-left"></div><div class="model-right"></div><div class="model-top"></div></div></div><p class="fine model-caption">직육면체 모형 · '+s.size.join(' × ')+'m (폭·깊이·높이)<br>정면 외 면은 단색 · 복잡한 형태 자동 복원 아님</p>';}
