import jpeg from 'jpeg-js';
import {decode,encode} from 'fast-png';
import {Unzlib} from 'fflate';
import {warp,autoLevels,mapBox,pixelate} from '../src/rectify.js';
import {validQuad,validBox} from './work-plan.js';
// Reject duplicate headers, ancillary compressed profiles and inflate bombs before the PNG decoder allocates.
export function checkPng(bytes,info){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=8,ihdr=false,idat=false,end=false,raw=0,expected=0,decoder=null;
 while(at+12<=bytes.length){
  const n=d.getUint32(at),type=String.fromCharCode(...bytes.subarray(at+4,at+8));if(n>4_000_000||at+12+n>bytes.length)throw Error('손상된 PNG입니다. JPEG로 다시 올려 주세요.');
  const data=bytes.subarray(at+8,at+8+n);
  if(type==='IHDR'){
   if(ihdr||at!==8||n!==13||d.getUint32(at+8)!==info.width||d.getUint32(at+12)!==info.height||data[8]!==8||![0,2,4,6].includes(data[9])||data[10]||data[11]||data[12])throw Error('표준 8비트 사진 PNG 또는 JPEG를 사용하세요.');
   ihdr=true;const channels={0:1,2:3,4:2,6:4}[data[9]];expected=(info.width*channels+1)*info.height;
   decoder=new Unzlib(chunk=>{raw+=chunk.length;if(raw>expected)throw Error('PNG 압축 해제 한도 초과. JPEG로 다시 올려 주세요.');});
  }else if(type==='IDAT'){
   if(!ihdr||end)throw Error('PNG 순서 오류');idat=true;
   // Feeding bounded compressed chunks also bounds each temporary inflate allocation.
   for(let i=0;i<data.length;i+=512)decoder.push(data.subarray(i,i+512),false);
  }else if(type==='IEND'){if(n||!idat)throw Error('PNG 끝 정보 오류');decoder.push(new Uint8Array(),true);end=true;at+=12;break;}
  else if(!['sRGB','gAMA','cHRM','pHYs'].includes(type))throw Error('압축 메타데이터가 없는 사진 PNG 또는 JPEG로 다시 올려 주세요.');
  at+=12+n;
 }
 if(!end||at!==bytes.length||raw!==expected)throw Error('PNG 압축 또는 사진 크기 오류');
}
// Bound before decompression, then process each photo separately. Originals never leave private R2.
export function decodePhoto(bytes,info){
 if(!info?.width||!info.height||info.width>2048||info.height>2048||info.width*info.height>4_194_304)throw Error('사진을 긴 변 2048px 이하로 줄여 다시 올려 주세요.');
 if(info.mime==='image/jpeg')return jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:4.2,maxMemoryUsageInMB:48,tolerantDecoding:false});
 checkPng(bytes,info);const im=decode(bytes,{checkCrc:true});if(im.depth!==8||im.palette)throw Error('8비트 RGB 사진을 JPEG 또는 PNG로 다시 올려 주세요.');
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
 if(!validQuad(face.quad)||!face.people.every(validBox)||!Array.isArray(px)||px.some(n=>!Number.isInteger(n)||n<1||n>1024))throw Error('보정 범위가 유효하지 않습니다.');
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
