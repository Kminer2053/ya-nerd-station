// Progress line for a report, shared by the public "내 제보" and the report inbox:
// 접수 → 자동 정리 → 승인자 검토 → 보정 제안 → 승인 → 지도 반영 (held pauses, duplicate/rejected close, a locked station waits).
import './progress.css';
import {STAGES,progressOf} from './reports.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=iso=>{if(!iso)return '';const d=new Date(iso);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
export const progressState=r=>r.progress||progressOf(r.status,r.proposal?.status||r.proposal_status);
// Wording for where the report stands now.
export function stageLabel(r,p=progressState(r)){
 if(r.status==='accepted'&&p.bucket==='draft')return '채택 · 초안 작업';
 if(p.state==='paused')return '보류';
 if(p.state==='closed')return r.status==='duplicate'?'중복으로 종료':'반려';
 if(p.state==='waiting')return '반영 대기';
 if(p.state==='done')return '지도 반영 완료';
 return ['접수','자동 정리 중','승인자 검토 대기','제안 승인 대기','승인','지도 반영'][p.at];
}
function dates(r,p){
 const h=r.history||[],first=s=>h.find(x=>x.status===s)?.at,last=s=>[...h].reverse().find(x=>x.status===s)?.at;
 const d=[first('received'),first('analyzing'),first('review'),r.proposal?.created_at,['queued','applied'].includes(r.status)?last(r.status)||r.proposal?.decided_at:null,r.status==='applied'?last('applied')||r.proposal?.decided_at:null];
 if(p.state==='paused'||p.state==='closed')d[p.at]=last(r.status);
 return d;
}
// Pill with the stage wording ("제안 승인 대기" rather than the raw "검토 대기" status).
const TONE={review:'info',proposed:'lime',queued:'lime',applied:'ok',held:'warn',closed:'mute',draft:'mute'};
export const stagePill=r=>{const p=progressState(r);return '<span class="pill '+(r.status==='rejected'?'warn':TONE[p.bucket]||'mute')+'">'+esc(stageLabel(r,p))+'</span>';};
const stateOf=(i,p)=>i<p.at||(p.state==='done'&&i<=p.at)?'done':i===p.at?p.state:'todo';
const mark={done:'✓',paused:'Ⅱ',closed:'✕',waiting:'…'};
// compact: six segments and the current wording (inbox rows); otherwise a labelled stepper with dates.
export function progressLine(r,{compact=false}={}){
 const p=progressState(r),label=stageLabel(r,p);
 if(compact)return '<span class="prog '+p.state+'" role="img" aria-label="진행 '+(p.at+1)+'/'+STAGES.length+' 단계 · '+esc(label)+'">'+STAGES.map((_,i)=>'<i class="'+stateOf(i,p)+'"></i>').join('')+'<em>'+esc(label)+'</em></span>';
 const d=dates(r,p);
 return '<ol class="stepper" aria-label="진행 단계">'+STAGES.map((s,i)=>{const st=stateOf(i,p),current=i===p.at&&st!=='done';
  return '<li class="'+st+'"'+(current?' aria-current="step"':'')+'><span class="dot" aria-hidden="true">'+(mark[st]||i+1)+'</span><b>'+esc(current?label:s)+'</b><small>'+esc(st==='todo'?'':when(d[i]))+'</small></li>';}).join('')+'</ol>';
}
