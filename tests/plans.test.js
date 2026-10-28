import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {handlePlans,validateInitData} from '../worker/plans.js';

const botToken='123456:fake-bot-token';
const origin='https://example.org';
function initData({id=123,at=Math.floor(Date.now()/1000),user={},fields={},token=botToken}={}){
 const params=new URLSearchParams({query_id:'example-query',auth_date:String(at),user:JSON.stringify({id,first_name:'Example & Юзер',...user}),...fields});
 const check=[...params.keys()].sort().map(key=>`${key}=${params.get(key)}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
 return params.toString();
}
function request(path='/plans',{method='GET',auth=initData(),body,headers={}}={}){
 return new Request('https://worker.example'+path,{method,headers:{Origin:origin,...(auth!==null?{Authorization:'tma '+auth}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
const eventInput=(revision=0,change={})=>({revision,consent:true,title:'  Урок английского  ',date:'2026-11-04',time:'17:00',...change});
const storedEvent=(change={})=>({id:randomUUID(),title:'Example plan',date:'2026-11-04',time:'17:00',createdAt:'2026-10-28T12:00:00.000Z',updatedAt:'2026-10-28T12:00:00.000Z',...change});
function storage(){
 const original=globalThis.fetch,files=new Map(),calls=[],options={readFails:false,writeFails:false,beforePut:null,corrupt:false};
 const registrations={admin:{chatId:456,enabled:true},participant:{chatId:123,enabled:true}};
 const env={ALLOWED_ORIGIN:origin,DATA_REPO:'owner/private',GITHUB_TOKEN:'fake-private-token',TELEGRAM_BOT_TOKEN:botToken};
 let serial=0;
 const seed=(mode,value)=>{files.set(mode,{value:structuredClone(value),sha:String(++serial).padStart(40,'0')});};
 globalThis.fetch=async(url,settings={})=>{
  calls.push({url,method:settings.method||'GET'});
  assert.equal(settings.headers.Authorization,'Bearer '+env.GITHUB_TOKEN);
  const role=url.match(/\/contents\/compass\/(admin|participant)\.json$/)?.[1];
  if(role)return registrations[role]?Response.json({sha:'registration',content:Buffer.from(JSON.stringify(registrations[role])).toString('base64')}):new Response('',{status:404});
  const mode=url.match(/\/contents\/plans\/(test|participant)\/events\.json$/)?.[1];assert.ok(mode,'Only a private role-bound plans file may be accessed');
  if(settings.method==='PUT'){
   if(options.writeFails)return new Response('',{status:503});
   const payload=JSON.parse(settings.body);options.beforePut?.(mode,payload);
   const current=files.get(mode);
   if(current?payload.sha!==current.sha:payload.sha!==undefined)return new Response('',{status:409});
   const value=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));seed(mode,value);return Response.json({});
  }
  if(options.readFails)return new Response('',{status:503});
  if(options.corrupt)return Response.json({sha:'stored',content:Buffer.from('not JSON').toString('base64')});
  const current=files.get(mode);
  return current?Response.json({sha:current.sha,content:Buffer.from(JSON.stringify(current.value)).toString('base64')}):new Response('',{status:404});
 };
 return {env,files,calls,options,registrations,seed,restore:()=>{globalThis.fetch=original;},eventCalls:()=>calls.filter(call=>call.url.includes('/contents/plans/')),writes:()=>calls.filter(call=>call.method==='PUT')};
}
async function result(store,path,options){const response=await handlePlans(request(path,options),store.env);return {status:response.status,body:await response.json(),response};}

test('Mini App HMAC validates decoded signed fields, including signature, with exact age boundaries',async()=>{
 const now=1800000000;
 const data=initData({at:now,fields:{signature:'a_telegram_signature',start_param:'hello-world'}});
 assert.equal(await validateInitData(data,botToken,now),123);
 assert.equal(await validateInitData(initData({at:now-86400}),botToken,now),123);
 assert.equal(await validateInitData(initData({at:now+60,user:{is_bot:false}}),botToken,now),123);
 for(const at of [now-86401,now+61,1.5,0,Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>validateInitData(initData({at}),botToken,now),/unauthorized/);
 const changed=new URLSearchParams(data);changed.set('signature','different');await assert.rejects(()=>validateInitData(changed.toString(),botToken,now),/unauthorized/);
});

test('Forged, replay-tampered, stale, malformed and duplicate initData never reads registration or events',async()=>{
 const store=storage();try{
  const signed=initData(),changed=new URLSearchParams(signed);changed.set('user',JSON.stringify({id:456}));
  const fakeHash=new URLSearchParams(signed);fakeHash.set('hash','0'.repeat(64));
  const malformed=new URLSearchParams(signed);malformed.set('hash','not-a-hash');
  const bad=[null,initData({token:'wrong-token'}),changed.toString(),fakeHash.toString(),malformed.toString(),initData({at:Math.floor(Date.now()/1000)-90000}),initData({at:Math.floor(Date.now()/1000)+120}),signed+'&user=%7B%22id%22%3A456%7D',signed+'&%75ser=%7B%7D',signed+'&hash='+'f'.repeat(64),initData({fields:{signature:'one'}})+'&signature=two',initData({fields:{query_id:'x'.repeat(8200)}}),initData({id:0}),initData({id:Number.MAX_SAFE_INTEGER+1}),initData({user:{is_bot:true}}),initData({user:{is_bot:'false'}})];
  for(const auth of bad){const response=await result(store,'/plans',{auth});assert.equal(response.status,401);assert.equal(response.body.error,'unauthorized');}
  const bearer=await result(store,'/plans',{headers:{Authorization:'Bearer '+'a'.repeat(64)}});assert.equal(bearer.status,401);
  assert.equal(store.calls.length,0);assert.equal(store.files.size,0);
 }finally{store.restore();}
});

test('Registered Telegram identity alone selects participant or test storage and unknown users cannot read events',async()=>{
 const store=storage();try{
  let response=await result(store,'/plans',{auth:initData({id:999})});assert.equal(response.status,403);assert.equal(response.body.error,'forbidden');assert.equal(store.eventCalls().length,0);
  response=await result(store,'/plans?mode=participant',{auth:initData({id:456})});assert.equal(response.status,200);assert.equal(response.body.mode,'test');assert.equal(response.body.consent,false);assert.equal(response.body.revision,0);
  assert.ok(store.eventCalls().at(-1).url.endsWith('/plans/test/events.json'));
  response=await result(store,'/plans?mode=test');assert.equal(response.body.mode,'participant');assert.ok(store.eventCalls().at(-1).url.endsWith('/plans/participant/events.json'));
  assert.deepEqual(Object.keys(response.body).sort(),['consent','events','mode','revision','timeZone']);assert.equal(response.body.timeZone,'Europe/Minsk');assert.deepEqual(response.body.events,[]);assert.equal(store.writes().length,0);
  store.registrations.admin.chatId=123;response=await result(store,'/plans');assert.equal(response.body.mode,'test');
 }finally{store.restore();}
});

test('Origin, preflight and role-bound rate limiting guard plans without reading events',async()=>{
 const store=storage();try{
  let response=await handlePlans(request('/plans',{headers:{Origin:'https://evil.example'}}),store.env);assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(store.calls.length,0);
  response=await handlePlans(request('/plans',{method:'OPTIONS',auth:null}),store.env);assert.equal(response.status,204);assert.match(response.headers.get('Access-Control-Allow-Methods'),/GET, POST, PATCH, DELETE, OPTIONS/);assert.equal(response.headers.get('Access-Control-Allow-Headers'),'Authorization, Content-Type');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(store.calls.length,0);
  const keys=[];store.env.SAVE_LIMITER={limit:async({key})=>{keys.push(key);return {success:false};}};
  assert.equal((await result(store,'/plans')).status,429);assert.equal((await result(store,'/plans',{auth:initData({id:456})})).status,429);assert.deepEqual(keys,['plans:participant','plans:test']);assert.equal(store.eventCalls().length,0);
 }finally{store.restore();}
});

test('Private plans support create, edit, soft delete and restore while preserving neighbouring events',async()=>{
 const store=storage();try{
  let response=await result(store,'/plans/events',{method:'POST',body:eventInput()});assert.equal(response.status,200);assert.equal(response.body.revision,1);assert.equal(response.body.consent,true);
  const first=response.body.events[0];assert.equal(first.title,'Урок английского');assert.match(first.id,/^[a-f0-9-]{36}$/);assert.ok(first.createdAt);assert.ok(first.updatedAt);
  response=await result(store,'/plans/events',{method:'POST',body:eventInput(1,{title:'Другой план',date:'2026-11-05'})});assert.equal(response.body.revision,2);const second=response.body.events.find(event=>event.id!==first.id);
  response=await result(store,`/plans/events/${first.id}`,{method:'PATCH',body:eventInput(2,{title:'Изменённый урок',date:'2026-11-06',time:'09:30'})});assert.equal(response.body.revision,3);assert.equal(response.body.events[0].id,second.id);assert.equal(response.body.events[1].title,'Изменённый урок');assert.equal(response.body.events[1].createdAt,first.createdAt);
  response=await result(store,`/plans/events/${first.id}`,{method:'DELETE',body:{revision:3,consent:true}});assert.equal(response.body.revision,4);assert.deepEqual(response.body.events,[second]);assert.ok(store.files.get('participant').value.events.find(event=>event.id===first.id).deletedAt);
  response=await result(store,'/plans');assert.deepEqual(response.body.events,[second]);
  response=await result(store,`/plans/events/${first.id}/restore`,{method:'POST',body:{revision:4,consent:true}});assert.equal(response.body.revision,5);assert.equal(response.body.events.length,2);assert.equal(response.body.events.find(event=>event.id===first.id).title,'Изменённый урок');assert.equal('deletedAt' in store.files.get('participant').value.events.find(event=>event.id===first.id),false);
  assert.equal((await result(store,`/plans/events/${first.id}/restore`,{method:'POST',body:{revision:5,consent:true}})).status,409);
  assert.deepEqual(Object.keys(response.body.events[0]).sort(),['createdAt','date','id','time','title','updatedAt']);assert.equal(store.files.has('test'),false);
 }finally{store.restore();}
});

test('Admin-created events are isolated from participant plans, even with client-supplied mode attempts',async()=>{
 const store=storage();try{
  assert.equal((await result(store,'/plans/events',{method:'POST',auth:initData({id:456}),body:eventInput()})).status,200);
  assert.equal(store.files.has('test'),true);assert.equal(store.files.has('participant'),false);
  const participant=await result(store,'/plans');assert.deepEqual(participant.body.events,[]);assert.equal(participant.body.revision,0);
  const spoof=await result(store,'/plans/events',{method:'POST',auth:initData({id:456}),body:{...eventInput(1),mode:'participant'}});assert.equal(spoof.status,400);assert.equal(store.files.has('participant'),false);
 }finally{store.restore();}
});

test('Invalid calendars, missing values, unknown fields, controls and oversized bodies cannot change a store',async()=>{
 const store=storage();try{
  const invalid=[{title:''},{title:'  '},{title:'a'.repeat(141)},{title:'\nBad title'},{title:'Bad\u0000title'},{title:'Bad\u0085title'},{date:''},{date:'2026-02-29'},{date:'2100-02-29'},{date:'2026-04-31'},{date:'0000-01-01'},{date:'2026-1-01'},{time:''},{time:'24:00'},{time:'17:60'},{time:'7:00'},{consent:false},{revision:-1},{revision:'0'},{revision:0.5},{unknown:'x'}];
  for(const change of invalid){const response=await result(store,'/plans/events',{method:'POST',body:eventInput(0,change)});assert.equal(response.status,400);assert.equal(response.body.error,'invalid_event');}
  assert.equal((await result(store,'/plans/events/not-a-uuid',{method:'DELETE',body:{revision:0,consent:true}})).status,400);
  assert.equal((await result(store,'/plans/events',{method:'POST',body:eventInput(0,{title:'я'.repeat(3000)})})).status,413);
  assert.equal((await result(store,'/plans/events',{method:'POST',body:eventInput(),headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal(store.eventCalls().length,0);assert.equal(store.writes().length,0);
  const leap=await result(store,'/plans/events',{method:'POST',body:eventInput(0,{date:'2028-02-29'})});assert.equal(leap.status,200);
 }finally{store.restore();}
});

test('Stale revisions and simultaneous writes cannot overwrite the newer private snapshot',async()=>{
 const store=storage();try{
  const first=await result(store,'/plans/events',{method:'POST',body:eventInput()});assert.equal(first.status,200);
  let response=await result(store,'/plans/events',{method:'POST',body:eventInput()});assert.equal(response.status,409);assert.equal(response.body.error,'conflict');assert.equal(store.writes().length,1);
  const id=first.body.events[0].id;
  store.options.beforePut=mode=>{store.options.beforePut=null;const concurrent=structuredClone(store.files.get(mode).value);concurrent.revision++;concurrent.events[0].title='Concurrent update';store.seed(mode,concurrent);};
  response=await result(store,`/plans/events/${id}`,{method:'PATCH',body:eventInput(1,{title:'Must not overwrite'})});assert.equal(response.status,409);assert.equal(store.files.get('participant').value.events[0].title,'Concurrent update');assert.equal(store.files.get('participant').value.revision,2);
 }finally{store.restore();}
 const fresh=storage();try{
  const both=await Promise.all([result(fresh,'/plans/events',{method:'POST',body:eventInput()}),result(fresh,'/plans/events',{method:'POST',body:eventInput()})]);
  assert.deepEqual(both.map(response=>response.status).sort(),[200,409]);assert.equal(fresh.files.get('participant').value.events.length,1);assert.equal(fresh.files.get('participant').value.revision,1);
 }finally{fresh.restore();}
});

test('The 200-event limit includes deleted records but still permits restoring an existing plan',async()=>{
 const store=storage();try{
  const events=Array.from({length:200},()=>storedEvent({deletedAt:'2026-10-28T12:00:00.000Z'}));store.seed('participant',{schemaVersion:1,revision:1,consent:true,events});
  const response=await result(store,'/plans/events',{method:'POST',body:eventInput(1)});assert.equal(response.status,400);assert.equal(response.body.error,'limit_reached');assert.equal(store.writes().length,0);
  const restored=await result(store,`/plans/events/${events[0].id}/restore`,{method:'POST',body:{revision:1,consent:true}});assert.equal(restored.status,200);assert.equal(restored.body.events.length,1);assert.equal(store.files.get('participant').value.events.length,200);
 }finally{store.restore();}
});

test('Storage read, write and malformed-file failures fail closed without exposing internal data',async()=>{
 const store=storage();try{
  store.options.readFails=true;let response=await result(store,'/plans');assert.equal(response.status,503);assert.deepEqual(response.body,{error:'storage_unavailable'});
  store.options.readFails=false;store.options.writeFails=true;response=await result(store,'/plans/events',{method:'POST',body:eventInput()});assert.equal(response.status,503);assert.equal(store.files.size,0);
  store.options.writeFails=false;store.options.corrupt=true;response=await result(store,'/plans');assert.equal(response.status,503);
  store.options.corrupt=false;store.seed('participant',{schemaVersion:1,revision:1,consent:true,events:[storedEvent({date:'2026-02-30'})]});response=await result(store,'/plans');assert.equal(response.status,503);
  store.seed('participant',{schemaVersion:1,revision:1,consent:true,events:[],chatId:123});response=await result(store,'/plans');assert.equal(response.status,503);assert.deepEqual(response.body,{error:'storage_unavailable'});
 }finally{store.restore();}
});
