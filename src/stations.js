// Verified connection descriptors, not a fabricated list of 40 station names.
// The editor accepts the same descriptor for every station; no station-specific UI.
export const stations=[
 {id:'S202103',name:'서울역',status:'jury-locked',centre:[126.9708218,37.55363,36.19],floors:['B7','B6','B5','B4','B3','B2','B1','1F','2F','3F'],heights:{B7:-20.39,B6:-15.8,B5:-11.2,B4:-6.5,B3:5.3,B2:15.2,B1:22.2,'1F':27.2,'2F':36.19,'3F':43.2},default_floor:'2F'},
 {id:'S201801',name:'대전역',status:'available',centre:[127.43459,36.33223,60.34],floors:['1F','2F','3F','4F','5F','RF'],heights:{'1F':55.69,'2F':60.34,'3F':63.48,'4F':68.37,'5F':71.66,RF:74.33},default_floor:'3F'},
];
export const seoulOrigin=()=>['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:4196':location.hostname.endsWith('yanerdstation.kr')?'https://seoul.yanerdstation.kr':'https://station-one-collab.soalsebi.chatgpt.site';
export const stationOf=p=>p.station||stations.find(s=>s.id===p.site_id)||stations[1];
export const saveLocked=p=>p.site_id==='S202103';
export function validateStation(s){
 if(!s||!/^S\d{6}$/.test(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Array.isArray(s.centre)||s.centre.length!==3||!s.centre.every(Number.isFinite)||s.centre[0]<124||s.centre[0]>132||s.centre[1]<33||s.centre[1]>39)throw Error('역 ID·이름·중심 좌표를 확인하세요.');
 if(!Array.isArray(s.floors)||!s.floors.length||s.floors.length>30||new Set(s.floors).size!==s.floors.length||!s.floors.every(f=>/^(B[1-9]\d?|[1-9]\d?F|RF)$/.test(f)&&Number.isFinite(s.heights?.[f]))||!s.floors.includes(s.default_floor))throw Error('층 목록·기준고도·시작 층을 확인하세요.');
 return s;
}
