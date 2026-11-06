const privatePath=/^\/api\/(?:files\/[a-f0-9-]{36}|console\/proposal-images\/[a-f0-9-]{36}(?:\/(?:front|left|right|back))?)$/;
const blobDataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('초안 사진을 읽지 못했습니다.'));reader.readAsDataURL(blob);});
export function createPreviewImages({origin,fetcher=fetch,encode=blobDataURL,maxBytes=32_000_000,timeout=15000}={}){
 const cache=new Map();let cachedBytes=0,generation=0;
 const ownPrivate=value=>{if(typeof value!=='string')return null;try{const u=new URL(value,origin);return u.origin===origin&&!u.search&&!u.hash&&privatePath.test(u.pathname)?u.pathname:null;}catch{return null;}};
 return {
  async prepare(project,floor,{signal}={}){
   const version=generation,check=()=>{if(signal?.aborted||version!==generation)throw new DOMException('미리보기가 바뀌었습니다.','AbortError');};check();
   const active=new Set();for(const a of project.assets||[])if(a.floor===floor&&!a.hidden)for(const value of Object.values(a.facades||{})){const key=ownPrivate(value);if(key)active.add(key);}
   for(const o of project.overlays||[])if(o.floor===floor){const key=ownPrivate(o.image);if(key)active.add(key);}
   let total=0;const images=new Map();
   for(const key of active){
    check();
    let item=cache.get(key);
    if(!item){const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,timeout);let blob;
     try{const response=await fetcher(key,{credentials:'same-origin',redirect:'error',signal:controller.signal});if(!response.ok)throw Error('초안 사진을 불러오지 못했습니다. 로그인 상태를 확인하세요.');blob=await response.blob();}
     catch(error){check();if(controller.signal.aborted)throw Error('초안 사진 응답이 지연됩니다. 다시 연결해 주세요.');throw error;}
     finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}check();
     if(!['image/png','image/jpeg'].includes(blob.type)||blob.size>6_000_000)throw Error('미리보기 사진의 형식이나 크기를 확인하세요.');
     if(total+blob.size>maxBytes)throw Error('한 층에 표시할 사진이 많습니다. 사진 크기를 줄여 다시 확인하세요.');
     item={value:await encode(blob),bytes:blob.size};check();
     while(cachedBytes+item.bytes>maxBytes&&cache.size){const [old,entry]=cache.entries().next().value;cache.delete(old);cachedBytes-=entry.bytes;}
     cache.set(key,item);cachedBytes+=item.bytes;
    }else{cache.delete(key);cache.set(key,item);}
    total+=item.bytes;if(total>maxBytes)throw Error('한 층에 표시할 사진이 많습니다. 사진 크기를 줄여 다시 확인하세요.');images.set(key,item.value);
   }
   const image=value=>{const key=ownPrivate(value);return key?images.get(key):value;};
   return {...project,assets:(project.assets||[]).map(a=>({...a,facades:Object.fromEntries(Object.entries(a.facades||{}).map(([side,url])=>[side,image(url)]).filter(([,url])=>url))})),
    overlays:(project.overlays||[]).map(o=>({...o,image:image(o.image)})).filter(o=>o.image)};
  },
  clear(){generation++;cache.clear();cachedBytes=0;},
 };
}
