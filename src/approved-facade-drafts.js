import {approvedImageReference} from './model.js';
const registration=/^REG-[a-f0-9-]{36}$/;
const wrap=angle=>((angle%360)+360)%360;
export function facadeDraftParts(size){const [w,d,h]=size;return [{id:'photo-face',type:'plane',vertices:[[-w/2,-d/2,0],[w/2,-d/2,0],[w/2,-d/2,h],[-w/2,-d/2,h]],texture:'front',uv:[[0,0],[1,0],[1,1],[0,1]]}];}
export function resizeDraftParts(parts,before,after){
 if(!parts)return undefined;const scale=after.map((n,i)=>n/before[i]),triple=p=>p.map((n,i)=>n*scale[i]);
 return parts.map(p=>p.type==='plane'?{...structuredClone(p),vertices:p.vertices.map(triple)}:{...structuredClone(p),offset:triple(p.offset),size:triple(p.size)});
}
// Approved photographs remain immutable. This makes a separate editable plane
// in a personal project; it never supplies a TD_ID or publishes a replacement.
export function importApprovedFacadeDrafts(project,approved,{origin}={}){
 const draft=structuredClone(project),overlays=structuredClone(approved||[]),byId=new Map(draft.assets.map(a=>[a.id,a])),represented=new Set();
 for(const o of overlays){
  const found=byId.get(o.alias);
  if(found){if(!found.approved_facade&&!found.preview_changed)found.facades={...found.facades,front:approvedImageReference(o.image,origin)};represented.add(o.alias);continue;}
  if(!registration.test(o.alias||''))continue;
  const [w,h]=o.surface||[],[x,y,z]=o.position||[];
  if(![w,h,x,y,z,o.heading].every(Number.isFinite)||w<=0||h<=0)throw Error('승인된 사진 면의 위치·규격을 확인하세요.');
  const slot={name:o.name,floor:o.floor,position:[x,y,z],heading:o.heading,surface:[w,h],px:structuredClone(o.px),dimension_basis:o.dimension_basis||null};
  const size=[w,.1,h],asset={id:o.alias,name:o.name,floor:o.floor,position:[x,y,z-h/2],size,heading:wrap(o.heading+180),color:'#c8d4d0',hidden:false,facades:{front:approvedImageReference(o.image,origin)},parts:facadeDraftParts(size),
   approved_facade:{alias:o.alias,slot,image:o.image,at:o.at||null,evidence:o.dimension_evidence||null,uncertainty:o.dimension_uncertainty||null}};
  draft.assets.push(asset);byId.set(asset.id,asset);represented.add(o.alias);
 }
 draft.overlays=overlays.filter(o=>!represented.has(o.alias));return draft;
}
