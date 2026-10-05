// Pairing deliberately grants drafts, not an approver session or public-map writes.
const now=()=>new Date().toISOString();
const randomCode=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function activeApprover(env,name){
 return String(env.APPROVERS||'').split(/[,\n]/).some(line=>{const i=line.indexOf(':');return i>0&&line.slice(0,i).trim()===name&&line.slice(i+1).trim().length>=8;});
}
export async function agentLink(env,principal){
 if(!principal||!env.DB)return null;
 const rows=(await env.DB.prepare('SELECT id,actor,label,expires_at FROM agent_links WHERE principal_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY redeemed_at DESC LIMIT 10').bind(principal,now()).all()).results;
 return rows.find(r=>activeApprover(env,r.actor))||null;
}
export async function connectAgent(env,principal,code,digest){
 if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(code))throw Error('승인자 화면에서 만든 15분 유효 연결 코드를 입력하세요.');
 const stamp=now(),hash=await digest('dots:'+code),r=await env.DB.prepare('SELECT * FROM agent_links WHERE code_hash=? AND revoked_at IS NULL AND expires_at>?').bind(hash,stamp).first();
 if(!r||!activeApprover(env,r.actor)||(r.principal_id&&r.principal_id!==principal)||(!r.principal_id&&r.code_expires_at<=stamp))throw Error('연결 코드가 만료·취소됐거나 이미 다른 계정에서 사용됐습니다. 새 코드를 요청하세요.');
 if(!r.principal_id){const out=await env.DB.prepare('UPDATE agent_links SET principal_id=?,redeemed_at=? WHERE id=? AND principal_id IS NULL AND revoked_at IS NULL AND code_expires_at>?').bind(principal,stamp,r.id,stamp).run();if(!out.meta.changes)throw Error('다른 계정에서 이미 연결했습니다. 승인자에게 새 코드를 요청하세요.');
  await env.DB.prepare('INSERT INTO audit_log (id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),r.actor,'dots.connect',r.id,JSON.stringify({scope:'assigned-drafts-only'}),stamp).run();
 }
 return {connected:true,label:r.label,expires_at:r.expires_at,scope:'assigned-drafts-only',can_approve:false};
}
// Called only after existing same-origin + approver-cookie authorization.
export async function dotsConsoleApi(request,env,{json,body,me,audit}){
 const p=new URL(request.url).pathname;if(!['/api/console/dots-link','/api/console/dots-link/revoke'].includes(p))return null;
 const db=env.DB,stamp=now();
 if(p==='/api/console/dots-link'&&request.method==='GET'){
  const rows=(await db.prepare('SELECT id,label,principal_id,expires_at FROM agent_links WHERE actor=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 10').bind(me.approver,stamp).all()).results;
  return json({links:rows.map(r=>({id:r.id,label:r.label,connected:Boolean(r.principal_id),expires_at:r.expires_at}))});
 }
 if(request.method!=='POST')return json({error:'지원하지 않는 요청입니다.'},405);
 const v=await body();if(v.confirm!==true)return json({error:'에비에게 맡긴 작업의 사진·설명과 초안 작성 권한을 제공하는 데 동의해 주세요. 최종 승인 권한은 제공하지 않습니다.'},400);
 if(p.endsWith('/revoke')){await db.prepare('UPDATE agent_links SET revoked_at=? WHERE actor=? AND revoked_at IS NULL').bind(stamp,me.approver).run();await audit(db,me.approver,'dots.revoke',me.approver,{scope:'assigned-drafts-only'});return json({revoked:true});}
 const since=new Date(Date.now()-3600000).toISOString(),count=await db.prepare('SELECT count(*) AS n FROM agent_links WHERE actor=? AND created_at>?').bind(me.approver,since).first();
 if(count.n>=6)return json({error:'연결 코드는 시간당 6회까지 만들 수 있습니다. 기존 연결을 확인하세요.'},429);
 const code=randomCode(),id=crypto.randomUUID(),expires=new Date(Date.now()+7*864e5).toISOString(),codeExpires=new Date(Date.now()+900000).toISOString();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('dots:'+code)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const out=await db.batch([
  db.prepare('INSERT INTO agent_links (id,actor,code_hash,label,created_at,code_expires_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM agent_links WHERE actor=? AND created_at>?)<6').bind(id,me.approver,hash,'Dots 에비 · 초안 전용',stamp,codeExpires,expires,me.approver,since),
  db.prepare('UPDATE agent_links SET revoked_at=? WHERE actor=? AND id<>? AND principal_id IS NULL AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM agent_links WHERE id=?)').bind(stamp,me.approver,id,id)
 ]);
 if(!out[0].meta.changes)return json({error:'연결 코드 생성 한도에 도달했습니다.'},429);
 await audit(db,me.approver,'dots.code',id,{scope:'assigned-drafts-only',expires_at:expires});
 return json({code,expires_at:codeExpires,access_expires_at:expires},201);
}
