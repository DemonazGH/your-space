import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function client({token='a'.repeat(64),mode='test'}={}){
 const jobs=new Map(),sent=[],requests=[],events={},documentEvents={},statuses=[];
 let now=0,nextId=0,response=()=>Response.json({saved:true,revision:99});
 const context={URLSearchParams,location:{hash:`#access=${token}&mode=${mode}`,pathname:'/',search:''},sessionStorage:{setItem(){},getItem(){return null;}},history:{replaceState(){}},window:{addEventListener(k,v){events[k]=v;}},document:{visibilityState:'visible',addEventListener(k,v){documentEvents[k]=v;}},navigator:{onLine:true},crypto,AbortController,
  setTimeout(fn,delay=0){const id=++nextId;jobs.set(id,{fn,at:now+delay});return id;},clearTimeout(id){jobs.delete(id);},
  fetch:async(url,opts)=>{sent.push(JSON.parse(opts.body));requests.push({url,...opts});return response(opts);}
 };
 vm.createContext(context);
 const src=readFileSync(new URL('../cloud.js',import.meta.url),'utf8').replaceAll('export ','');
 vm.runInContext(src+'\nglobalThis.api={queue,cancel,retrySave,subscribe,cloudEnabled,testMode};',context);
 context.api.subscribe(status=>statuses.push(status));
 return {api:context.api,sent,requests,statuses,context,events,jobs,
  respond(fn){response=fn;},fail(status=503){response=()=>new Response('',{status});},
  async event(name){await events[name]?.();await this.settle();},
  async visible(value){context.document.visibilityState=value;await documentEvents.visibilitychange();await this.settle();},
  async settle(){for(let i=0;i<6;i++)await Promise.resolve();},
  async tick(){const next=[...jobs.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(next){jobs.delete(next[0]);now=next[1].at;await next[1].fn();await this.settle();}},
  delay(){return jobs.size?Math.min(...[...jobs.values()].map(job=>job.at-now)):null;}
 };
}
const state=()=>({lang:'ru',consent:true,cloudConsentVersion:1,answers:{purpose:{values:['try'],text:'',skipped:false}}});
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};

test('Cloud draft never sends without explicit cloud consent or an answer',async()=>{
 const c=client();
 for(const patch of [{consent:false},{cloudConsentVersion:0},{answers:{}}])c.api.queue({...state(),...patch},'first-steps-v1');
 await c.tick();assert.equal(c.sent.length,0);assert.equal(c.jobs.size,0);
});

test('Coalesce rapid edits, preserve draft snapshot, and send completion with the same session',async()=>{
 const c=client(),s=state();c.api.queue(s,'first-steps-v1');s.answers.purpose.text='new';c.api.queue(s,'first-steps-v1');
 s.answers.purpose.text='changed after queue';await c.tick();
 assert.equal(c.sent.length,1);assert.equal(c.sent[0].answers.purpose.text,'new');assert.equal(c.sent[0].revision,2);
 s.completed=true;c.api.queue(s,'first-steps-v1');await c.tick();
 assert.equal(c.sent[1].completed,true);assert.equal(c.sent[1].sessionId,c.sent[0].sessionId);assert.equal(c.sent[1].revision,3);
 assert.equal(c.statuses.at(-1),'saved');
});

test('Initially offline draft retries with bounded delay even if the online event is missed',async()=>{
 const c=client(),s=state();c.context.navigator.onLine=false;c.api.queue(s,'first-steps-v1');await c.tick();
 assert.equal(c.sent.length,0);assert.equal(c.statuses.at(-1),'offline');assert.equal(c.delay(),6000);
 for(let i=0;i<8;i++){await c.tick();assert.ok(c.delay()<=60000);assert.ok(c.delay()>0);}
 c.context.navigator.onLine=true;await c.tick();
 assert.equal(c.sent.length,1);assert.equal(c.statuses.at(-1),'saved');assert.equal(c.jobs.size,0);
});

test('Focus, pageshow and visible resume the latest pending snapshot without waiting for debounce',async()=>{
 for(const resume of [c=>c.event('focus'),c=>c.event('pageshow'),c=>c.visible('visible')]){
  const c=client(),s=state();c.api.queue(s,'first-steps-v1');await resume(c);
  assert.equal(c.sent.length,1);assert.equal(c.statuses.at(-1),'saved');assert.equal(c.jobs.size,0);
 }
});

test('Hiding or leaving a page flushes the latest completed snapshot with keepalive',async()=>{
 for(const hide of [c=>c.event('pagehide'),c=>c.visible('hidden')]){
  const c=client(),s=state();c.api.queue(s,'first-steps-v1');s.completed=true;c.api.queue(s,'first-steps-v1');await hide(c);
  assert.equal(c.sent.length,1);assert.equal(c.sent[0].completed,true);assert.equal(c.sent[0].revision,2);
  assert.equal(c.requests[0].keepalive,true);assert.equal(c.requests[0].credentials,'omit');
  assert.equal(c.statuses.at(-1),'saved');
 }
});

