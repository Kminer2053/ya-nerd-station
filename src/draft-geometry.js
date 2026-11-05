// A bounded, declarative model. Local metres: x right, y back, z above the floor.
export const IMAGE_LIMITS={edge:4096,pixels:4_194_304,bytes:4_800_000};
export const validPixels=px=>Array.isArray(px)&&px.length===2&&px.every(n=>Number.isInteger(n)&&n>0&&n<=IMAGE_LIMITS.edge)&&px[0]*px[1]<=IMAGE_LIMITS.pixels;
const triple=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const allowed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const surfaces=['front','left','right','back'];
export function validateParts(parts,size){
 if(parts===undefined)return undefined;
 if(!Array.isArray(parts)||!parts.length||parts.length>32)throw Error('구조물 구성요소는 1~32개입니다.');
 const ids=new Set(),within=p=>triple(p)&&Math.abs(p[0])<=size[0]/2+.01&&Math.abs(p[1])<=size[1]/2+.01&&p[2]>=-.01&&p[2]<=size[2]+.01;
 return parts.map(p=>{
  if(!allowed(p,['id','type','offset','size','color','facades','vertices','texture','uv'])||!/^[-\w]{1,60}$/.test(p.id||'')||ids.has(p.id))throw Error('구성요소 ID·필드를 확인하세요.');ids.add(p.id);
  if(p.type==='box'){
   if(!triple(p.offset)||!triple(p.size)||p.size.some(n=>n<.01||n>30)||!/^#[\da-fA-F]{6}$/.test(p.color||'#c8cbcb'))throw Error('상자 구성요소의 크기·색을 확인하세요.');
   if(!within([p.offset[0]-p.size[0]/2,p.offset[1]-p.size[1]/2,p.offset[2]])||!within([p.offset[0]+p.size[0]/2,p.offset[1]+p.size[1]/2,p.offset[2]+p.size[2]]))throw Error('구성요소가 구조물 전체 크기를 벗어납니다.');
   if(p.facades!==undefined&&(!allowed(p.facades,surfaces)||Object.values(p.facades).some(s=>!surfaces.includes(s))))throw Error('상자 텍스처는 등록된 면을 사용하세요.');
   return {id:p.id,type:'box',offset:p.offset,size:p.size,color:p.color||'#c8cbcb',facades:p.facades||{}};
  }
  if(p.type!=='plane'||!Array.isArray(p.vertices)||p.vertices.length!==4||!p.vertices.every(within)||!surfaces.includes(p.texture)||!Array.isArray(p.uv)||p.uv.length!==4||p.uv.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error('평면의 네 정점·UV·텍스처를 확인하세요.');
  for(const [i,j,k] of [[0,1,2],[0,2,3]]){const [a,b,c]=[p.uv[i],p.uv[j],p.uv[k]];if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))<=1e-8)throw Error('UV 두 삼각형은 각각 면적이 있어야 합니다.');}
  const [a,b,c,d]=p.vertices,sub=(x,y)=>x.map((n,i)=>n-y[i]),cross=(x,y)=>[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],dot=(x,y)=>x.reduce((s,n,i)=>s+n*y[i],0),n=cross(sub(b,a),sub(c,a)),len=Math.hypot(...n);
  if(len<1e-5||Math.abs(dot(n,sub(d,a)))/len>.01||p.vertices.some((v,i)=>dot(cross(sub(p.vertices[(i+1)%4],v),sub(p.vertices[(i+2)%4],p.vertices[(i+1)%4])),n)<=1e-8))throw Error('평면은 같은 평면의 볼록 사각형이어야 합니다.');
  return {id:p.id,type:'plane',vertices:p.vertices,texture:p.texture,uv:p.uv};
 });
}
export function geometryParts(asset){return asset.parts||[{id:'body',type:'box',offset:[0,0,0],size:asset.size,color:asset.color,facades:Object.fromEntries(Object.keys(asset.facades||{}).map(s=>[s,s]))}];}
export function boxPlanes(part){
 const [w,d,h]=part.size,[x,y,z]=part.offset,points={front:[[-w/2,-d/2,0],[w/2,-d/2,0],[w/2,-d/2,h],[-w/2,-d/2,h]],right:[[w/2,-d/2,0],[w/2,d/2,0],[w/2,d/2,h],[w/2,-d/2,h]],back:[[w/2,d/2,0],[-w/2,d/2,0],[-w/2,d/2,h],[w/2,d/2,h]],left:[[-w/2,d/2,0],[-w/2,-d/2,0],[-w/2,-d/2,h],[-w/2,d/2,h]]};
 return Object.entries(part.facades||{}).map(([side,texture])=>({id:part.id+'-'+side,type:'plane',texture,vertices:points[side].map(p=>[p[0]+x,p[1]+y,p[2]+z]),uv:[[0,0],[1,0],[1,1],[0,1]]}));
}
