// Import facades approved elsewhere (a manifest from service/tools/export-supabase-facades.mjs) into this editor through
// the approver-only POST /api/console/import-facade. Safe to re-run: the server skips a source id it already has.
// Approver: APPROVER_NAME / APPROVER_PASSWORD, or for a local base the generated data-private/local-approvers.txt.
// Usage: node tools/import-facades.mjs <manifest-dir> [base-url=http://127.0.0.1:4197]
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';

const [dir,base='http://127.0.0.1:4197']=process.argv.slice(2);
if(!dir)throw Error('사용법: node tools/import-facades.mjs <manifest-dir> [base-url]');
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
let name=process.env.APPROVER_NAME,password=process.env.APPROVER_PASSWORD;
if(!name&&/^http:\/\/(127\.0\.0\.1|localhost)/.test(base)&&existsSync('data-private/local-approvers.txt'))[name,password]=readFileSync('data-private/local-approvers.txt','utf8').trim().split(/:(.*)/s);
if(!name||!password)throw Error('APPROVER_NAME, APPROVER_PASSWORD를 설정하세요.');
const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
const login=await post('/api/console/login',{name,password});if(!login.ok)throw Error('승인자 로그인 실패: '+(await login.json()).error);
const cookie=login.headers.get('set-cookie').split(';')[0],result={imported:0,skipped:0,failed:[]};
for(const item of manifest.items){
 const mime=extname(item.file).toLowerCase()==='.jpg'?'image/jpeg':'image/png',image='data:'+mime+';base64,'+readFileSync(join(dir,item.file)).toString('base64');
 const r=await post('/api/console/import-facade',{station_key:manifest.site,slot:item.slot,image,source:item.source},cookie),v=await r.json().catch(()=>({}));
 if(r.ok)v.skipped?result.skipped++:result.imported++;else result.failed.push(item.slot.alias+': '+(v.error||r.status));
}
await post('/api/console/logout',{},cookie);
console.log(manifest.site+' → '+base+': 가져옴 '+result.imported+' · 이미 있음 '+result.skipped+' · 실패 '+result.failed.length+(result.failed.length?'\n'+result.failed.join('\n'):''));
