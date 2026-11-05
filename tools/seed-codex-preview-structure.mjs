#!/usr/bin/env node
// A single disposable local draft for visual QA. No final approval or model call.
import {readFile,writeFile,open,unlink,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),workspace=path.dirname(root);
export function localOrigin(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='4197'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('4197 포트의 로컬 편집기만 허용합니다.');return u.origin;}
export async function seed(credentialsPath){
 const credentialFile=await realpath(credentialsPath),c=JSON.parse(await readFile(credentialFile,'utf8')),origin=localOrigin(c.editorOrigin);
 if(typeof c.actor!=='string'||typeof c.password!=='string'||typeof c.bearer!=='string'||!c.password||!c.bearer)throw Error('로컬 시험 자격증명 형식을 확인하세요.');
 const statePath=path.join(path.dirname(credentialFile),'structure-preview-result.json'),lockPath=statePath+'.lock';
 try{const prior=JSON.parse(await readFile(statePath,'utf8'));if(prior.complete&&prior.origin===origin)return prior.output;throw Error('이 시험 파일에서 이미 시작한 구조물 초안이 있습니다. 중복 생성하지 않습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const lock=await open(lockPath,'wx',0o600);await lock.close();let cookie='',started=false;
 const save=value=>writeFile(statePath,JSON.stringify({origin,...value}),{mode:0o600});
 const request=async(endpoint,{method='GET',json,bytes,mime}={})=>{
  const url=new URL(endpoint,origin);if(url.origin!==origin)throw Error('외부 요청은 허용하지 않습니다.');
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(json!==undefined?{'Content-Type':'application/json'}:mime?{'Content-Type':mime}:{})},...(json!==undefined?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});
  const set=response.headers.get('set-cookie');if(set){const next=set.split(';')[0],name=next.split('=')[0];cookie=[...cookie.split('; ').filter(v=>v&&!v.startsWith(name+'=')),next].join('; ');}
  if(!response.ok)throw Error('로컬 시험 API 오류: '+endpoint.split('?')[0]+' ('+response.status+')');return response.json();
 };
 const mcp=async(name,args)=>{
  const response=await fetch(origin+'/mcp',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+c.bearer,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});
  if(!response.ok)throw Error('로컬 초안 도구 오류: '+name+' ('+response.status+')');const value=await response.json();if(value.error||value.result?.isError)throw Error('로컬 초안 도구가 요청을 거부했습니다: '+name);const r=value.result;if(r.structuredContent)return r.structuredContent;for(const item of r.content||[])if(item.type==='text')try{return JSON.parse(item.text);}catch{}throw Error('초안 도구 응답 형식을 확인하세요.');
 };
 try{
  const health=await request('/__fixture/health');if(health.fixture!==true||health.storage!=='memory'||health.production!==false)throw Error('운영 저장소에서는 이 도구를 실행하지 않습니다.');
  const sharp=createRequire(path.join(workspace,'service/package.json'))('sharp');
  let source;try{source=await readFile(path.join(workspace,'worktrees/photo-service/public/assets/seoul-information-zone/information-booth-front.png'));}catch(e){if(e.code!=='ENOENT')throw e;source=await sharp({create:{width:1024,height:768,channels:4,background:'#7fbbc2'}}).png().toBuffer();}
  const photo=await sharp(source).resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).png().toBuffer(),front=await sharp(source).resize(1024,768,{fit:'fill'}).png().toBuffer(),right=await sharp(source).resize(853,1024,{fit:'fill'}).png().toBuffer();
  await request('/api/console/login',{method:'POST',json:{name:c.actor,password:c.password}});
  const position=[126.97070,37.55390,36.19],report=await request('/api/reports',{method:'POST',json:{station:'S202103',floor:'2F',position,type:'new',description:'로컬 렌더 검증 전용: 두 벽과 상단 간판, 문 개구부가 있는 복합 구조물 추정 초안입니다. 실제 신규 시설 제보나 실측 결과가 아닙니다.',consent:true}});started=true;await save({complete:false,report_id:report.id});
  const photos=[];for(const role of ['front','right']){const ph=await request('/api/reports/'+report.id+'/photos',{method:'POST',bytes:photo,mime:'image/png'});photos.push({id:ph.id,view_role:role,caption:'기존 공개 이미지로 만든 로컬 렌더 검증 사진 · 실제 해당 면 촬영 아님'});}
  await request('/api/reports/'+report.id+'/submit',{method:'POST',json:{photos}});
  const detail=await request('/api/console/reports/'+report.id),chat=await request('/api/console/reports/'+report.id+'/chat',{method:'POST',json:{request_id:randomUUID(),start:true,confirm:true,report_version:detail.report.updated_at,text:'로컬 렌더 검증용 추정입니다. 제공한 공개 이미지를 면별 규격으로 보정하여 문 개구부가 뚫린 두 벽·상단 간판의 비공개 복합 모형만 만들어 주세요. 실제 시설이나 실측이라고 표시하지 말고 최종 승인은 하지 마세요.',attachment_ids:[]}}),job=chat.job.id;
  await save({complete:false,report_id:report.id,job_id:job});
  const faces=[];for(const [index,image]of [front,right].entries()){
   const artifact=await mcp('toolkit_store_draft_artifact',{job_id:job,request_id:randomUUID(),source_photo_ids:[photos[index].id],image:'data:image/png;base64,'+image.toString('base64'),provenance:{method:'rectified',evidence:'로컬 렌더 검증용 추정: 기존 공개 이미지를 각 면의 규격으로 재표본화했습니다.',uncertainty:'실제 신규 시설·정면 및 우측면 촬영·실측 결과가 아니며 배치와 모양은 렌더 시험용 추정입니다.',privacy_reviewed:true}});
   faces.push({side:index?'right':'front',artifact_id:artifact.artifact_id});
  }
  const plane=(id,vertices,texture,uv)=>({id,type:'plane',vertices,texture,uv}),parts=[
   plane('front-left',[[-2,-1.25,0],[-.6,-1.25,0],[-.6,-1.25,2.5],[-2,-1.25,2.5]],'front',[[0,0],[.35,0],[.35,.833],[0,.833]]),
   plane('front-right',[[.6,-1.25,0],[2,-1.25,0],[2,-1.25,2.5],[.6,-1.25,2.5]],'front',[[.65,0],[1,0],[1,.833],[.65,.833]]),
   plane('door-lintel',[[-.6,-1.25,2.25],[.6,-1.25,2.25],[.6,-1.25,2.5],[-.6,-1.25,2.5]],'front',[[.35,.75],[.65,.75],[.65,.833],[.35,.833]]),
   plane('right-wall',[[2,-1.25,0],[2,1.25,0],[2,1.25,2.5],[2,-1.25,2.5]],'right',[[0,0],[1,0],[1,1],[0,1]]),
   plane('raised-sign',[[-1.8,-1.25,2.5],[1.8,-1.25,2.5],[1.8,-1.25,3],[-1.8,-1.25,3]],'front',[[.05,.833],[.95,.833],[.95,1],[.05,1]]),
   // Overlapping horizontal ornaments exercise height-aware preview depth.
   plane('upper-trim',[[-1.8,-1.2,2.96],[1.8,-1.2,2.96],[1.8,-.7,2.96],[-1.8,-.7,2.96]],'front',[[.1,.85],[.9,.85],[.9,.96],[.1,.96]]),
   plane('lower-trim',[[-1.8,-1.2,2.72],[1.8,-1.2,2.72],[1.8,-.7,2.72],[-1.8,-.7,2.72]],'front',[[.1,.72],[.9,.72],[.9,.83],[.1,.83]])
  ];
  const drafted=await mcp('toolkit_submit_plan',{job_id:job,plan:{kind:'structure',name:'로컬 검증 · 개구부와 돌출 간판',summary:'로컬 렌더 검증용 추정: 전체 상자 없이 두 벽·문 개구부·상단 간판과 UV 크롭을 배치했습니다. 최종 승인 전입니다.',confidence:.99,questions:[],hide_ids:[],faces,structure:{name:'로컬 검증 · 개구부와 돌출 간판',floor:'2F',position,size:[4,2.5,3],heading:0,color:'#d7e0de',dimension_basis:'estimated',parts},structure_provenance:{evidence:'로컬 렌더 검증용 추정. 기존 공개 사진과 임의 시험 치수로 parts/plane/UV 표현을 검증합니다.',uncertainty:'실제 존재 시설·현장 촬영 면·정확한 치수·배치가 아니며 운영 지도 반영용 실증 자료가 아닙니다.'}}});
  if(drafted.status!=='draft'||!drafted.proposal_id)throw Error('비공개 초안이 저장되지 않았습니다.');
  const url=new URL('/console/',origin);url.search=new URLSearchParams({serviceOrigin:'http://127.0.0.1:4210',stage:'all',report:report.id});
  const output={report_id:report.id,job_id:job,proposal_id:drafted.proposal_id,consoleURL:url.href};await save({complete:true,output});return output;
 }catch(e){if(!started)await unlink(statePath).catch(()=>{});throw e;}
 finally{await unlink(lockPath).catch(()=>{});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--credentials')throw Error('사용법: node tools/seed-codex-preview-structure.mjs --credentials PATH');process.stdout.write(JSON.stringify(await seed(args[1]))+'\n');}
 catch(e){process.stderr.write('로컬 구조물 검증 초안을 만들지 못했습니다: '+String(e.message).slice(0,300)+'\n');process.exitCode=1;}
}
