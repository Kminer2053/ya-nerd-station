import assert from 'node:assert/strict';
import {proposalResultsMarkup} from '../src/console/proposal-result.js';

const origin='https://toolkit.test',id=crypto.randomUUID(),photoId=crypto.randomUUID();
const report={status:'accepted',photos:[{id:photoId}]};
const image='/api/console/proposal-images/'+id;
const facade={
 id,kind:'facade',status:'draft',image,reviewer:'검토자',
 target:{alias:'F03_WL05-S04',name:'스토리웨이 <3층>',before:'https://images.test/old.png',px:[1024,324],effects:[{action:'replace',label:'스토리웨이'}]},
 meta:{ai_job:crypto.randomUUID(),summary:'오른쪽 패널까지 확장',faces:{front:{artifact_id:'fixture',source_photo_ids:[photoId],provenance:{method:'generated',evidence:'<검토 근거>',uncertainty:'현장 확인 필요'}}}},
};
const render=(p,overrides={})=>proposalResultsMarkup([p],{report,origin,approver:true,...overrides});
const draft=render(facade);
assert(draft.indexOf('data-saved-preview')<draft.indexOf('proposal-comparison'),'Preview is reachable above the pictures and detailed evidence');
assert.match(draft,/<div class="proposal-comparison"><figure>.*변경 전<\/figcaption><\/figure><figure>.*수정안 · 1024×324px<\/figcaption><\/figure><\/div><details class="proposal-evidence">/);
assert(draft.includes('href="https://images.test/old.png"'));
assert(draft.includes('href="'+origin+image+'" target="_blank" rel="noopener noreferrer"'));
assert(draft.includes('사진 출처 · 생성과 보정 근거')&&draft.includes('제보 사진 1'));
assert(draft.includes('&lt;검토 근거&gt;')&&!draft.includes('<검토 근거>'));
assert(draft.includes('name="final"')&&draft.includes('data-final'));
assert(!render({...facade,target:{...facade.target,before:'javascript:alert(1)'}}).includes('javascript:'));
assert(!render(facade,{approver:false}).includes('data-saved-preview'));
assert(!render(facade,{approver:false}).includes('data-final'));

const applied=render({...facade,status:'applied'},{report:{...report,status:'applied'}});
assert(applied.includes('반영 결과 · 1024×324px')&&applied.includes('data-saved-preview'));
assert(!applied.includes('data-final')&&!applied.includes('data-undo'));
const asset={name:'이동형 키오스크',floor:'3F',position:[127.434,36.332,63.4],size:[1,.4,2],heading:0,color:'#a9b6b0',dimension_basis:'estimated'};
const removal={id,kind:'removal',status:'draft',image:null,target:{name:asset.name,effects:[{action:'hide',label:asset.name,before:JSON.stringify(asset)}]},meta:{ai_job:facade.meta.ai_job}};
assert(render(removal).includes('숨김 예정 · 원본 보존'));
const hidden=render({...removal,status:'applied'});
assert(hidden.includes('지도에서 숨김 · 원본 보존')&&hidden.includes('data-saved-preview')&&hidden.includes('data-undo'));
assert(!hidden.includes('data-final')&&!hidden.includes('proposal-images/'));
const structure=render({id,kind:'structure',status:'ready',image,images:{front:image,left:image+'/left'},target:{name:asset.name,structure:asset},meta:{ai_job:facade.meta.ai_job}});
assert(structure.includes('구조물 모형 · 보정한 면')&&structure.includes('href="'+origin+image+'/left"')&&structure.includes('data-final'));

const history=render({...facade,status:'superseded'});
assert(history.includes('수정안이 준비되면 여기에 표시됩니다.')&&history.includes('이전 초안 1개 · 승인 불가'));
assert(!history.includes('data-saved-preview')&&!history.includes('data-final'));
console.log('PASS: facade, structure and removal results; contained comparisons, safe image links, folded proof, preview and review actions');
