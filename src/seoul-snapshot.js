import {stationProject} from './model.js';
import {stations} from './stations.js';
export function adaptSeoulSnapshot(s,base){
 const p=stationProject(stations[0]),r=s.register;
 p.name='서울역 · 확정 설정 전체 / 심사 저장 잠금';p.source='seoul-snapshot';p.revision=s.revision;p.notes='심사 기간에는 열람·임시 편집·JSON 내보내기만 가능합니다. 서버 저장 및 파사드 업로드는 차단됩니다.';
 p.points=s.graph.points.map(v=>({id:v[0],name:v[0],floor:v[1],role:'via',position:v.slice(2,5)}));
 const byId=new Map(p.points.map(p=>[p.id,p]));
 const validation=new Map((s.validation_points||[]).map(v=>[v.review_id,v]));
 for(const id of new Set(r.connections.flatMap(c=>c.path||[]))){if(byId.has(id))continue;const v=validation.get(id);if(v?.geometry?.type==='Point'){const pt={id,name:id,floor:v.floor,role:'via',position:v.geometry.coordinates};p.points.push(pt);byId.set(id,pt);}}
 p.connections=r.connections.map(c=>({...c,point_ids:c.stops?.length?c.stops:[c.from,c.to]}));
 for(const c of p.connections)for(const id of c.point_ids){const pt=byId.get(id);if(pt)pt.role='connection';}
 for(const e of r.endpoints){const area=e.geometry.type==='Polygon'?e.geometry.coordinates[0]:null,position=byId.get(e.access_id)?.position||area?.[0]||e.geometry.coordinates;
   const pt={...e,role:'origin',position,...(area?{area}:{} )};p.points.push(pt);byId.set(pt.id,pt);
 }
 const vp=new Map((s.validation_points||[]).map(v=>[v.review_id,v]));
 const registered=new Map(s.catalog.facilities.map(f=>[f.id,f]));
 p.facilities=r.facilities.map(f=>{const c=registered.get(f.id),ref=c?.reference,pos=c?.access||(ref?[ref.lon,ref.lat,ref.height]:vp.get(f.source_id)?.geometry?.coordinates);return {...f,...c,position:Array.isArray(pos)&&typeof pos[0]==='number'?pos:null};});
 for(const f of p.facilities.filter(f=>f.active&&f.position))p.points.push({id:'FACILITY:'+f.id,name:f.name,floor:f.floor,role:'facility',position:f.position,facility_id:f.id});
 p.routes=r.routes.map(v=>({...v,point_ids:[v.from,...v.steps.flatMap(step=>step.kind==='connection'?[step.from,step.to]:[step.point_id]),v.to].filter((id,i,a)=>byId.has(id)&&id!==a[i-1]),raw_point_ids:v.generation?.raw_point_ids}));
 p.assets=s.facades.replacements.map(f=>({id:f.slot.slot_alias,name:(f.current_store_name||f.slot.object_label)+' · '+f.slot.slot_alias,floor:f.slot.floor,position:[f.slot.longitude,f.slot.latitude,f.slot.height_m],size:[f.slot.surface_width_m||3,.1,f.slot.surface_height_m||3],heading:f.slot.camera_heading_deg||0,color:'#73a194',hidden:false,source_id:f.slot.td_id||f.slot.target_asset_id,source_record:true,facades:{front:new URL(f.image_url,base).href},original:f}));
 p.origins=r.origins;p.observations=s.methodology.daily.map((v,i)=>({id:'DAILY:'+i,origin_id:v.origin_id,name:v.origin_name+' · '+v.service_date,date:v.service_date,hour:null,arrivals:Number(v.arrivals||0),departures:Number(v.departures||0),value_class:/OBSERVED/i.test(v.value_class)?'observed':'estimated',method:'확정 가공 데이터 · '+v.value_class+' / 상세 산출 기준은 원점 자료 참조',original:v}));
 p.changes=s.model_configurations||[];p.source_register=r;p.methodology=s.methodology;p.geometry_notes='시설의 reference와 보행 access를 구분합니다. 미등록 위치는 임의로 생성하지 않습니다.';
 // Retain observed heights for each floor instead of using nominal station heights.
 p.station.floors=[...new Set(p.points.map(v=>v.floor))];
 for(const f of p.station.floors){const z=p.points.filter(v=>v.floor===f&&v.id.startsWith('GRID-')).map(v=>v.position[2]).sort((a,b)=>a-b);if(z.length)p.station.heights[f]=z[Math.floor(z.length/2)];}
 return p;
}
