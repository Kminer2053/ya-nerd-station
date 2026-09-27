// Daejeon (S201801) facility candidates: the reviewed list (data/daejeon-candidates.review.json) joined with the VWorld
// texture slots of the Daejeon 3D tiles (outputs/20260902_vworld_daejeon_image_catalog/object-texture-slots.json, not in
// this repository) → src/daejeon-candidates.js. Names are sign readings from the texture photos, never guesses; unnamed
// storefronts stay unnamed. Run: node tools/build-daejeon-candidates.mjs [path/to/object-texture-slots.json]
import {readFileSync,writeFileSync} from 'node:fs';
import {stations} from '../src/stations.js';

const slotsFile=process.argv[2]||'../outputs/20260902_vworld_daejeon_image_catalog/object-texture-slots.json';
const review=JSON.parse(readFileSync('data/daejeon-candidates.review.json','utf8'));
const all=JSON.parse(readFileSync(slotsFile,'utf8')).filter(s=>s.site_id==='S201801'&&s.is_active!==false),byAlias=new Map(all.map(s=>[s.slot_alias,s]));
const st=stations.find(s=>s.id==='S201801'),floors=st.floors,heights=st.heights,LAT=111320,LON=LAT*Math.cos(st.centre[1]*Math.PI/180);
const round=(n,d=7)=>Math.round(n*10**d)/10**d;
// The model's floor tag, unless the surface sits well below that floor (escalators tagged 3F at 56–58 m): then by height.
function floorOf(s){const tagged=floors.includes(s.floor)?s.floor:null;if(tagged&&s.height_m>=heights[tagged]-1)return tagged;return [...floors].reverse().find(f=>heights[f]<=s.height_m+.5)||floors[0];}
// A walkable point in front of the surface (normal = camera_heading_deg, where a viewer stands), on the floor plane.
function access(s,floor,metres){const h=s.camera_heading_deg*Math.PI/180;return [round(s.longitude+Math.sin(h)*metres/LON),round(s.latitude+Math.cos(h)*metres/LAT),heights[floor]];}
function surface(s){const aspect=Math.max(.05,Math.min(24,s.crop_width_px/s.crop_height_px)),area=Math.max(.01,s.surface_area_m2);return [Math.round(Math.sqrt(area*aspect)*100)/100,Math.round(Math.sqrt(area/aspect)*100)/100];}
const need=a=>{const s=byAlias.get(a);if(!s)throw Error('슬롯이 없습니다: '+a);return s;};
const facilities=[],slots=[];
for(const e of review.stores){const main=need(e.slots[0]);e.slots.slice(1).forEach(need);const floor=floorOf(main);
 const name=e.name||floor+' 매장 후보 ('+main.slot_alias+')';
 facilities.push({id:e.id,kind:'store',name,named:Boolean(e.name),sign_text:e.sign_text||null,category:e.category,floor,position:access(main,floor,1.5),slots:e.slots,basis:e.basis,certainty:e.certainty,verified:false});
 slots.push({alias:main.slot_alias,name,facility_id:e.id,floor,position:[round(main.longitude),round(main.latitude),Math.round(main.height_m*1000)/1000],heading:Math.round(main.camera_heading_deg*1000)/1000,px:[main.crop_width_px,main.crop_height_px],surface:surface(main),image:null,model:main.model_name,td_id:main.td_id});}
for(const e of review.facilities){const main=need(e.slots[0]);e.slots.slice(1).forEach(need);const floor=floorOf(main);
 facilities.push({id:e.id,kind:'facility',name:e.name,named:true,sign_text:null,category:e.category,floor,position:access(main,floor,1),slots:e.slots,basis:e.basis,certainty:e.certainty,verified:false});}
// Groups (escalators, direction signs, platform signs): every slot of the listed models, clustered per floor by distance.
// by:'model' first merges each model's slots into one unit at their centroid (an escalator is one object, many slots).
function units(g,members){if(g.by!=='model')return members;const m=new Map();for(const s of members){(m.get(s.model_name)||m.set(s.model_name,[]).get(s.model_name)).push(s);}
 return [...m.values()].map(list=>{const n=list.length,avg=k=>list.reduce((t,s)=>t+s[k],0)/n;return {...list[0],slot_alias:list[0].slot_alias,longitude:avg('longitude'),latitude:avg('latitude'),height_m:avg('height_m'),aliases:list.map(s=>s.slot_alias)};});}
for(const g of review.groups){const members=units(g,all.filter(s=>g.models.includes(s.model_name)&&!(g.exclude_slots||[]).includes(s.slot_alias)));const clusters=[];
 for(const s of members.sort((a,b)=>a.longitude-b.longitude)){const floor=floorOf(s),x=(s.longitude-st.centre[0])*LON,y=(s.latitude-st.centre[1])*LAT;
  const c=clusters.find(c=>c.floor===floor&&Math.hypot(c.x-x,c.y-y)<=g.radius_m);
  if(c){c.items.push(s);c.x=(c.x*(c.items.length-1)+x)/c.items.length;c.y=(c.y*(c.items.length-1)+y)/c.items.length;}else clusters.push({floor,x,y,items:[s]});}
 clusters.sort((a,b)=>floors.indexOf(a.floor)-floors.indexOf(b.floor)||a.x-b.x).forEach((c,i)=>facilities.push({id:g.id+'-'+String(i+1).padStart(2,'0'),kind:'group',name:g.name,named:true,sign_text:null,category:g.category,floor:c.floor,
  position:[round(st.centre[0]+c.x/LON),round(st.centre[1]+c.y/LAT),heights[c.floor]],slots:c.items.flatMap(s=>s.aliases||[s.slot_alias]),basis:g.basis,certainty:g.certainty,verified:false}));}
const out={site_id:'S201801',source:review.source,reviewed_at:review.reviewed_at,method:review.method,notice:'대전역 시설 이름은 VWorld 3D 지도 사진 속 간판을 읽어 만든 후보예요. 현장과 다르면 제보해 주세요.',facilities,slots};
writeFileSync('src/daejeon-candidates.js','// Generated by tools/build-daejeon-candidates.mjs from data/daejeon-candidates.review.json and the VWorld texture slots.\n// Do not edit by hand: change the review file and rebuild.\nexport const DAEJEON_CANDIDATES='+JSON.stringify(out)+';\n');
const count=k=>facilities.filter(f=>f.kind===k).length,byFloor={};for(const f of facilities)byFloor[f.floor]=(byFloor[f.floor]||0)+1;
console.log('stores',count('store'),'(named',facilities.filter(f=>f.kind==='store'&&f.named).length+') · facilities',count('facility'),'· grouped',count('group'),'· facade slots',slots.length,'· by floor',JSON.stringify(byFloor));
