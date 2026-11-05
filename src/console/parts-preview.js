import {geometryParts,boxPlanes} from '../draft-geometry.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0;
// The same local vertices and UVs as the map, under a fixed orthographic camera.
export function partsMarkup(asset,images={}){
 const faces=geometryParts(asset).flatMap(p=>p.type==='plane'?[p]:boxPlanes({...p,facades:{front:p.facades?.front,left:p.facades?.left,right:p.facades?.right,back:p.facades?.back}}).map(f=>({...f,color:p.color}))),project=([x,y,z])=>[(x-y)*.866,(x+y)*.42-z],all=faces.flatMap(f=>f.vertices.map(project));
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x||1,h=Math.max(...ys)-y||1;
 // The projection null axis is [1,1,.84], looking from above toward the origin.
 const depth=f=>f.vertices.reduce((sum,v)=>sum+v[0]+v[1]+.84*v[2],0)/f.vertices.length;
 const faceList=faces.sort((a,b)=>depth(a)-depth(b));
 const polygons=faceList.map(f=>{
  const points=f.vertices.map(project),url=images[f.texture];
  if(!url)return '<polygon points="'+points.map(p=>p.join(',')).join(' ')+'" fill="'+esc(f.color||asset.color)+'" stroke="#314b50" stroke-width=".015"/>';
  return [[0,1,2],[0,2,3]].map(ids=>{
   const q=ids.map(i=>points[i]),uv=ids.map(i=>[f.uv[i][0],1-f.uv[i][1]]),[a,b,c]=uv,det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);if(Math.abs(det)<1e-8)return '';
   const coeff=values=>{const A=((values[1]-values[0])*(c[1]-a[1])-(values[2]-values[0])*(b[1]-a[1]))/det,B=((b[0]-a[0])*(values[2]-values[0])-(c[0]-a[0])*(values[1]-values[0]))/det;return [A,B,values[0]-A*a[0]-B*a[1]];},[aa,cc,ee]=coeff(q.map(p=>p[0])),[bb,dd,ff]=coeff(q.map(p=>p[1])),id='part-clip-'+(++sequence);
   return '<defs><clipPath id="'+id+'"><polygon points="'+q.map(p=>p.join(',')).join(' ')+'"/></clipPath></defs><g clip-path="url(#'+id+')"><image href="'+esc(url)+'" width="1" height="1" preserveAspectRatio="none" transform="matrix('+[aa,bb,cc,dd,ee,ff].join(' ')+')"/></g>';
  }).join('');
 }).join('');
 return '<svg class="parts-preview" role="img" aria-label="저장된 구성요소와 UV를 사용한 구조물 모형" viewBox="'+[x-.2,y-.2,w+.4,h+.4].join(' ')+'" style="width:100%;height:240px">'+polygons+'</svg><p class="fine model-caption">구성요소 '+asset.parts.length+'개 · '+asset.size.join(' × ')+'m · 사진에 없는 부분과 추정 근거는 확인이 필요합니다.</p>';
}
