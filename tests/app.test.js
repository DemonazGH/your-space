import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {block} from '../questions.js';

test('Cloud flow requires consent, survives language change, and marks completion',()=>{
 const elements=new Map(),memory=new Map(),queued=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,focus(){},setAttribute(){},append(){}});return elements.get(id);};
 const languages=['ru','en'].map(lang=>({...element(lang),dataset:{lang}}));
 const document={documentElement:{},querySelector:element,querySelectorAll:s=>s==='[data-lang]'?languages:[],createElement:()=>element('created')};
 const context={document,block,cloudEnabled:true,testMode:true,storageKey:'test-key',queue:s=>queued.push(JSON.parse(JSON.stringify(s))),subscribe:fn=>fn('idle'),retrySave(){},cancel(){},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},window:{scrollTo(){}},confirm:()=>true};
 vm.createContext(context);const src=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(src,context);
 assert.match(element('#app').innerHTML,/автоматически сохраняться/);
 assert.equal(queued.at(-1).consent,false);
 element('#consent').onchange({target:{checked:true}});element('#start').onclick();
 element('#note').oninput({target:{value:'example'}});languages[1].onclick();
 assert.ok(element('#app').innerHTML.includes(block.questions[0].title[1]));assert.match(element('#app').innerHTML,/example/);
 for(let i=0;i<block.questions.length;i++)element('#next').onclick();
 element('#finish').onclick();assert.equal(queued.at(-1).completed,true);assert.equal(queued.at(-1).cloudConsentVersion,1);
 assert.match(element('#app').innerHTML,/save status is shown/);
});
