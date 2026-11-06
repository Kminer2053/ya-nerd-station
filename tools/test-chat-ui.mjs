import assert from 'node:assert/strict';
import {createEbiChat} from '../src/console/ebi-chat.js';

// Execute the real mount/report/renderStatus controller without a network or a
// browser dependency. This catches closure/DOM update errors, not just labels.
const nodes=new Map();
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.isConnected=true;this.scrollTop=0;this.scrollHeight=0;this.clientHeight=0;}
 set innerHTML(value){this._html=value;for(const [,id]of value.matchAll(/\bid="([^"]+)"/g)){const node=new Element();node.id=id;nodes.set(id,node);}}
 get innerHTML(){return this._html||'';}
 querySelector(selector){if(selector.startsWith('#'))return nodes.get(selector.slice(1))||null;return new Element();}
 append(...children){this.children.push(...children);}
 prepend(...children){this.children.unshift(...children);}
 replaceChildren(...children){this.children=[...children];}
 before(){} after(){} remove(){this.isConnected=false;}
 setAttribute(name,value){this.attributes[name]=value;}
 getContext(){return {drawImage(){}};}
 toBlob(resolve,type){resolve(new Blob(['fixture'],{type}));}
 focus(){} select(){}
}
const nativeDocument=globalThis.document,nativeBitmap=globalThis.createImageBitmap;
globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text}),querySelector:()=>null};
let chat;
try{
 const job={id:'c74a3ce4-6d3c-4b17-b081-2fc25aee8d39',kind:'conversation',status:'draft',proposal_id:'proposal',report_version:'v1'};
 chat=createEbiChat({api:async()=>({messages:[],connection:{connected:true,label:'시험 Codex'},job,dispatch:{automatic:false}}),toast:()=>{}});
 const panel=new Element();chat.mount(panel);
 const report=status=>({report:{id:'report',station_name:'서울역',floor:'2F',type_label:'파사드',status,updated_at:status==='accepted'?'v1':'v2'}});
 chat.report(report('accepted'),'시험 승인자');await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.get('ebiStatus').textContent,/검토할 초안 있음/);assert.equal(nodes.get('ebiText').disabled,false);
 chat.report(report('applied'),'시험 승인자');
 assert.match(nodes.get('ebiStatus').textContent,/지도 반영 완료/);assert(!nodes.get('ebiStatus').textContent.includes('초안 있음'));assert.equal(nodes.get('ebiText').disabled,true);assert.equal(nodes.get('ebiSend').textContent,'작업 전송 종료');assert.equal(nodes.get('ebiDraft').textContent,'승인 결과 확인');assert.equal(nodes.get('ebiDraft').hidden,false);
 chat.report(report('queued'),'시험 승인자');assert.match(nodes.get('ebiStatus').textContent,/지도 반영 대기/);assert.equal(nodes.get('ebiText').disabled,true);
 chat.report(report('rejected'),'시험 승인자');assert.match(nodes.get('ebiStatus').textContent,/제보 반려 · 종료/);assert.equal(nodes.get('ebiDraft').hidden,true);
 chat.report(report('accepted'),'시험 승인자');assert.equal(nodes.get('ebiText').disabled,false);assert.match(nodes.get('ebiStatus').textContent,/검토할 초안 있음/);
 let finishBitmap;globalThis.createImageBitmap=()=>new Promise(resolve=>finishBitmap=resolve);
 const attachment=chat.attachImage(new Blob(['test'],{type:'image/png'}));
 chat.clear();chat.report(report('accepted'),'다른 승인자');
 finishBitmap({width:2,height:2,close(){}});await assert.rejects(attachment,/계정이나 제보/,'An image prepared under another login must not enter the new composer');
 assert.equal(nodes.get('ebiText').value,'');
 globalThis.createImageBitmap=async()=>({width:2,height:2,close(){}});await chat.attachImage(new Blob(['image'],{type:'image/jpeg'}),{name:'지도 배치.jpg'});
 assert.equal(nodes.get('ebiFilesList').children[0].children[1].children[0].textContent,'지도 배치.png','Normalized image MIME and filename extension agree');assert.match(nodes.get('ebiCount').textContent,/첨부 1\/8/);

 chat.clear();assert.equal(panel.hidden,true);
 console.log('PASS: actual chat mount/report/renderStatus; stale draft cannot override applied/queued/rejected report; read-only result actions and reopened conversation');
}finally{chat?.stop();globalThis.document=nativeDocument;globalThis.createImageBitmap=nativeBitmap;}
