// Find each KTX station in VWorld's own indoor-map list — the endpoint the VWorld web map (dtkmap) uses, not a public
// OpenAPI — and keep only what VWorld returns: site id (uid), official name (kname), class, centre and per-floor heights.
// A station is connected only when the name matches exactly (or one unambiguous 고속철도 result) and its CDN tileset
// exists and contains the returned centre. Nothing is guessed. Polite: one request at a time, a pause between, no retries.
// Seoul and Daejeon are looked up too, as a check that the method returns the known ids.
// Usage: node tools/discover-vworld-sites.mjs   → data/vworld-sites.json (evidence) + src/vworld-stations.js
//        node tools/discover-vworld-sites.mjs 서울역 대전역   → check only, no files written
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ktxCatalog} from '../src/stations.js';

const MAP='https://map.vworld.kr',PAGE=MAP+'/map/dtkmap.do?mode=MAPD100',LIST=MAP+'/dtkmap/indoorServices.do',CDN='https://cdn.vworld.kr/TDServer/services/map4/7Iuk64K0/';
const UA='ya-nerd-station-site-check/1.0 (toolkit.yanerdstation.kr)',PAUSE=1500,wait=ms=>new Promise(r=>setTimeout(r,ms));
const only=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const names=only.length?only:['서울역','대전역',...ktxCatalog.map(c=>c.name).filter(n=>!['서울역','대전역'].includes(n))];
let cookie='';
{const r=await fetch(PAGE,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(20000)});cookie=(r.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');await r.arrayBuffer();}
const findList=v=>{if(Array.isArray(v?.LIST))return v.LIST;if(v&&typeof v==='object')for(const x of Object.values(v)){const f=findList(x);if(f)return f;}return null;};
const floorName=n=>{const s=String(n||'').trim().toUpperCase().replace(/층$/,'F').replace(/^지하\s*(\d+)F?$/,'B$1').replace(/^B(\d+)F$/,'B$1');return /^(B[1-9]\d?|[1-9]\d?F|RF)$/.test(s)?s:(/옥상|ROOF/.test(s)?'RF':null);};
const results=[];
for(const name of names){
 const row={name,query:name};
 try{
  const r=await fetch(LIST,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',Referer:PAGE,...(cookie?{Cookie:cookie}:{})},
   body:new URLSearchParams({type:'3d',pageIndex1:'1',pageUnit:'10',pageSize:'5',q:name}),signal:AbortSignal.timeout(20000)});
  const text=await r.text();row.status=r.status;row.response_sha256=createHash('sha256').update(text).digest('hex');
  const list=findList(JSON.parse(text))||[];
  row.candidates=list.map(x=>({uid:x.uid,kname:x.kname,class:x.class,address:x.ojuso,x:+x.x,y:+x.y,z:+x.z}));
  const exact=list.filter(x=>x.kname===name+'KTX'||x.kname===name),hsr=list.filter(x=>String(x.kname).startsWith(name)&&/고속철도/.test(x.class||''));
  const pick=exact.length===1?exact[0]:(!exact.length&&hsr.length===1?hsr[0]:null);
  if(!pick){row.result=list.length?'ambiguous':'not_found';}
  else{
   const floors=(pick.SUBLIST||[]).map(f=>({raw:f.fname,floor:floorName(f.fname),ord:+f.ord,z:+f.z})).sort((a,b)=>a.ord-b.ord);
   row.match={uid:pick.uid,kname:pick.kname,class:pick.class,address:pick.ojuso,centre:[+pick.x,+pick.y,+pick.z],floors};
   await wait(PAUSE);
   const t=await fetch(CDN+pick.uid+'/tileset.json',{headers:{'User-Agent':UA},signal:AbortSignal.timeout(20000)}),body=await t.text();
   let inside=null;try{const reg=JSON.parse(body.replace(/^﻿/,'')).root?.boundingVolume?.region;if(reg){const [w,s,e,n]=reg.map(v=>v*180/Math.PI),[lon,lat]=row.match.centre,m=.002;inside=lon>=w-m&&lon<=e+m&&lat>=s-m&&lat<=n+m;}}catch{inside=false;}
   row.tileset={status:t.status,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),centre_inside:inside};
   const fl=floors.filter(f=>f.floor&&Number.isFinite(f.z)),unique=new Set(fl.map(f=>f.floor)).size===fl.length;
   row.result=t.status===200&&inside!==false&&fl.length&&unique&&fl.length===floors.length?'verified':'check_needed';
  }
 }catch(e){row.result='error';row.error=e.message;}
 results.push(row);console.log(name.padEnd(8),row.result,row.match?row.match.uid+' '+row.match.kname+' · 층 '+row.match.floors.map(f=>f.floor||('?'+f.raw)).join('/'):'',row.candidates?.length&&!row.match?'· 후보 '+row.candidates.map(c=>c.kname+'('+c.uid+')').join(', '):'');
 await wait(PAUSE);
}
if(only.length){console.log('(이름을 지정한 확인 실행: 파일을 쓰지 않음)');process.exit(0);}
writeFileSync('data/vworld-sites.json',JSON.stringify({fetched_at:new Date().toISOString(),source:'VWorld 웹 지도 실내 목록 '+LIST+' (type=3d, q=역 이름) · 타일셋 '+CDN+'<uid>/tileset.json',rule:'이름이 VWorld 목록과 정확히 일치(○○역KTX)하거나 고속철도 결과가 하나일 때만, 타일셋이 있고 중심이 그 안에 있을 때만 연결',results},null,1)+'\n');
const verified=results.filter(r=>r.result==='verified'&&!['서울역','대전역'].includes(r.name));
const stations=verified.map(r=>{const fl=[...r.match.floors].sort((a,b)=>a.z-b.z),floors=fl.map(f=>f.floor),heights=Object.fromEntries(fl.map(f=>[f.floor,Math.round(f.z*100)/100]));
 return {id:r.match.uid,name:r.name,kname:r.match.kname,status:'available',centre:r.match.centre.map(n=>Math.round(n*1e7)/1e7),floors,heights,default_floor:floors.includes('1F')?'1F':floors[0],source:'vworld-indoor-list'};});
writeFileSync('src/vworld-stations.js','// Generated by tools/discover-vworld-sites.mjs from VWorld\'s indoor-map list (evidence: data/vworld-sites.json).\n// Only exact, tileset-checked matches. Do not edit by hand: re-run the tool.\nexport const VWORLD_STATIONS='+JSON.stringify(stations)+';\n');
const count=k=>results.filter(r=>r.result===k).length;
console.log('\n확인됨 '+count('verified')+' (서울·대전 포함) · 확인 필요 '+count('check_needed')+' · 여러 후보 '+count('ambiguous')+' · 없음 '+count('not_found')+' · 오류 '+count('error')+' → 새로 연결 '+stations.length+'개 역');
const known=results.filter(r=>['서울역','대전역'].includes(r.name)).map(r=>r.name+'='+(r.match?.uid||r.result));console.log('대조: '+known.join(', ')+' (기대값 서울역=S202103, 대전역=S201801)');
