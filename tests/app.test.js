import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {block} from '../questions.js';

function app(){
 const elements=new Map(),memory=new Map(),queued=[];
 let retries=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,focus(){},setAttribute(){},append(){}});return elements.get(id);};
 const languages=['ru','en'].map(lang=>({...element(lang),dataset:{lang}}));
 const inputs=['unknown','private','other'].map(value=>({value,checked:false}));
 const edits=block.questions.map((q,index)=>({dataset:{index:String(index)}}));
 const document={documentElement:{},querySelector:element,querySelectorAll:s=>s==='[data-lang]'?languages:s==='[name=answer]'?inputs:s==='[name=answer]:checked'?inputs.filter(x=>x.checked):s==='.edit'?edits:[],createElement:()=>element('created')};
 const context={document,block,cloudEnabled:true,testMode:true,storageKey:'test-key',queue:s=>queued.push(JSON.parse(JSON.stringify(s))),subscribe:fn=>fn('idle'),retrySave(){retries++;},cancel(){},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},window:{scrollTo(){}},confirm:()=>true};
 vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),context);
 return {element,languages,inputs,edits,queued,retries:()=>retries,start(){element('#consent').onchange({target:{checked:true}});element('#start').onclick();}};
}

test('Autosave keeps a complete draft unfinished until explicit finish, and editing reopens it',()=>{
 const a=app();
 assert.match(a.element('#app').innerHTML,/автоматически сохраняться/);
 assert.equal(a.queued.at(-1).consent,false);
 a.start();
 for(let i=0;i<block.questions.length;i++){
  a.element('#note').oninput({target:{value:`example ${i}`}});
  if(i<block.questions.length-1)a.element('#next').onclick();
 }
 assert.equal(a.queued.at(-1).completed,false);
 assert.equal(a.element('#finish').disabled,false);
 assert.match(a.element('#app').innerHTML,/id="finish"/);
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.equal(a.queued.at(-1).screen,'done');
 assert.equal(a.retries(),1);
 const count=a.queued.length;
 a.element('#finish').onclick();
 assert.equal(a.queued.length,count);
 a.languages[1].onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.match(a.element('#app').innerHTML,/save status is shown/);
 a.element('#review').onclick();a.edits[0].onclick();
 a.element('#note').oninput({target:{value:''}});
 assert.equal(a.queued.at(-1).completed,false);
 a.element('#skip').onclick();
 assert.equal(a.queued.at(-1).completed,false);
 for(let i=1;i<block.questions.length;i++)a.element('#next').onclick();
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.equal(a.queued.at(-1).cloudConsentVersion,1);
});

test('Unanswered questions are not silently skipped; incomplete finish is a no-op',()=>{
 const a=app();a.start();
 for(let i=0;i<block.questions.length;i++)a.element('#next').onclick();
 assert.equal(a.queued.at(-1).screen,'review');
 assert.deepEqual(a.queued.at(-1).answers,{});
 assert.match(a.element('#app').innerHTML,/Пока нет ответа/);
 assert.equal(a.element('#finish').disabled,true);
 const count=a.queued.length;
 a.element('#finish').onclick();
 assert.equal(a.queued.length,count);
 assert.equal(a.retries(),0);
});

test('Private, unknown, and deliberate skip allow completion without free text',()=>{
 const a=app();a.start();
 a.inputs[1].checked=true;a.inputs[1].onchange();a.element('#next').onclick();
 a.inputs[0].checked=true;a.inputs[0].onchange();a.element('#next').onclick();
 a.element('#skip').onclick();a.element('#skip').onclick();
 assert.equal(a.queued.at(-1).completed,false);
 assert.equal(a.element('#finish').disabled,false);
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.deepEqual(a.queued.at(-1).answers[block.questions[0].id].values,['private']);
 assert.deepEqual(a.queued.at(-1).answers[block.questions[1].id].values,['unknown']);
});
