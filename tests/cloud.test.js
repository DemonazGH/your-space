import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function client(){
 const jobs=[],sent=[],events={};let response=()=>Response.json({saved:true,revision:99});
 const context={URLSearchParams,location:{hash:'#access='+'a'.repeat(64)+'&mode=test',pathname:'/',search:''},sessionStorage:{setItem(){},getItem(){return null;}},history:{replaceState(){}},window:{addEventListener(k,v){events[k]=v;}},navigator:{onLine:true},crypto,AbortSignal,setTimeout(fn){jobs.push(fn);return jobs.length;},clearTimeout(i){if(i)jobs[i-1]=null;},fetch:async(url,opts)=>{sent.push(JSON.parse(opts.body));return response();}};
 vm.createContext(context);
 const src=readFileSync(new URL('../cloud.js',import.meta.url),'utf8').replaceAll('export ','');
 vm.runInContext(src+'\nglobalThis.api={queue,cancel,retrySave,subscribe,cloudEnabled,testMode};',context);
 return {api:context.api,sent,context,events,fail(){response=()=>new Response('',{status:503});},async tick(){const job=jobs.findIndex(Boolean);if(job>=0){const fn=jobs[job];jobs[job]=null;await fn();}},};
}
const state=()=>({lang:'ru',consent:true,cloudConsentVersion:1,answers:{purpose:{values:['try'],text:'',skipped:false}}});
test('Cloud draft never sends without explicit cloud consent',async()=>{const c=client();c.api.queue({...state(),consent:false},'first-steps-v1');c.api.queue({...state(),cloudConsentVersion:0},'first-steps-v1');await c.tick();assert.equal(c.sent.length,0);});
test('Coalesce rapid edits, preserve draft snapshot, and send completion',async()=>{const c=client(),s=state();c.api.queue(s,'first-steps-v1');s.answers.purpose.text='new';c.api.queue(s,'first-steps-v1');await c.tick();assert.equal(c.sent.length,1);assert.equal(c.sent[0].answers.purpose.text,'new');assert.equal(c.sent[0].revision,2);s.completed=true;c.api.queue(s,'first-steps-v1');await c.tick();assert.equal(c.sent[1].completed,true);});
test('Offline drafts wait; reconnect sends; cancellation stops pending send',async()=>{const c=client(),s=state();c.context.navigator.onLine=false;c.api.queue(s,'first-steps-v1');await c.tick();assert.equal(c.sent.length,0);c.context.navigator.onLine=true;c.api.retrySave();await new Promise(r=>setTimeout(r,0));assert.equal(c.sent.length,1);s.answers.purpose.text='cancel';c.api.queue(s,'first-steps-v1');c.api.cancel();await c.tick();assert.equal(c.sent.length,1);});