test('In-flight background saves are serialized and promptly drain the newer completion',async()=>{
 const c=client(),s=state(),first=deferred();c.respond(()=>first.promise);
 c.api.queue(s,'first-steps-v1');const sending=c.api.retrySave();await c.settle();
 assert.equal(c.sent.length,1);assert.equal(c.requests[0].keepalive,true);
 s.completed=true;s.answers.purpose.text='latest';c.api.queue(s,'first-steps-v1');await c.event('pagehide');
 assert.equal(c.sent.length,1);assert.equal(c.statuses.at(-1),'pending');
 first.resolve(Response.json({saved:true,revision:1}));await sending;
 assert.equal(c.delay(),0);assert.equal(c.statuses.at(-1),'pending');
 c.respond(()=>Response.json({saved:true,revision:2}));await c.tick();
 assert.equal(c.sent.length,2);assert.equal(c.sent[1].revision,2);assert.equal(c.sent[1].completed,true);
 assert.equal(c.sent[1].answers.purpose.text,'latest');assert.equal(c.requests[1].keepalive,true);
 assert.equal(c.statuses.at(-1),'saved');
});

test('Failed older request cannot replace a newer pending snapshot and failures retry',async()=>{
 const c=client(),s=state(),first=deferred();c.respond(()=>first.promise);
 c.api.queue(s,'first-steps-v1');const sending=c.api.retrySave();s.completed=true;c.api.queue(s,'first-steps-v1');
 first.resolve(new Response('',{status:503}));await sending;
 assert.equal(c.delay(),0);c.fail();await c.tick();
 assert.equal(c.sent[1].revision,2);assert.equal(c.sent[1].completed,true);assert.ok(c.delay()>0);
 c.respond(()=>Response.json({saved:true,revision:2}));await c.tick();
 assert.equal(c.sent[2].revision,2);assert.equal(c.statuses.at(-1),'saved');
});

test('Cancel during an in-flight request suppresses obsolete acknowledgment and does not resurrect erased answers',async()=>{
 const c=client(),s=state(),first=deferred();c.respond(()=>first.promise);
 c.api.queue(s,'first-steps-v1');const sending=c.api.retrySave();c.api.cancel();
 assert.equal(c.requests[0].signal.aborted,true);assert.equal(c.statuses.at(-1),'idle');
 first.resolve(new Response('',{status:503}));await sending;
 await c.event('focus');await c.visible('hidden');await c.tick();
 assert.equal(c.sent.length,1);assert.equal(c.statuses.at(-1),'idle');assert.equal(c.jobs.size,0);
});

test('New consented queue after cancel survives an obsolete in-flight response',async()=>{
 const c=client(),old=state(),first=deferred();c.respond(()=>first.promise);
 c.api.queue(old,'first-steps-v1');const sending=c.api.retrySave();c.api.cancel();
 const current=state();current.answers.purpose.text='new session';c.api.queue(current,'first-steps-v1');
 first.resolve(Response.json({saved:true,revision:99}));await sending;assert.equal(c.delay(),0);
 c.respond(()=>Response.json({saved:true,revision:1}));await c.tick();
 assert.equal(c.sent.length,2);assert.notEqual(c.sent[0].sessionId,c.sent[1].sessionId);
 assert.equal(c.sent[1].answers.purpose.text,'new session');assert.equal(c.statuses.at(-1),'saved');
});

test('Withdrawing consent or clearing answers cancels an older queued snapshot',async()=>{
 for(const patch of [{consent:false},{cloudConsentVersion:0},{answers:{}}]){
  const c=client(),s=state();c.api.queue(s,'first-steps-v1');Object.assign(s,patch);c.api.queue(s,'first-steps-v1');
  await c.tick();await c.event('pagehide');assert.equal(c.sent.length,0);assert.equal(c.statuses.at(-1),'idle');
 }
});

test('Only a valid acknowledgment can report saved and old authorization failures do not taint later network errors',async()=>{
 const c=client(),s=state();c.api.queue(s,'first-steps-v1');c.fail(401);await c.tick();assert.equal(c.statuses.at(-1),'accessError');
 c.respond(()=>{throw Error('network');});await c.tick();assert.equal(c.statuses.at(-1),'offline');
 c.respond(()=>Response.json({saved:true,revision:0}));await c.tick();assert.equal(c.statuses.at(-1),'offline');
 c.respond(()=>Response.json({saved:true,revision:1}));await c.tick();assert.equal(c.statuses.at(-1),'saved');
});

test('A stalled request times out and retries its original revision without blocking later saves',async()=>{
 const c=client();
 c.respond(options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))));
 c.api.queue(state(),'first-steps-v1');const sending=c.api.retrySave();
 assert.equal(c.delay(),15000);await c.tick();await sending;
 assert.equal(c.requests[0].signal.aborted,true);assert.equal(c.statuses.at(-1),'offline');assert.equal(c.delay(),6000);
 c.respond(()=>Response.json({saved:true,revision:1}));await c.tick();
 assert.equal(c.sent.length,2);assert.equal(c.sent[1].revision,1);assert.equal(c.statuses.at(-1),'saved');
});

test('Block identity participates in coalescing and every client retains its own access token',async()=>{
 const c=client(),s=state();c.api.queue(s,'first-steps-v1');await c.tick();c.api.queue(s,'interests-details-v1');await c.tick();
 assert.equal(c.sent.length,2);assert.equal(c.sent[1].blockId,'interests-details-v1');
 const participant=client({token:'b'.repeat(64),mode:'participant'});participant.api.queue(state(),'first-steps-v1');await participant.tick();
 assert.equal(c.api.testMode,true);assert.equal(participant.api.testMode,false);
 assert.equal(c.requests[0].headers.Authorization,'Bearer '+'a'.repeat(64));
 assert.equal(participant.requests[0].headers.Authorization,'Bearer '+'b'.repeat(64));
});
