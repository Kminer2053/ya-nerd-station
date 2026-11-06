const CDN='https://cdn.vworld.kr/TDServer/services/map4/7Iuk64K0/';
const abortError=()=>new DOMException('지도 연결이 바뀌었습니다.','AbortError');
export function stationTileSources(station,{hostname='',local=false}={}){
 if(!/^S\d{6}$/.test(station?.id))throw Error('역 지도 ID가 유효하지 않습니다.');
 const sources=[{url:CDN+station.id+'/tileset.json',label:'VWorld',timeout:15000},{url:'/api/map-source/'+station.id+'/tileset.json',label:'지도 연결 경로',timeout:20000}];
 if(station.id==='S201801'&&(local||['127.0.0.1','localhost'].includes(hostname)))sources.unshift({url:'/local-tiles/tileset.json',label:'보관된 대전역 지도',timeout:4000});
 return sources;
}
export function openTileset(C,url,{timeout=15000,signal}={}){
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
  const finish=(error,value)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(value);};
  const cancel=()=>finish(abortError());
  if(signal?.aborted){cancel();return;}
  signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>finish(Error('지도 주소 응답이 지연됩니다.')),timeout);
  Promise.resolve().then(()=>C.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:12,cacheBytes:128*1024*1024,maximumCacheOverflowBytes:32*1024*1024})).then(value=>{
   if(settled){if(!value.isDestroyed?.())value.destroy();return;}finish(null,value);
  },error=>finish(error));
 });
}
// A successful tileset.json response is metadata only. Resolve after a visible
// tile has participated in a completed render, not when fromUrl resolves.
export function firstRenderedTile(viewer,tileset,{timeout=20000,signal}={}){
 return new Promise((resolve,reject)=>{
  let visible=false,lastFailure='',timer,done=false;const removers=[];
  const cleanup=()=>{clearTimeout(timer);for(const remove of removers)remove();signal?.removeEventListener('abort',cancel);};
  const finish=error=>{if(done)return;done=true;cleanup();error?reject(error):resolve();};
  const cancel=()=>finish(abortError());
  if(signal?.aborted){cancel();return;}
  signal?.addEventListener('abort',cancel,{once:true});
  removers.push(tileset.tileVisible.addEventListener(()=>{visible=true;}));
  removers.push(viewer.scene.postRender.addEventListener(()=>{if(visible)finish();}));
  if(tileset.tileFailed)removers.push(tileset.tileFailed.addEventListener(error=>{lastFailure=String(error?.message||'타일을 불러오지 못했습니다.');}));
  timer=setTimeout(()=>finish(Error(lastFailure||'지도 주소는 연결됐지만 첫 실내 모델을 표시하지 못했습니다.')),timeout);
  viewer.scene.requestRender();
 });
}
