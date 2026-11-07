import {PUBLIC_STATIONS} from '../reports.js';

const labels={
 pending:'배정 대기',enqueuing:'요청 준비 중',queued:'배정됨',
 waiting:'Codex 대기',offline:'작업자 오프라인',received:'Codex 접수',working:'작업 중',
 draft_submitted:'수정안 검토',needs_info:'보완 답변 필요',interrupted:'작업 중단',
 failed:'실패',skipped:'건너뜀',cancelled:'취소',applied:'반영 완료',
};
const stationName=key=>PUBLIC_STATIONS.find(station=>station.key===key)?.name||'전체 역';
const batchStation=key=>!key||/^S\d{6}$/.test(key);
const date=iso=>new Date(iso).toLocaleString('ko-KR');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function createBatchControls({api,toast,getStation,getSelected,getSelectable,onSelectAll,onClear,onChange}){
 let panel,owner=null,timer=null,loadVersion=0,submitting=false,initialized=false,request=null,lastRuns=null;
 const find=selector=>panel.querySelector(selector);

 function syncSelection(){
  const selected=getSelected().length,selectable=getSelectable().length;
  const whole=find('[name=scope]').value==='station',station=getStation();
  find('[data-batch-title]').textContent=selected?'일괄 작업 · '+selected+'건 선택':'일괄 작업 · 예약 실행';
  find('[data-batch-scope]').textContent=whole
   ?batchStation(station)?stationName(station)+'의 검토 대상 제보 (한 번에 최대 200건)':'지도가 연결된 역을 선택하세요.'
   :selected?'선택한 제보 '+selected+'건':'목록에서 함께 맡길 제보를 선택하세요.';
  find('[data-run]').textContent=whole?stationName(getStation())+' 일괄 작업':selected+'건 일괄 작업';
  find('[data-run]').disabled=submitting||(whole?!batchStation(station):!selected);
  find('[data-select-all]').disabled=submitting||!selectable||selected===selectable;
  find('[data-clear-selection]').disabled=submitting||!selected;
  find('[data-schedule]').disabled=submitting;
 }

 function renderRuns(data){
  const host=find('[data-batch-runs]');
  const signature=JSON.stringify(data.runs);
  if(signature===lastRuns)return;
  lastRuns=signature;
  const expanded=new Set([...host.querySelectorAll('details[open]')].map(element=>element.dataset.runItems));
  const focusedCancel=document.activeElement?.dataset?.cancelBatch;
  const html=data.runs.map(run=>{
   const counts=Object.entries(run.counts).map(([state,count])=>esc(labels[state]||state)+' '+count+'건').join(' · ');
   const items=run.items.map(item=>'<li><a href="?stage=all&report='+esc(item.report_id)+'">'+
    esc(item.description||'제보 '+item.report_id.slice(0,8))+'</a><span> · '+esc(labels[item.state]||item.state)+'</span>'+
    (item.error?' <small>'+esc(item.error)+'</small>':'')+'</li>').join('');
   return '<article class="batch-run"><b>'+esc(run.source==='schedule'?'예약 실행':'수동 실행')+' · '+run.items.length+'건</b>'+
    '<p class="fine">'+esc(date(run.created_at))+' · '+esc(stationName(run.station_key))+'</p><p>'+counts+'</p>'+
    (run.counts.pending?'<button type="button" data-cancel-batch="'+esc(run.id)+'">남은 배정 취소</button>':'')+
    '<details data-run-items="'+esc(run.id)+'"'+(expanded.has(run.id)?' open':'')+'><summary>제보별 상태</summary><ul>'+items+'</ul></details></article>';
  }).join('')||'아직 일괄 실행 기록이 없습니다.';
  if(host.innerHTML!==html){
   host.innerHTML=html;
   if(focusedCancel)[...host.querySelectorAll('[data-cancel-batch]')].find(element=>element.dataset.cancelBatch===focusedCancel)?.focus();
  }
 }

 function render(data){
  find('[data-batch-note]').textContent=data.note;
  const schedule=data.schedule;
  if(!initialized){
   find('[name=enabled]').checked=Boolean(schedule?.enabled);
   find('[name=interval]').value=String(schedule?.interval_minutes||60);
   if(!find('[name=notes]').value)find('[name=notes]').value=schedule?.notes||'';
   initialized=true;
  }
  find('[data-schedule-scope]').textContent='저장할 범위 '+stationName(getStation());
  find('[data-schedule-state]').textContent=schedule?.enabled
   ?'예약 켜짐 · '+stationName(schedule.station_key)+' · '+(data.worker_status==='online'?'다음 '+date(schedule.next_run_at):'작업자 연결 대기')
   :'예약 꺼짐';
  renderRuns(data);
 }

 async function load(){
  if(!owner)return;
  clearTimeout(timer);
  const actor=owner,version=++loadVersion;
  try{
   const data=await api('/api/console/batch-work');
   if(owner===actor&&version===loadVersion)render(data);
  }catch(error){
   if(owner===actor&&version===loadVersion)find('[data-batch-error]').textContent=error.message;
  }finally{
   if(owner===actor&&version===loadVersion)timer=setTimeout(load,15000);
  }
 }

 async function submit(action,extra={}){
  if(submitting||!owner)return;
  const actor=owner,consent=find('[name=consent]');
  const enabled=find('[name=enabled]').checked;
  if((action==='run'||action==='schedule'&&enabled)&&!consent.checked){
   toast('일괄 작업 범위를 확인해 주세요.');
   return;
  }
  const whole=find('[name=scope]').value==='station',selected=getSelected().slice().sort();
  if(action==='run'&&!whole&&!selected.length)return;
  const body={action,confirm:true};
  if(action==='cancel')Object.assign(body,extra);
  else{
   const station=getStation();
   if(!batchStation(station)&&(action==='run'||enabled)){
    toast('일괄 작업을 맡길 지도가 연결된 역을 선택해 주세요.');
    return;
   }
   body.station_key=batchStation(station)?station||null:null;
   body.notes=find('[name=notes]').value;
   if(action==='run'){
    if(!whole)body.report_ids=selected;
    const key=JSON.stringify(body);
    if(request?.key!==key)request={key,id:crypto.randomUUID()};
    body.request_id=request.id;
   }else{
    body.enabled=enabled;
    body.interval_minutes=Number(find('[name=interval]').value);
   }
  }
  submitting=true;
  clearTimeout(timer);
  loadVersion++;
  syncSelection();
  find('[data-batch-error]').textContent='';
  try{
   const data=await api('/api/console/batch-work',{method:'POST',body:JSON.stringify(body)});
   if(owner!==actor)return;
   render(data);
   if(action==='run'){
    const run=data.runs.find(entry=>entry.id===body.request_id);
    request=null;
    if(!whole)onClear();
    toast((run?.items.length??0)+'건을 맡겼습니다. 제보별 상태에서 진행을 확인하세요.');
   }else toast(action==='schedule'?'예약 설정을 저장했습니다.':'남은 배정을 취소했습니다.');
   consent.checked=false;
   await onChange?.();
  }catch(error){
   if(owner===actor)find('[data-batch-error]').textContent=error.message;
  }finally{
   submitting=false;
   syncSelection();
   if(owner)timer=setTimeout(load,15000);
  }
 }

 return {
  mount(target){
   panel=target;
   panel.innerHTML=`<summary data-batch-title>일괄 작업 · 예약 실행</summary>
    <p class="fine" data-batch-note></p>
    <div class="buttons"><button type="button" data-select-all>보이는 대상 모두 선택</button><button type="button" data-clear-selection>선택 해제</button></div>
    <label>맡길 범위<select name="scope"><option value="selected">선택한 제보만</option><option value="station">현재 역 필터 전체</option></select></label>
    <p class="fine" data-batch-scope></p>
    <label>추가 작업 지시<textarea name="notes" maxlength="2000" rows="3" placeholder="각 제보에 공통으로 전달할 지시가 있다면 적어 주세요."></textarea></label>
    <label><input name="consent" type="checkbox"> 이 범위의 사진·설명으로 비공개 수정안을 작성하도록 맡깁니다. 최종 승인은 직접 합니다.</label>
    <button type="button" data-run>선택한 제보 일괄 작업</button>
    <hr><label><input name="enabled" type="checkbox"> 역 범위로 예약 실행</label>
    <p class="fine" data-schedule-scope></p>
    <label>실행 주기<select name="interval"><option value="15">15분마다</option><option value="60">1시간마다</option><option value="360">6시간마다</option><option value="1440">매일</option><option value="10080">매주</option></select></label>
    <button type="button" data-schedule>예약 저장 · 끄기</button>
    <p class="fine" data-schedule-state></p><p class="error" role="status" data-batch-error></p><div data-batch-runs></div>`;
   find('[data-select-all]').onclick=onSelectAll;
   find('[data-clear-selection]').onclick=onClear;
   find('[name=scope]').onchange=syncSelection;
   find('[data-run]').onclick=()=>submit('run');
   find('[data-schedule]').onclick=()=>submit('schedule');
   find('[data-batch-runs]').onclick=event=>{
    const button=event.target.closest('[data-cancel-batch]');
    if(button)submit('cancel',{run_id:button.dataset.cancelBatch});
   };
   syncSelection();
  },
  session(actor){
   if(owner===actor)return;
   owner=actor;initialized=false;request=null;lastRuns=null;loadVersion++;clearTimeout(timer);
   find('[data-batch-runs]').replaceChildren();
   find('[data-batch-error]').textContent='';
   find('[name=notes]').value='';
   find('[name=scope]').value='selected';
   find('[name=consent]').checked=false;
   panel.hidden=!actor;
   syncSelection();
   if(actor)load();
  },
  selectionChanged(){
   syncSelection();
   find('[data-schedule-scope]').textContent='저장할 범위 '+stationName(getStation());
  },
  reload:load,
 };
}
