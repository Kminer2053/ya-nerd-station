// Disposable local integration fixture. It never connects to production storage or accepts non-loopback clients.
import http from 'node:http';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,readdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer as createViteServer} from 'vite';
import {d1Adapter} from './sqlite-adapter.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.dirname(root),serviceRoot=path.resolve(process.env.PHOTO_SERVICE_ROOT||path.join(workspace,'worktrees/photo-service'));
const host='127.0.0.1',editorPort=4197,servicePort=4210;
const editorOrigin=`http://${host}:${editorPort}`,serviceOrigin=`http://${host}:${servicePort}`;
const temporary=await mkdtemp(path.join(tmpdir(),'station-photo-workflow-'));
const credentialsPath=path.join(temporary,'local-credentials.json');
const configuredApprovers=await readFile(path.join(root,'data-private/local-approvers.txt'),'utf8').then(value=>value.trim()).catch(error=>{if(error.code==='ENOENT')return '';throw error;});
const localAccounts=configuredApprovers.split(/[,\n]/).filter(line=>line.trim()).map(line=>{const split=line.indexOf(':');return {name:line.slice(0,split).trim(),password:line.slice(split+1).trim(),valid:split>0};});
if(localAccounts.some(account=>!account.valid||!account.name||account.name.length>40||account.password.length<8))throw Error('data-private/local-approvers.txt의 이름:비밀번호 형식을 확인하세요. 비밀번호는 8자 이상이어야 합니다.');
const actor=localAccounts[0]?.name||'로컬 검증 승인자',password=localAccounts[0]?.password||randomBytes(18).toString('base64url'),bearer=randomBytes(32).toString('base64url'),principal='local-photo-fixture';
const operatorToken=randomBytes(32).toString('hex');
const files=new Map(),servers=[],vites=[];
const db=new DatabaseSync(':memory:');
const serviceDb=new DatabaseSync(':memory:');
let closing=false;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}});
const secretEqual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const nativeFetch=globalThis.fetch;

async function close(){
 if(closing)return;closing=true;
 for(const server of servers)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});
 for(const vite of vites)await vite.close();
 db.close();serviceDb.close();globalThis.fetch=nativeFetch;
 await rm(temporary,{recursive:true,force:true});
}

