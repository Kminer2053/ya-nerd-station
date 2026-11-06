import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {encode,decode} from 'fast-png';
import {checkPng,decodePhoto,encodePhoto} from '../server/work-images.js';
import {imageInfo} from '../server/reports.js';

// Synthetic pixels/chunks only. No user screenshots, metadata or local paths.
const signature=Uint8Array.from([137,80,78,71,13,10,26,10]);
const cat=(...parts)=>new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
function chunk(type,data=new Uint8Array()){
 const payload=cat(new TextEncoder().encode(type),data),out=new Uint8Array(data.length+12),view=new DataView(out.buffer);
 view.setUint32(0,data.length);out.set(payload,4);view.setUint32(out.length-4,crc32(payload));return out;
}
function chunks(bytes){const out=[];for(let at=8;at+12<=bytes.length;){const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at);out.push({type:String.fromCharCode(...bytes.subarray(at+4,at+8)),data:bytes.subarray(at+8,at+8+n),bytes:bytes.subarray(at,at+12+n)});at+=12+n;}return out;}
const pixels=new Uint8Array([20,40,60,255,70,80,90,0,120,130,140,170,180,190,200,255]),base=encode({width:2,height:2,data:pixels,channels:4,depth:8}),parts=chunks(base),header=parts.find(p=>p.type==='IHDR'),end=parts.find(p=>p.type==='IEND'),imageData=parts.filter(p=>p.type==='IDAT'),text=s=>new TextEncoder().encode(s);
const withChunks=(...extra)=>cat(signature,header.bytes,...extra,...imageData.map(p=>p.bytes),end.bytes);
const invalidProfile=cat(text('Display profile\0'),[0,1,2,3,4]),invalidText=cat(text('Comment\0'),[0,1,2,3,4]),invalidInternational=cat(text('Comment\0'),[1,0,0,0,1,2,3,4]);
const metadata=[['iCCP',invalidProfile],['cICP',Uint8Array.from([1,13,0,1])],['eXIf',text('private-fixture-author-location')],['pHYs',new Uint8Array(9)],['iTXt',invalidInternational],['iDOT',new Uint8Array(8)],['tEXt',text('Author\0private-fixture-author-location')],['zTXt',invalidText],['tIME',new Uint8Array(7)]];
const screenshot=withChunks(...metadata.map(([type,data])=>chunk(type,data))),clean=checkPng(screenshot,imageInfo(screenshot));
assert.deepEqual(chunks(clean).map(p=>p.type),['IHDR','pHYs',...imageData.map(p=>p.type),'IEND']);
assert(!Buffer.from(clean).includes(Buffer.from('private-fixture-author-location')));
assert.deepEqual(cat(...chunks(clean).filter(p=>p.type==='IDAT').map(p=>p.data)),cat(...imageData.map(p=>p.data)),'compressed pixel payload stays byte-identical');
const actual=decodePhoto(screenshot,imageInfo(screenshot));assert.equal(actual.width,2);assert.equal(actual.height,2);assert.deepEqual(new Uint8Array(actual.data),pixels,'all pixels and transparency remain unchanged');assert.deepEqual(new Uint8Array(decode(encodePhoto(actual)).data),pixels);
assert.throws(()=>decode(withChunks(chunk('iCCP',invalidProfile)),{checkCrc:true}),'the raw decoder would attempt the invalid compressed profile');
// A compressed profile may expand far beyond the pixel budget; it is discarded
// without parsing/inflating, just like invalid zlib streams in text/profile chunks.
const largeProfile=cat(text('Profile\0'),[0],deflateSync(new Uint8Array(1_000_000).fill(65)));assert.deepEqual(new Uint8Array(decodePhoto(withChunks(chunk('iCCP',largeProfile)),imageInfo(base)).data),pixels);
for(const [type,data] of metadata){const bad=chunk(type,data);bad[bad.length-1]^=1;assert.throws(()=>decodePhoto(withChunks(bad),imageInfo(base)),/CRC/,type+' CRC must be checked even when the metadata is discarded');}
const corrupt=imageData[0].bytes.slice();corrupt[8]^=1;assert.throws(()=>checkPng(cat(signature,header.bytes,corrupt,...imageData.slice(1).map(p=>p.bytes),end.bytes),imageInfo(base)),/CRC/,'IDAT CRC still rejects tampered pixels');
for(const type of ['ABCD','PLTE','tRNS','sBIT','acTL','fcTL','fdAT'])assert.throws(()=>decodePhoto(withChunks(chunk(type)),imageInfo(base)),/지원하지 않는/,type+' is not silently stripped or treated as a supported image format');
assert.throws(()=>decodePhoto(withChunks(header.bytes),imageInfo(base)),/표준/,'duplicate IHDR remains forbidden');
for(const [offset,value] of [[8,16],[9,3],[12,1]]){const modified=header.data.slice();modified[offset]=value;const image=cat(signature,chunk('IHDR',modified),...imageData.map(p=>p.bytes),end.bytes);assert.throws(()=>decodePhoto(image,imageInfo(image)),/표준/,'16-bit, palette and interlaced formats remain unsupported');}
const tiny=encode({width:1,height:1,data:new Uint8Array([1,2,3,255]),channels:4,depth:8}),tinyHeader=chunks(tiny).find(p=>p.type==='IHDR').bytes,bomb=cat(signature,tinyHeader,chunk('IDAT',deflateSync(new Uint8Array(100_000))),end.bytes);assert.throws(()=>decodePhoto(bomb,imageInfo(bomb)),/압축 해제 한도/,'valid-CRC pixel inflate bombs are rejected before image allocation');
const hugeHeader=header.data.slice();new DataView(hugeHeader.buffer).setUint32(0,2049);const huge=cat(signature,chunk('IHDR',hugeHeader),...imageData.map(p=>p.bytes),end.bytes);assert.throws(()=>decodePhoto(huge,imageInfo(huge)),/2048/);assert.throws(()=>checkPng(base,imageInfo(base),base.length-1),/용량/);
const badSignature=base.slice();badSignature[7]=0;assert.throws(()=>decodePhoto(badSignature,imageInfo(base)),/손상/);assert.throws(()=>checkPng(base.subarray(0,base.length-1),imageInfo(base)),/압축|손상/);assert.throws(()=>checkPng(cat(base,[0]),imageInfo(base)),/크기 오류/);
const compressed=cat(...imageData.map(p=>p.data)),middle=Math.floor(compressed.length/2),separated=cat(signature,header.bytes,chunk('IDAT',compressed.subarray(0,middle)),chunk('tEXt',text('Comment\0ignored')),chunk('IDAT',compressed.subarray(middle)),end.bytes);assert.throws(()=>decodePhoto(separated,imageInfo(base)),/순서/,'metadata stripping does not repair an invalid nonconsecutive IDAT stream');
assert.deepEqual(checkPng(base,imageInfo(base)),base);assert.deepEqual(new Uint8Array(decodePhoto(base,imageInfo(base)).data),pixels);
console.log('PASS: screenshot metadata stripped without inflate; unchanged IDAT/RGBA pixels; all chunk CRCs; critical/header/order/format/size and bounded IDAT inflate protections.');
