// Facade rectification without generating pixels: the storefront quad in a photo is mapped by a homography onto
// the slot's pixel grid (e.g. 175×176), sampled with area averaging, levelled and, where people are, pixelated.
// Images are {width,height,data:Uint8ClampedArray RGBA}; quads are [TL,TR,BR,BL] in pixel coordinates.

// 3×3 homography H (row-major, H[8]=1) mapping the 4 src points onto the 4 dst points.
export function homography(src,dst){
 const A=[],b=[];
 for(let i=0;i<4;i++){const [x,y]=src[i],[u,v]=dst[i];
  A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
  A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}
 const h=solve(A,b);if(!h)throw Error('네 모서리가 한 줄에 놓였어요. 모서리를 다시 잡아 주세요.');
 return [...h,1];
}
function solve(A,b){
 const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
 for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];
  for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];if(f)for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}
 return M.map((r,i)=>r[n]/r[i]);
}
export const applyH=(H,[x,y])=>{const w=H[6]*x+H[7]*y+H[8];return [(H[0]*x+H[1]*y+H[2])/w,(H[3]*x+H[4]*y+H[5])/w];};

// Quad in the photo → out grid. Supersamples when the quad is much larger than the output (no moiré on signs).
export function warp(src,quad,ow,oh){
 const H=homography([[0,0],[ow,0],[ow,oh],[0,oh]],quad),out=new Uint8ClampedArray(ow*oh*4),{width:sw,height:sh,data:sd}=src;
 const span=Math.max(Math.hypot(quad[1][0]-quad[0][0],quad[1][1]-quad[0][1])/ow,Math.hypot(quad[3][0]-quad[0][0],quad[3][1]-quad[0][1])/oh);
 const ss=Math.max(1,Math.min(4,Math.round(span))),acc=[0,0,0,0];
 const sample=(x,y)=>{x=Math.min(sw-1,Math.max(0,x-.5));y=Math.min(sh-1,Math.max(0,y-.5));const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=x-x0,fy=y-y0;
  for(let c=0;c<4;c++){const a=sd[(y0*sw+x0)*4+c],b2=sd[(y0*sw+x1)*4+c],c2=sd[(y1*sw+x0)*4+c],d=sd[(y1*sw+x1)*4+c];acc[c]+=(a*(1-fx)+b2*fx)*(1-fy)+(c2*(1-fx)+d*fx)*fy;}};
 for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){acc.fill(0);
  for(let j=0;j<ss;j++)for(let i=0;i<ss;i++){const [u,v]=applyH(H,[x+(i+.5)/ss,y+(j+.5)/ss]);sample(u,v);}
  const o=(y*ow+x)*4,n=ss*ss;for(let c=0;c<4;c++)out[o+c]=acc[c]/n;}
 return {width:ow,height:oh,data:out};
}

// Per-channel stretch between the clip and 1-clip percentiles (dim station light → readable colours).
export function autoLevels(img,clip=.005){
 const {data}=img,n=data.length/4,out=new Uint8ClampedArray(data);
 for(let c=0;c<3;c++){const hist=new Uint32Array(256);for(let i=0;i<n;i++)hist[data[i*4+c]]++;
  let lo=0,hi=255,s=0;while(lo<255&&s+hist[lo]<=n*clip)s+=hist[lo++];s=0;while(hi>0&&s+hist[hi]<=n*clip)s+=hist[hi--];
  if(hi-lo<16)continue;for(let i=0;i<n;i++)out[i*4+c]=(data[i*4+c]-lo)*255/(hi-lo);}
 return {width:img.width,height:img.height,data:out};
}

// Pixelate a box (people, screens) in place. box = [x,y,w,h] in output pixels.
export function pixelate(img,[bx,by,bw,bh],block=Math.max(4,Math.round(Math.min(img.width,img.height)/24))){
 const {width:w,height:h,data}=img,x0=Math.max(0,Math.floor(bx)),y0=Math.max(0,Math.floor(by)),x1=Math.min(w,Math.ceil(bx+bw)),y1=Math.min(h,Math.ceil(by+bh));
 for(let y=y0;y<y1;y+=block)for(let x=x0;x<x1;x+=block){const ye=Math.min(y1,y+block),xe=Math.min(x1,x+block),sum=[0,0,0,0];let k=0;
  for(let yy=y;yy<ye;yy++)for(let xx=x;xx<xe;xx++){const o=(yy*w+xx)*4;for(let c=0;c<4;c++)sum[c]+=data[o+c];k++;}
  for(let yy=y;yy<ye;yy++)for(let xx=x;xx<xe;xx++){const o=(yy*w+xx)*4;for(let c=0;c<4;c++)data[o+c]=sum[c]/k;}}
 return img;
}

// Starting quad: the slot's aspect ratio, centred, 70% of the photo — the ambassador (or the AI) moves the corners.
export function defaultQuad(w,h,aspect){
 let qw=w*.7,qh=qw/aspect;if(qh>h*.7){qh=h*.7;qw=qh*aspect;}
 const x=(w-qw)/2,y=(h-qh)/2;return [[x,y],[x+qw,y],[x+qw,y+qh],[x,y+qh]];
}
// A box given in photo pixels, carried onto the output grid through the same homography (for AI people boxes).
export function mapBox(quad,ow,oh,[x,y,w,h]){
 const H=homography(quad,[[0,0],[ow,0],[ow,oh],[0,oh]]),pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>applyH(H,p));
 const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];
}
