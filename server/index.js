import {validateProject,sampleProject} from '../src/model.js';
import {saveLocked} from '../src/stations.js';
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff',...headers}});
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function bytes(req,max){if(+(req.headers.get('Content-Length')||0)>max)throw Error('파일·입력 용량 초과');const chunks=[];let size=0;for await(const c of req.body||[]){size+=c.length;if(size>max)throw Error('파일·입력 용량 초과');chunks.push(c);}const a=new Uint8Array(size);let p=0;for(const c of chunks){a.set(c,p);p+=c.length;}return a;}
export default {async fetch(request,env){const u=new URL(request.url),p=u.pathname;
 if(!p.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(p==='/api/seoul/snapshot'||p==='/api/seoul/hourly'){
  if(request.method!=='GET')return json({error:'서울역 심사본 저장 잠금'},423);
  const base=env.LOCAL_PREVIEW?'http://127.0.0.1:4196':'https://station-one-collab.soalsebi.chatgpt.site';
  const origin=u.searchParams.get('origin');if(p.endsWith('hourly')&&!/^[A-Z0-9_-]{1,100}$/.test(origin||''))return json({error:'원점 ID 오류'},400);
  try{const url=p.endsWith('snapshot')?base+'/api/toolkit/seoul':base+'/data/experience/origins/'+origin+'.json';const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('기준 자료 응답 '+r.status);return json(await r.json());}catch(e){return json({error:'서울역 확정 자료 연결 실패. '+e.message},503);}
 }
 const tile=p.match(/^\/api\/map-source\/(S\d{6})\/(tileset\.json|B_\d+_\d+_\d+\.b3dm)$/);
 if(tile){if(!['GET','HEAD'].includes(request.method))return json({error:'조회 전용'},405);try{const r=await fetch(`https://cdn.vworld.kr/TDServer/services/map4/7Iuk64K0/${tile[1]}/${tile[2]}`,{signal:AbortSignal.timeout(12000)});if(!r.ok)return json({error:'원본 지도 준비 중',status:r.status},503);return new Response(request.method==='HEAD'?null:r.body,{headers:{'Content-Type':tile[2]==='tileset.json'?'application/json':'application/octet-stream','Cache-Control':'public,max-age=300'}});}catch{return json({error:'원본 지도 연결 실패. 역 설정과 편집 초안은 유지됩니다.'},503);}}
 const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)nerd-owner=([a-f0-9-]{36})(?:;|$)/)?.[1],owner=token?await digest(token):null;
 const writing=!['GET','HEAD'].includes(request.method);
 if(writing&&(request.headers.get('Origin')!==u.origin||(!p.includes('/files')&&!request.headers.get('Content-Type')?.startsWith('application/json'))))return json({error:'동일 사이트에서 저장하세요.'},403);
 try{
   if(!env.DB)return json({error:'서버 저장소 연결을 확인하세요.'},503);
   if(p==='/api/projects'&&request.method==='GET')return json(owner?(await env.DB.prepare('SELECT id,name,revision,updated_at,shared FROM editor_projects WHERE owner_hash=? ORDER BY updated_at DESC').bind(owner).all()).results:[]);
   if(p==='/api/projects'&&request.method==='POST'){
     const raw=await bytes(request,20_000_000),input=raw.length?JSON.parse(new TextDecoder().decode(raw)):{};if(saveLocked(input.project||{}))return json({error:'심사 기간 서울역은 임시 편집만 가능합니다. 원본과 공개 편집기 모두 서울역 저장을 차단합니다.',jury_locked:true},423);const body=validateProject(input.project||sampleProject());const id=crypto.randomUUID(),secret=token||crypto.randomUUID(),hash=await digest(secret),now=new Date().toISOString();
     const count=await env.DB.prepare('SELECT count(*) AS total FROM editor_projects WHERE owner_hash=?').bind(hash).first();if(count.total>=30)return json({error:'브라우저별 프로젝트는 30개까지입니다. JSON으로 내보내 기존 프로젝트를 활용하세요.'},429);
     const inserted=await env.DB.prepare('INSERT INTO editor_projects (id,owner_hash,name,revision,shared,body,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM editor_projects)<200 AND (SELECT COALESCE(sum(length(body)),0) FROM editor_projects)+?<64000000').bind(id,hash,body.name,0,0,JSON.stringify(body),now,JSON.stringify(body).length).run();
     if(!inserted.meta.changes)return json({error:'공개 시연 저장 한도에 도달했습니다. JSON 내보내기를 이용하세요. 저장 한도는 자동 증설하지 않습니다.'},429);
     return json({id,project:body,revision:0,canEdit:true,shared:false},201,{'Set-Cookie':'nerd-owner='+secret+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000'+(u.protocol==='https:'?'; Secure':'')});
   }
   const m=p.match(/^\/api\/projects\/([a-f0-9-]{36})(\/files)?$/),fm=p.match(/^\/api\/files\/([a-f0-9-]{36})$/);
   let file=null;if(fm)file=await env.DB.prepare('SELECT project_id,mime,size FROM editor_files WHERE id=?').bind(fm[1]).first();
   if(!m&&!file)return json({error:'등록되지 않은 경로입니다.'},404);
   const id=m?.[1]||file.project_id,r=await env.DB.prepare('SELECT * FROM editor_projects WHERE id=?').bind(id).first();if(!r||r.owner_hash!==owner&&!r.shared)return json({error:'프로젝트가 없거나 공개되지 않았습니다.'},404);
   const canEdit=r.owner_hash===owner;
   if(writing&&!canEdit)return json({error:'공개 프로젝트는 복사한 뒤 수정하세요.'},403);
   if(writing&&saveLocked(JSON.parse(r.body)))return json({error:'서울역 심사본 저장·업로드 잠금',jury_locked:true},423);
   if(file&&request.method==='GET'){if(!env.UPLOADS)return json({error:'이미지 저장소 연결 실패'},503);const object=await env.UPLOADS.get(fm[1]);return object?new Response(object.body,{headers:{'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private,max-age=3600'}}):json({error:'이미지 없음'},404);}
   if(m?.[2]&&request.method==='POST'){
     if(!env.UPLOADS)return json({error:'이미지 저장소가 연결되지 않았습니다.'},503);const a=await bytes(request,4_000_000),isPng=a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71,isJpeg=a[0]===255&&a[1]===216&&a[2]===255;if(!isPng&&!isJpeg)return json({error:'PNG 또는 JPEG 사진만 업로드하세요. 최대 4MB.'},400);
     const count=await env.DB.prepare('SELECT count(*) AS total FROM editor_files WHERE project_id=?').bind(id).first();if(count.total>=100)return json({error:'프로젝트당 사진은 100개까지입니다.'},429);
     const fid=crypto.randomUUID(),mime=isPng?'image/png':'image/jpeg';const reserved=await env.DB.prepare('INSERT INTO editor_files (id,project_id,mime,size,created_at) SELECT ?,?,?,?,? WHERE (SELECT COALESCE(sum(size),0) FROM editor_files)+?<=100000000').bind(fid,id,mime,a.length,new Date().toISOString(),a.length).run();if(!reserved.meta.changes)return json({error:'시연 사진 저장 한도 100MB에 도달했습니다. 자동 증설하지 않습니다.'},429);try{await env.UPLOADS.put(fid,a,{httpMetadata:{contentType:mime}});}catch(e){await env.DB.prepare('DELETE FROM editor_files WHERE id=?').bind(fid).run();throw e;}return json({url:'/api/files/'+fid},201);
   }
   if(request.method==='GET')return json({id,project:JSON.parse(r.body),revision:r.revision,shared:Boolean(r.shared),canEdit});
   if(request.method==='PUT'){
     const input=JSON.parse(new TextDecoder().decode(await bytes(request,20_000_000)));if(saveLocked(input.project||{}))return json({error:'서울역 심사본 저장 잠금',jury_locked:true},423);const body=validateProject(input.project);if(!Number.isInteger(input.revision)||typeof input.shared!=='boolean')return json({error:'리비전·공개 설정 오류'},400);
     const total=await env.DB.prepare('SELECT COALESCE(sum(length(body)),0) AS size FROM editor_projects').first();if(total.size-r.body.length+JSON.stringify(body).length>64000000)return json({error:'시연 데이터 저장 한도에 도달했습니다. JSON으로 내보내세요.'},429);
     const now=new Date().toISOString(),out=await env.DB.prepare('UPDATE editor_projects SET name=?,body=?,revision=?,shared=?,updated_at=? WHERE id=? AND owner_hash=? AND revision=?').bind(body.name,JSON.stringify(body),input.revision+1,input.shared?1:0,now,id,owner,input.revision).run();
     if(!out.meta.changes)return json({error:'다른 창에서 수정했습니다. 현재 초안을 내보낸 후 새로 불러오세요.'},409);return json({saved:true,revision:input.revision+1,updated_at:now});
   }
   return json({error:'지원하지 않는 요청입니다.'},405);
 }catch(e){return json({error:e.message||'저장 실패. 입력값을 유지하고 다시 시도하세요.'},400);}
}};
