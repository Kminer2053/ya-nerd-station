import {decodePhoto,encodePhoto} from './work-images.js';
import {IMAGE_LIMITS,validPixels} from '../src/draft-geometry.js';
import {structurePixels} from '../src/reports.js';
const parse=(s,f={})=>{try{return JSON.parse(s);}catch{return f;}};
export const artifactUsage='(SELECT COALESCE(sum(size),0) FROM job_artifacts)';
const usage='(SELECT COALESCE(sum(size),0) FROM report_photos)+(SELECT COALESCE(sum(size),0) FROM proposals)+(SELECT COALESCE(sum(size),0) FROM work_files)+'+artifactUsage;
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');
const summary=a=>({artifact_id:a.id,job_id:a.job_id,sha256:a.sha256,px:[a.width,a.height],mime:a.mime,source_photo_ids:parse(a.source_photo_ids,[]),provenance:parse(a.provenance),can_approve:false});
// Validate correctable plan input before claiming the job or staging proposal files.
export async function validatePlanArtifacts(env,j,plan,geometry,slot){
 let total=0;
 for(const [side,face] of Object.entries(plan.faces)){
  if(!face.artifact_id)continue;
  const a=await env.DB.prepare('SELECT width,height,size FROM job_artifacts WHERE id=? AND job_id=? AND actor=? AND report_version=?').bind(face.artifact_id,j.id,j.actor,j.report_version).first();
  if(!a)throw Error('현재 작업에 올린 이미지가 아닙니다. 이 작업의 이미지 ID로 다시 제출하세요.');
  const px=plan.kind==='structure'?structurePixels(geometry.size,side):slot.px;
  if(a.width!==px[0]||a.height!==px[1])throw Error(side+' 이미지가 대상 규격('+px.join('×')+' px)과 다릅니다. 이미지를 맞춰 같은 작업에 다시 제출하세요.');
  total+=a.size;if(total>16_000_000)throw Error('전체 초안 이미지 용량이 16MB를 넘습니다. 이미지를 줄여 다시 제출하세요.');
 }
 for(const part of geometry?.parts||[]){const textures=part.type==='plane'?[part.texture]:Object.values(part.facades||{});if(textures.some(side=>!plan.faces[side]))throw Error('구성요소가 제출하지 않은 사진 면을 사용합니다. 해당 면을 추가해 다시 제출하세요.');}
}
export async function storeDraftArtifact(args,env,{j,r,photos},link,principal,imageInfo){
 if(j.status!=='awaiting_external')throw Error('최신 대기 작업에만 이미지를 올릴 수 있습니다.');
 if(!/^[a-f0-9-]{36}$/.test(args.request_id||''))throw Error('이미지 전송 ID를 확인하세요.');
 const ids=args.source_photo_ids,p=args.provenance;
 if(!Array.isArray(ids)||!ids.length||ids.length>32||new Set(ids).size!==ids.length||ids.some(id=>!photos.some(ph=>ph.id===id)))throw Error('이 작업에서 읽은 원본 사진을 출처로 지정하세요.');
 if(!p||Object.keys(p).some(k=>!['method','evidence','uncertainty','privacy_reviewed'].includes(k))||!['generated','rectified'].includes(p.method)||p.privacy_reviewed!==true||['evidence','uncertainty'].some(k=>typeof p[k]!=='string'||!p[k].trim()||p[k].length>1000))throw Error('생성·보정 근거와 한계, 실제 출력 이미지의 개인정보 검수를 기록하세요.');
 const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(args.image||''));
 if(!match||match[2].length>6_400_000)throw Error('이미지는 4.8MB 이하 PNG/JPEG로 보내세요.');
 const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)),info=imageInfo(bytes);
 if(!info||info.mime!==match[1]||bytes.length>IMAGE_LIMITS.bytes||!validPixels([info.width,info.height]))throw Error('이미지 규격은 긴 변 4096px·4MP·4.8MB 이하입니다.');
 // Decode and re-encode: metadata is not published, and a forged image header is never trusted.
 const output=encodePhoto(decodePhoto(bytes,info,{artifact:true}));if(output.length>IMAGE_LIMITS.bytes)throw Error('PNG 결과가 4.8MB를 초과합니다. 크기나 색 수를 줄여 주세요.');
 const current=async()=>{
  const anchor=parse(j.input).chat_message_id,sql=anchor?" AND (SELECT id FROM work_messages WHERE report_id=? AND actor=? AND role='admin' ORDER BY rowid DESC LIMIT 1)=?":'',args=anchor?[r.id,j.actor,anchor]:[];
  return env.DB.prepare("SELECT j.id FROM report_jobs j JOIN reports r ON r.id=j.report_id JOIN agent_links l ON l.id=? WHERE j.id=? AND j.status='awaiting_external' AND r.status='accepted' AND r.updated_at=? AND l.principal_id=? AND l.actor=j.actor AND l.revoked_at IS NULL AND l.expires_at>?"+sql).bind(link.id,j.id,j.report_version,principal,new Date().toISOString(),...args).first();
 };
 const hash=await sha(output),db=env.DB,old=await db.prepare('SELECT * FROM job_artifacts WHERE id=?').bind(args.request_id).first();
 if(old){if(!await current())throw Error('작업이나 연결이 변경됐습니다.');if(old.job_id!==j.id||old.actor!==j.actor||old.sha256!==hash||old.source_photo_ids!==JSON.stringify(ids)||old.provenance!==JSON.stringify(p))throw Error('같은 전송 ID의 다른 이미지·출처입니다.');return summary(old);}
 const at=new Date().toISOString(),id=args.request_id,key='draft-artifact/'+id+'/'+crypto.randomUUID();
 const row={id,job_id:j.id,sha256:hash,width:info.width,height:info.height,mime:'image/png',source_photo_ids:JSON.stringify(ids),provenance:JSON.stringify(p)};
 await env.UPLOADS.put(key,output,{httpMetadata:{contentType:'image/png'}});
 try{
  const anchor=parse(j.input).chat_message_id,anchorSql=anchor?" AND (SELECT id FROM work_messages WHERE report_id=? AND actor=? AND role='admin' ORDER BY rowid DESC LIMIT 1)=?":'',anchorArgs=anchor?[r.id,j.actor,anchor]:[];
  const out=await db.prepare("INSERT INTO job_artifacts (id,job_id,report_id,actor,report_version,sha256,mime,size,width,height,source_photo_ids,provenance,storage_key,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM report_jobs WHERE id=? AND status='awaiting_external') AND EXISTS (SELECT 1 FROM reports WHERE id=? AND status='accepted' AND updated_at=?) AND EXISTS (SELECT 1 FROM agent_links WHERE id=? AND principal_id=? AND actor=? AND revoked_at IS NULL AND expires_at>?) AND (SELECT count(*) FROM job_artifacts WHERE job_id=?)<32 AND "+usage+'+?<=?'+anchorSql)
   .bind(id,j.id,r.id,j.actor,j.report_version,hash,'image/png',output.length,info.width,info.height,JSON.stringify(ids),JSON.stringify(p),key,at,j.id,r.id,j.report_version,link.id,principal,j.actor,at,j.id,output.length,Math.max(10,Math.min(2000,Number(env.REPORT_STORAGE_MB)||500))*1e6,...anchorArgs).run();
  if(!out.meta.changes)throw Error('작업·연결·최신 대화가 변경됐거나 이미지 저장 한도에 도달했습니다.');
 }catch(e){await env.UPLOADS.delete(key);const raced=await db.prepare('SELECT * FROM job_artifacts WHERE id=?').bind(id).first();if(raced&&raced.job_id===j.id&&raced.actor===j.actor&&raced.sha256===hash&&raced.source_photo_ids===JSON.stringify(ids)&&raced.provenance===JSON.stringify(p)&&await current())return summary(raced);throw e;}
 await db.prepare('INSERT INTO audit_log (id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),j.actor,'draft.artifact',id,JSON.stringify({job:j.id,sha256:hash,sources:ids,method:p.method}),at).run();
 return summary(row);
}
export async function readDraftArtifact(env,id,j){
 const a=await env.DB.prepare('SELECT * FROM job_artifacts WHERE id=? AND job_id=? AND actor=? AND report_version=?').bind(id,j.id,j.actor,j.report_version).first();
 if(!a)throw Error('현재 작업에 올린 이미지가 아닙니다.');
 const o=await env.UPLOADS.get(a.storage_key);if(!o)throw Error('초안 이미지가 없습니다.');
 const bytes=new Uint8Array(await new Response(o.body).arrayBuffer());if(await sha(bytes)!==a.sha256)throw Error('저장된 이미지 검증에 실패했습니다.');
 return {bytes,mime:a.mime,px:[a.width,a.height],provenance:parse(a.provenance),sources:parse(a.source_photo_ids,[]),sha256:a.sha256};
}
