import {validPixels,IMAGE_LIMITS} from '../src/draft-geometry.js';
import jpeg from 'jpeg-js';
import {decode,encode} from 'fast-png';
import {Unzlib} from 'fflate';
import {warp,autoLevels,mapBox,pixelate} from '../src/rectify.js';
import {validQuad,validBox} from './work-plan.js';
const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];
// Screenshot profiles/text are not needed for pixel processing. Never inflate
// them: even a small iCCP/zTXt/iTXt chunk can contain an unbounded payload.
const PNG_METADATA=new Set(['iCCP','cICP','eXIf','iTXt','iDOT','tEXt','zTXt','tIME']);
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const pngCrc=(bytes,start,end)=>{let c=0xffffffff;for(let i=start;i<end;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;};
// Validate every chunk, including discarded metadata, and bound pixel inflate
// before the PNG decoder allocates. Pixel-affecting unsupported formats stay rejected.
export function checkPng(bytes,info,maxBytes=4_000_000){
 if(bytes.length>maxBytes||!PNG_SIGNATURE.every((b,i)=>bytes[i]===b))throw Error('손상되었거나 용량을 초과한 PNG입니다. JPEG로 다시 올려 주세요.');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),kept=[bytes.subarray(0,8)];let at=8,ihdr=false,idat=false,idatEnded=false,end=false,raw=0,expected=0,decoder=null,length=8,removed=false;
 while(at+12<=bytes.length){
  const n=d.getUint32(at),type=String.fromCharCode(...bytes.subarray(at+4,at+8));if(n>maxBytes||at+12+n>bytes.length)throw Error('손상된 PNG입니다. JPEG로 다시 올려 주세요.');
  if(!/^[A-Za-z]{4}$/.test(type)||pngCrc(bytes,at+4,at+8+n)!==d.getUint32(at+8+n))throw Error('PNG 청크 CRC 또는 형식 오류입니다. JPEG로 다시 올려 주세요.');
  const data=bytes.subarray(at+8,at+8+n);
  if(type==='IHDR'){
   if(ihdr||at!==8||n!==13||d.getUint32(at+8)!==info.width||d.getUint32(at+12)!==info.height||data[8]!==8||![0,2,4,6].includes(data[9])||data[10]||data[11]||data[12])throw Error('표준 8비트 사진 PNG 또는 JPEG를 사용하세요.');
   ihdr=true;const channels={0:1,2:3,4:2,6:4}[data[9]];expected=(info.width*channels+1)*info.height;
   decoder=new Unzlib(chunk=>{raw+=chunk.length;if(raw>expected)throw Error('PNG 압축 해제 한도 초과. JPEG로 다시 올려 주세요.');});
  }else if(type==='IDAT'){
   if(!ihdr||end||idatEnded)throw Error('PNG 순서 오류');idat=true;
   // Feeding bounded compressed chunks also bounds each temporary inflate allocation.
   for(let i=0;i<data.length;i+=512)decoder.push(data.subarray(i,i+512),false);
  }else if(type==='IEND'){if(n||!idat)throw Error('PNG 끝 정보 오류');decoder.push(new Uint8Array(),true);end=true;kept.push(bytes.subarray(at,at+12));length+=12;at+=12;break;}
  else{
   if(!ihdr)throw Error('PNG 순서 오류');if(idat)idatEnded=true;
   if(PNG_METADATA.has(type)){removed=true;at+=12+n;continue;}
   if(!['sRGB','gAMA','cHRM','pHYs'].includes(type))throw Error('지원하지 않는 PNG 형식입니다. 8비트 사진 PNG 또는 JPEG로 다시 올려 주세요.');
  }
  kept.push(bytes.subarray(at,at+12+n));length+=12+n;
  at+=12+n;
 }
 if(!end||at!==bytes.length||raw!==expected)throw Error('PNG 압축 또는 사진 크기 오류');
 if(!removed)return bytes;
 const clean=new Uint8Array(length);let offset=0;for(const part of kept){clean.set(part,offset);offset+=part.length;}return clean;
}
// Bound before decompression, then process each photo separately. Originals never leave private R2.
export function decodePhoto(bytes,info,{artifact=false}={}){
 if(!info?.width||!info.height||(artifact?!validPixels([info.width,info.height]):info.width>2048||info.height>2048||info.width*info.height>4_194_304))throw Error('사진을 긴 변 2048px 이하로 줄여 다시 올려 주세요.');
 if(info.mime==='image/jpeg')return jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:4.2,maxMemoryUsageInMB:48,tolerantDecoding:false});
 const clean=checkPng(bytes,info,artifact?IMAGE_LIMITS.bytes:4_000_000),im=decode(clean,{checkCrc:true});if(im.depth!==8||im.palette)throw Error('8비트 RGB 사진을 JPEG 또는 PNG로 다시 올려 주세요.');
 if(im.channels===4)return {width:im.width,height:im.height,data:new Uint8ClampedArray(im.data.buffer,im.data.byteOffset,im.data.byteLength)};
 const data=new Uint8ClampedArray(im.width*im.height*4);
 for(let i=0,j=0;i<data.length;i+=4,j+=im.channels){const c=im.channels;data[i]=im.data[j];data[i+1]=c<3?im.data[j]:im.data[j+1];data[i+2]=c<3?im.data[j]:im.data[j+2];data[i+3]=c===2?im.data[j+1]:c===4?im.data[j+3]:255;}
 return {width:im.width,height:im.height,data};
}
export function encodePhoto(im){return encode({width:im.width,height:im.height,data:im.data,depth:8,channels:4});}
export function aiThumbnail(src){
 const k=Math.min(1,640/Math.max(src.width,src.height)),w=Math.max(1,Math.round(src.width*k)),h=Math.max(1,Math.round(src.height*k)),data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(Math.min(src.height-1,Math.floor(y/k))*src.width+Math.min(src.width-1,Math.floor(x/k)))*4;data.set(src.data.subarray(i,i+4),(y*w+x)*4);}
 return encodePhoto({width:w,height:h,data});
}
export function rectifyFace(src,face,px){
 if(!validQuad(face.quad)||!face.people.every(validBox)||!validPixels(px))throw Error('보정 범위가 유효하지 않습니다.');
 const q=face.quad.map(([x,y])=>[x*(src.width-1),y*(src.height-1)]),masked={...src,data:new Uint8ClampedArray(src.data)};
 // Mask before homography: a person's bbox may cross the perspective horizon outside the face.
 // Mapping just its four corners could otherwise put the mask entirely outside the output.
 for(const b of face.people)pixelate(masked,[b[0]*src.width,b[1]*src.height,b[2]*src.width,b[3]*src.height],Math.max(16,Math.round(Math.max(src.width,src.height)/28)));
 const im=autoLevels(warp(masked,q,...px)),blurs=face.people.map(b=>{
  const box=mapBox(q,...px,[b[0]*src.width,b[1]*src.height,b[2]*src.width,b[3]*src.height]);
  return box.every(Number.isFinite)&&box[2]>0&&box[3]>0&&box[0]<px[0]&&box[1]<px[1]&&box[0]+box[2]>0&&box[1]+box[3]>0?box:[0,0,...px];
 });
 return {bytes:encodePhoto(im),quad:q,blurs,mime:'image/png',px};
}
