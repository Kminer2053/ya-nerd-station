export const stations=[
 {id:'S202103',name:'서울역',status:'jury-locked',centre:[126.9708218,37.55363,36.19],floors:['B7','B6','B5','B4','B3','B2','B1','1F','2F','3F'],heights:{B7:-20.39,B6:-15.8,B5:-11.2,B4:-6.5,B3:5.3,B2:15.2,B1:22.2,'1F':27.2,'2F':36.19,'3F':43.2},default_floor:'2F'},
 {id:'S201801',name:'대전역',status:'available',centre:[127.43459,36.33223,60.34],floors:['1F','2F','3F','4F','5F','RF'],heights:{'1F':55.69,'2F':60.34,'3F':63.48,'4F':68.37,'5F':71.66,RF:74.33},default_floor:'3F'},
];
export const ktxCatalog=[
 {name:'강릉역',category:'기차역 > 고속철도'},
 {name:'계룡역',category:'기차역 > 고속철도'},
 {name:'곡성역',category:'기차역 > 고속철도'},
 {name:'공주역',category:'기차역 > 고속철도'},
 {name:'광명역',category:'철도/지하철 > 고속철도'},
 {name:'광주송정역',category:'철도/지하철 > 고속철도'},
 {name:'구례구역',category:'기차역 > 고속철도'},
 {name:'김천구미역',category:'철도/지하철 > 고속철도'},
 {name:'나주역',category:'기차역 > 고속철도'},
 {name:'남원역',category:'기차역 > 고속철도'},
 {name:'논산역',category:'기차역 > 고속철도'},
 {name:'대전역',category:'철도/지하철 > 고속철도'},
 {name:'동대구역',category:'기차역 > 경부선'},
 {name:'마산역',category:'기차역 > 고속철도'},
 {name:'목포역',category:'기차역 > 고속철도'},
 {name:'부산역',category:'기차역 > 경부선'},
 {name:'부전역',category:'기차역 > 고속철도'},
 {name:'상봉역',category:'기차역 > 고속철도'},
 {name:'서대구역',category:'기차역 > 고속철도'},
 {name:'서대전역',category:'기차역 > 고속철도'},
 {name:'서울역',category:'철도/지하철 > 2호/4호/경의/공항선/고속철도'},
 {name:'서원주역',category:'기차역 > 고속철도'},
 {name:'수원역',category:'기차역 > 경부선'},
 {name:'순천역',category:'기차역 > 고속철도'},
 {name:'신경주역',category:'기차역 > 고속철도'},
 {name:'안동역',category:'기차역 > 고속철도'},
 {name:'여수엑스포역',category:'기차역 > 고속철도'},
 {name:'여천역',category:'기차역 > 고속철도'},
 {name:'오송역',category:'기차역 > 고속철도'},
 {name:'용산역',category:'철도/지하철 > 1호/경의/중앙/고속철도'},
 {name:'울산역',category:'기차역 > 고속철도'},
 {name:'원주역',category:'기차역 > 고속철도'},
 {name:'익산역',category:'기차역 > 고속철도'},
 {name:'정읍역',category:'기차역 > 고속철도'},
 {name:'제천역',category:'기차역 > 고속철도'},
 {name:'진부역',category:'기차역 > 고속철도'},
 {name:'진영역',category:'기차역 > 고속철도'},
 {name:'진주역',category:'기차역 > 고속철도'},
 {name:'창원역',category:'기차역 > 고속철도'},
 {name:'창원중앙역',category:'기차역 > 고속철도'},
 {name:'천안아산역',category:'철도/지하철 > 고속철도'},
 {name:'청량리역',category:'기차역 > 고속철도'},
 {name:'평창역',category:'기차역 > 고속철도'},
 {name:'평택역',category:'기차역 > 고속철도'},
 {name:'포항역',category:'기차역 > 고속철도'},
 {name:'행신역',category:'기차역 > 고속철도'},
];
export const seoulOrigin=()=>['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:4196':location.hostname.endsWith('yanerdstation.kr')?'https://seoul.yanerdstation.kr':'https://station-one-collab.soalsebi.chatgpt.site';
export const stationOf=p=>p.station||stations.find(s=>s.id===p.site_id)||stations[1];
export const saveLocked=p=>p.site_id==='S202103';
export function validateStation(s){
 if(!s||!/^S\d{6}$/.test(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Array.isArray(s.centre)||s.centre.length!==3||!s.centre.every(Number.isFinite)||s.centre[0]<124||s.centre[0]>132||s.centre[1]<33||s.centre[1]>39)throw Error('역 ID·이름·중심 좌표를 확인하세요.');
 if(!Array.isArray(s.floors)||!s.floors.length||s.floors.length>30||new Set(s.floors).size!==s.floors.length||!s.floors.every(f=>/^(B[1-9]\d?|[1-9]\d?F|RF)$/.test(f)&&Number.isFinite(s.heights?.[f]))||!s.floors.includes(s.default_floor))throw Error('층 목록·기준고도·시작 층을 확인하세요.');
 return s;
}