async function assets(request){
 const u=new URL(request.url),name=decodeURIComponent(u.pathname).replace(/^\/+/,''),publicRoot=path.join(serviceRoot,'public');
 const candidate=path.resolve(publicRoot,name);
 if(!candidate.startsWith(publicRoot+path.sep))return new Response(null,{status:403});
 try{const resolved=await realpath(candidate);if(!resolved.startsWith(publicRoot+path.sep))return new Response(null,{status:403});
  const bytes=await readFile(resolved),mime={'.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[path.extname(resolved)]||'application/octet-stream';
  return new Response(bytes,{headers:{'Content-Type':mime}});
 }catch{return new Response(null,{status:404});}
}

async function seed(){
 for(const file of (await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(path.join(root,'drizzle',file),'utf8'));
 const sharp=createRequire(path.join(workspace,'service/package.json'))('sharp');
 const photoPath=path.join(workspace,'outputs/20260915_preppers_facade/preppers-front-facade.png');
 const source=await readFile(photoPath),image=await sharp(source).resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const info=await sharp(image).metadata(),stamp=new Date().toISOString(),reportId=randomUUID(),photoId=randomUUID();
 const facades=JSON.parse(await readFile(path.join(serviceRoot,'public/data/jury-frozen/approved-facades.json'),'utf8'));
 const entry=facades.replacements.find(r=>r.is_active!==false&&r.slot?.slot_alias==='F03WL004-S01');
 if(!entry)throw Error('프레퍼스 기준 슬롯이 없어 검증 자료를 만들 수 없습니다.');
 const s=entry.slot,position=[s.longitude,s.latitude,s.height_m];
 db.prepare('INSERT INTO reports (id,station_key,floor,position,type,description,place_note,status,reporter_hash,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(reportId,'S202103',s.floor,JSON.stringify(position),'facade','로컬 검증: 제공 사진의 프레퍼스 파사드를 기존 면 규격에 맞춰 수정합니다. 운영 데이터와는 무관한 시험 제보입니다.','사진에 없는 부분을 실측으로 표시하지 마세요.','review','local-fixture','[]',stamp,stamp);
 db.prepare('INSERT INTO report_photos (id,report_id,mime,size,width,height,caption,view_role,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(photoId,reportId,'image/png',image.length,info.width,info.height,'이미 보정된 기존 프로젝트 사진을 이용한 로컬 시험 원본','front',stamp);
 files.set('report/'+photoId,new Uint8Array(image));
 const expires=new Date(Date.now()+86400000).toISOString();
 db.prepare('INSERT INTO agent_links (id,actor,code_hash,principal_id,label,created_at,code_expires_at,expires_at,redeemed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),actor,createHash('sha256').update(randomBytes(32)).digest('hex'),principal,'로컬 Codex 검증 · 초안 전용',stamp,stamp,expires,stamp);
 db.prepare('INSERT INTO approver_sessions (token_hash,name,created_at,expires_at) VALUES (?,?,?,?)').run(createHash('sha256').update('approver:'+operatorToken).digest('hex'),actor,stamp,expires);
 await writeFile(credentialsPath,JSON.stringify({pid:process.pid,editorOrigin,serviceOrigin,actor,password,bearer,report_id:reportId,photo_id:photoId,facade_alias:s.slot_alias,px:[entry.replacement_width_px,entry.replacement_height_px]},null,2),{mode:0o600});
 return {reportId,photoId};
}

function toRequest(request,origin){
 const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
 const method=request.method||'GET';
 return new Request(new URL(request.url,origin),{method,headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(request),duplex:'half'}:{})});
}
async function send(response,result){response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));}

try{
 const fixture=await seed();
 // Commons uses its own disposable database; editor rows and production
 // credentials never enter the room/game runtime.
 for(const file of (await readdir(path.join(serviceRoot,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())serviceDb.exec(await readFile(path.join(serviceRoot,'drizzle',file),'utf8'));
 const env={DB:d1Adapter(db),LOCAL_PREVIEW:true,LOCAL_SERVICE_ORIGIN:serviceOrigin,APPROVERS:configuredApprovers||actor+':'+password,
  UPLOADS:{async put(key,value){files.set(key,new Uint8Array(value));},async get(key){return files.has(key)?{body:files.get(key)}:null;},async delete(key){files.delete(key);}}};
 const serviceEnv={LOCAL_PREVIEW:true,DB:d1Adapter(serviceDb),ASSETS:{fetch:assets}};
 // Fixture storage stays local. The map-source relay may read only the same
 // public VWorld tiles used by the browser; model APIs and production storage
 // remain blocked.
 globalThis.fetch=async(input,options)=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const method=String(options?.method||(typeof input==='object'&&input?.method)||'GET').toUpperCase();
  if(u.origin===serviceOrigin&&['GET','HEAD'].includes(method))return nativeFetch(input,options);
  if(u.origin===editorOrigin)return nativeFetch(input,options);
  if(u.origin==='https://cdn.vworld.kr'&&!u.username&&!u.password&&!u.search&&!u.hash&&['GET','HEAD'].includes(method)&&/^\/TDServer\/services\/map4\/7Iuk64K0\/S\d{6}\/(?:tileset\.json|B_\d+_\d+_\d+\.b3dm)$/.test(u.pathname))return nativeFetch(input,options);
  throw Error('로컬 검증에서는 외부 서버 요청을 차단합니다: '+u.hostname);
 };
 const editorVite=await createViteServer({configFile:false,root,publicDir:path.join(root,'public'),appType:'mpa',server:{middlewareMode:true,hmr:false,ws:false,fs:{strict:true,allow:[root]}},optimizeDeps:{noDiscovery:true}});
 const {localScenePlugin}=await import(pathToFileURL(path.join(serviceRoot,'tools/local-scene-plugin.mjs')).href);
 const serviceVite=await createViteServer({configFile:false,root:serviceRoot,plugins:[localScenePlugin(workspace)],publicDir:path.join(serviceRoot,'public'),appType:'mpa',server:{middlewareMode:true,hmr:false,ws:false,fs:{strict:true,allow:[serviceRoot]}},optimizeDeps:{noDiscovery:true}});
 vites.push(editorVite,serviceVite);
 for(const [port,vite,isEditor]of [[editorPort,editorVite,true],[servicePort,serviceVite,false]]){
  const origin=isEditor?editorOrigin:serviceOrigin;
  const server=http.createServer(async(request,response)=>{
   try{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)||!['127.0.0.1:'+port,'localhost:'+port].includes(request.headers.host)){response.writeHead(403).end();return;}
    const url=new URL(request.url,origin);
    if(url.pathname==='/__fixture/health'){await send(response,json({fixture:true,storage:'memory',production:false}));return;}
    if(isEditor&&url.pathname==='/__fixture/open'&&request.method==='GET'){
     response.writeHead(302,{'Set-Cookie':`nerd-approver=${operatorToken}; Path=/; HttpOnly; SameSite=Strict`,'Location':'/console/?serviceOrigin='+encodeURIComponent(serviceOrigin),'Cache-Control':'no-store'});response.end();return;
    }
    if(url.pathname.startsWith('/api/')||url.pathname==='/mcp'){
     if(!isEditor){
      const reading=request.method==='GET'&&['/api/toolkit/seoul','/api/session','/api/catalog'].includes(url.pathname);
      const roomAction=request.method==='POST'&&/^\/api\/commons\/(?:join|sync|leave)$/.test(url.pathname);
      if(!reading&&!roomAction){await send(response,json({error:'로컬 지도 조회와 메모리 공유방 시험만 허용합니다.'},404));return;}
      const module=await serviceVite.ssrLoadModule('/server/index.js');
      await send(response,await module.default.fetch(toRequest(request,origin),serviceEnv));return;
     }
     const input=toRequest(request,origin);
     // A development-only principal is supplied only after a private, per-run bearer check.
     input.headers.delete('oai-authenticated-user-id');input.headers.delete('oai-authenticated-user-email');
     if(url.pathname==='/mcp'){
      if(!secretEqual(input.headers.get('Authorization'),'Bearer '+bearer)){await send(response,json({error:'로컬 시험 연결 토큰이 필요합니다.'},401));return;}
      input.headers.set('oai-authenticated-user-id',principal);input.headers.delete('Origin');
     }
     const module=await editorVite.ssrLoadModule('/server/index.js');
     await send(response,await module.default.fetch(input,env));return;
    }
    vite.middlewares(request,response,()=>{response.writeHead(404).end();});
   }catch(error){console.error('로컬 검증 요청 실패:',String(error.message).slice(0,400));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'로컬 검증 요청에 실패했습니다.'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});servers.push(server);
 }
 console.log('편집기 로컬 검증(시험 승인자): '+editorOrigin+'/__fixture/open');
 console.log('서울역 미리보기: '+serviceOrigin+'/app/?site=S202103&toolkit=1&toolkitOrigin='+encodeURIComponent(editorOrigin));
 console.log('게임 미리보기: '+serviceOrigin+'/commons/');
 console.log('시험 제보 ID: '+fixture.reportId);
 console.log('시험 자격증명 파일(외부 공유 금지): '+credentialsPath);
 console.log('D1/R2는 메모리에만 있습니다. VWorld 원본 지도 조회만 허용하며 외부 AI·운영 저장소는 차단합니다. Ctrl+C로 종료합니다.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
}catch(error){await close();console.error('검증 미리보기 시작 실패:',error.message);process.exitCode=1;}
