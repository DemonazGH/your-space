import test from 'node:test';
import assert from 'node:assert/strict';
import {PlansStore,PlansError,escapeHTML,validateEvent,readSnapshot,minskToday,renderPlans,hasTelegramLaunch,errorMessage,safeErrorDetails} from '../plans/app.js';

const draft={title:'Английский',date:'2026-11-01',time:'17:00'};
const event={id:'event-one',...draft,createdAt:'2026-10-28T10:00:00.000Z',updatedAt:'2026-10-28T10:00:00.000Z'};
const snapshot=(revision=0,events=[],consent=false)=>({mode:'participant',revision,consent,events,timeZone:'Europe/Minsk'});
const response=data=>({ok:true,status:200,json:async()=>data});
const ui=(more={})=>({lang:'ru',formOpen:false,editId:null,draft:{...draft},fieldErrors:{},consentChecked:false,error:null,message:'',deleteEvent:null,undoEvent:null,uncertainSave:false,...more});

test('plans: strict dates, clock time and title bounds; Minsk date does not use UTC day',()=>{
  assert.equal(validateEvent(draft).valid,true);
  for(const date of ['2026-02-29','2026-04-31','2026-1-01','0000-01-01','not-a-date'])assert.equal(validateEvent({...draft,date}).valid,false);
  assert.equal(validateEvent({...draft,date:'2028-02-29'}).valid,true);
  for(const time of ['24:00','17:60','9:00','17:00:00',''])assert.equal(validateEvent({...draft,time}).valid,false);
  assert.equal(validateEvent({...draft,title:' '.repeat(5)}).valid,false);
  assert.equal(validateEvent({...draft,title:'a'.repeat(141)}).valid,false);
  assert.equal(minskToday(new Date('2026-10-28T22:30:00Z')),'2026-10-29');
});

test('plans: titles and attribute values are escaped; duplicates and malformed snapshots are rejected',()=>{
  assert.equal(escapeHTML('<img src=x onerror="boom"> &\''),'&lt;img src=x onerror=&quot;boom&quot;&gt; &amp;&#39;');
  assert.throws(()=>readSnapshot(snapshot(1,[event,event],true)),PlansError);
  assert.throws(()=>readSnapshot({...snapshot(),timeZone:'UTC'}),PlansError);
  const store=new PlansStore();store.events=[{...event,title:'<img src=x onerror="boom">'}];
  const html=renderPlans(store,ui());
  assert.ok(html.includes('&lt;img src=x onerror=&quot;boom&quot;&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('plans: no initData means empty memory-only demo; demo create/edit/delete/undo never fetch',async()=>{
  let calls=0;const store=new PlansStore({fetchImpl:()=>{calls++;throw new Error('must not call');}});
  assert.equal(store.demo,true);assert.deepEqual(store.events,[]);
  await store.save(draft);assert.equal(store.events.length,1);
  const id=store.events[0].id;await store.save({...draft,title:'Изменено'},{id});assert.equal(store.events[0].title,'Изменено');
  await store.remove(id);assert.equal(store.events.length,0);
  await store.restore(id);assert.equal(store.events[0].title,'Изменено');
  assert.equal(calls,0);assert.equal(new PlansStore().events.length,0);
  assert.match(renderPlans(store,ui()),/Локальный пробный режим/);
});

test('plans: auth failure never falls back to demo or allows writes',async()=>{
  let calls=0;const store=new PlansStore({initData:'invalid-or-expired',fetchImpl:async()=>{calls++;return {ok:false,status:401};}});
  await assert.rejects(store.load(),error=>error.code==='auth');
  assert.equal(store.demo,false);assert.equal(store.hasSnapshot,false);
  await assert.rejects(store.save(draft,{consent:true}),error=>error.code==='refresh');
  assert.equal(calls,1);const html=renderPlans(store,ui());
  assert.ok(html.includes('через Compass'));assert.ok(!html.includes('Локальный пробный режим'));
});

test('plans: Telegram launch without SDK data is blocked instead of silently entering demo',async()=>{
  assert.equal(hasTelegramLaunch({search:'?v=plans-v1',hash:''}),false);
  assert.equal(hasTelegramLaunch({search:'?tgWebAppVersion=8.0',hash:''}),true);
  assert.equal(hasTelegramLaunch({search:'',hash:'#tgWebAppData=opaque-value&tgWebAppVersion=8.0'}),true);
  let calls=0;const store=new PlansStore({telegramLaunchDetected:true,fetchImpl:()=>{calls++;throw new Error();}});
  await assert.rejects(store.load(),error=>error.code==='telegram');
  assert.equal(store.demo,false);assert.equal(calls,0);assert.equal(store.hasSnapshot,false);
  assert.ok(!renderPlans(store,ui()).includes('Локальный пробный режим'));
});

test('plans: initial GET failure describes loading, never a possibly saved change',async()=>{
  let calls=0;const store=new PlansStore({initData:'secret-auth-value',fetchImpl:async()=>{calls++;throw new Error('network');}});
  await assert.rejects(store.load(),error=>error.code==='network'&&error.stage==='initial_load');
  assert.equal(calls,1);assert.equal(store.hasSnapshot,false);assert.equal(store.demo,false);assert.equal(store.needsRefresh,true);
  assert.match(errorMessage(store.error,'ru'),/Не удалось загрузить список/);
  assert.match(errorMessage(store.error,'en'),/The list could not be loaded/);
  for(const lang of ['ru','en']){
    const html=renderPlans(store,ui({lang}));
    assert.ok(!html.includes('Изменение могло сохраниться'));assert.ok(!html.includes('The change may have been saved'));
    assert.ok(!html.includes('Поля формы'));assert.ok(!html.includes('secret-auth-value'));
    assert.match(html,/data-error-stage="initial_load" data-error-code="network" data-http-status="0"/);
  }
});

test('plans: refresh failure describes stale loaded list and keeps writes blocked',async()=>{
  let calls=0;const store=new PlansStore({initData:'auth',fetchImpl:async()=>{calls++;if(calls===1)return response(snapshot(1,[event],true));throw new Error('network');}});
  await store.load();await assert.rejects(store.load(),error=>error.stage==='refresh');
  assert.equal(store.events[0].id,event.id);assert.equal(store.needsRefresh,true);
  assert.match(errorMessage(store.error,'ru'),/Не удалось обновить список/);
  assert.match(errorMessage(store.error,'en'),/last loaded version/);
  assert.ok(!errorMessage(store.error,'ru').includes('Изменение могло сохраниться'));
  await assert.rejects(store.save(draft),error=>error.code==='refresh');assert.equal(calls,2);
});

test('plans: initial storage and response failures do not mention a previous write or a form',async()=>{
  for(const fetchImpl of [async()=>({ok:false,status:503}),async()=>response({not:'a snapshot'})]){
    const store=new PlansStore({initData:'auth',fetchImpl});await assert.rejects(store.load());
    assert.equal(store.error.stage,'initial_load');
    for(const lang of ['ru','en']){
      const text=errorMessage(store.error,lang);
      assert.ok(!text.includes('последней операции'));assert.ok(!text.includes('Поля формы'));assert.ok(!text.includes('Your form'));assert.ok(!text.includes('last action'));
    }
  }
});

test('plans: diagnostic details contain only bounded stage, code and HTTP status',()=>{
  assert.deepEqual(safeErrorDetails({stage:'save',code:'storage',status:503,initData:'secret',id:'private-id',url:'private-url'}),{stage:'save',code:'storage',httpStatus:503});
  assert.deepEqual(safeErrorDetails({stage:'private-id',code:'secret',status:'private'}),{stage:'unknown',code:'unknown',httpStatus:0});
});

test('plans: first server write needs explicit consent; auth travels only in header; acknowledge full matching snapshot',async()=>{
  const calls=[];const store=new PlansStore({initData:'opaque-auth-value',fetchImpl:async(url,options)=>{
    calls.push({url,options});return response(options.method==='GET'?snapshot():snapshot(1,[event],true));
  }});
  await store.load();await assert.rejects(store.save(draft),error=>error.code==='consent');assert.equal(calls.length,1);
  const consentForm=renderPlans(store,ui({formOpen:true}));
  assert.match(consentForm,/Дмитрий как владелец может их прочитать/);
  assert.match(consentForm,/id="save-plan" disabled/);
  await store.save(draft,{consent:true});assert.equal(store.events.length,1);assert.equal(store.lastAction,'save');
  assert.equal(calls[1].options.headers.Authorization,'tma opaque-auth-value');assert.ok(!calls[1].url.includes('opaque-auth-value'));
  assert.deepEqual(JSON.parse(calls[1].options.body),{revision:0,consent:true,...draft});
  assert.ok(!renderPlans(store,ui()).includes('opaque-auth-value'));
});

test('plans: fetch receives globalThis for both loading and mutation, never the PlansStore receiver',async()=>{
  const calls=[];
  function strictReceiverFetch(url,options){
    assert.equal(this,globalThis,'native browser fetch must run with its global receiver');
    calls.push(options.method);
    return Promise.resolve(response(options.method==='GET'?snapshot():snapshot(1,[event],true)));
  }
  const store=new PlansStore({initData:'auth',fetchImpl:strictReceiverFetch});
  await store.load();await store.save(draft,{consent:true});
  assert.deepEqual(calls,['GET','POST']);assert.equal(store.events[0].id,event.id);assert.equal(store.lastAction,'save');
});

test('plans: failed save retains list and draft; no retry; refresh is required before another write',async()=>{
  let calls=0;const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>{calls++;if(options.method==='GET')return response(snapshot());return {ok:false,status:502};}});
  await store.load();const savedDraft={...draft};await assert.rejects(store.save(savedDraft,{consent:true}),error=>error.code==='storage');
  assert.equal(calls,2);assert.deepEqual(savedDraft,draft);assert.equal(store.events.length,0);assert.equal(store.lastAction,null);assert.equal(store.needsRefresh,true);
  const html=renderPlans(store,ui({formOpen:true,draft:savedDraft,consentChecked:true}));
  assert.ok(html.includes('value="Английский"'));assert.match(html,/id="save-plan" disabled/);
  assert.ok(!html.includes('План сохранён в закрытом хранилище.'));
  await assert.rejects(store.save(savedDraft,{consent:true}),error=>error.code==='refresh');assert.equal(calls,2);
});

test('plans: a conflict keeps revision until manual GET; mutation buttons remain disabled',async()=>{
  let calls=0;const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>{calls++;if(options.method==='GET')return response(snapshot(calls>2?3:1,[event],true));return {ok:false,status:409};}});
  await store.load();await assert.rejects(store.save({...draft,title:'Новое'},{id:event.id}),error=>error.code==='conflict');
  assert.equal(store.revision,1);assert.equal(store.events[0].title,event.title);
  const html=renderPlans(store,ui());assert.match(html,/data-edit="event-one" disabled/);assert.match(html,/data-delete="event-one" disabled/);
  assert.equal(calls,2);await store.load();assert.equal(store.revision,3);assert.equal(store.needsRefresh,false);
});

test('plans: network error has uncertain result, not a false save; refresh can reveal saved record without duplicate POST',async()=>{
  let posts=0;const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>{
    if(options.method==='GET')return response(posts?snapshot(1,[event],true):snapshot());posts++;throw new Error('connection lost after sending');
  }});
  await store.load();await assert.rejects(store.save(draft,{consent:true}),error=>error.code==='network'&&error.stage==='save');assert.equal(store.events.length,0);
  assert.match(errorMessage(store.error,'ru'),/Изменение могло сохраниться/);assert.match(errorMessage(store.error,'en'),/The change may have been saved/);
  await store.load();assert.equal(posts,1);assert.equal(store.events.length,1);
  const html=renderPlans(store,ui({formOpen:true,uncertainSave:true,consentChecked:true}));
  assert.ok(html.includes('Такая запись есть в обновлённом списке.'));assert.match(html,/id="save-plan" disabled/);
});

test('plans: pending save prevents double submit and does not show a success claim',async()=>{
  let resolveSave;let posts=0;const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>{
    if(options.method==='GET')return response(snapshot());posts++;return new Promise(resolve=>{resolveSave=resolve;});
  }});
  await store.load();const pending=store.save(draft,{consent:true});
  await assert.rejects(store.save(draft,{consent:true}),error=>error.code==='busy');assert.equal(posts,1);
  const html=renderPlans(store,ui({formOpen:true,consentChecked:true}));
  assert.match(html,/id="save-plan" disabled/);assert.ok(html.includes('Ждём подтверждения сохранения…'));assert.ok(!html.includes('План сохранён в закрытом хранилище.'));
  resolveSave(response(snapshot(1,[event],true)));await pending;assert.equal(store.events.length,1);
});

test('plans: a success HTTP response without the saved effect is not acknowledged',async()=>{
  const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>response(options.method==='GET'?snapshot():snapshot(1,[],true))});
  await store.load();await assert.rejects(store.save(draft,{consent:true}),error=>error.code==='response');
  assert.equal(store.lastAction,null);assert.equal(store.needsRefresh,true);assert.deepEqual(store.events,[]);
});

test('plans: stalled fetch or response body times out, releases controls and never retries the write',async()=>{
  for(const stalledBody of [false,true]){
    let posts=0,signal;
    const store=new PlansStore({initData:'auth',timeoutMs:15,fetchImpl:async(url,options)=>{
      if(options.method==='GET')return response(snapshot());
      posts++;signal=options.signal;
      return stalledBody?{ok:true,status:200,json:()=>new Promise(()=>{})}:new Promise(()=>{});
    }});
    await store.load();await assert.rejects(store.save(draft,{consent:true}),error=>error.code==='network');
    assert.equal(store.pending,false);assert.equal(store.needsRefresh,true);assert.equal(store.lastAction,null);assert.equal(posts,1);
    assert.equal(signal.aborted,true);assert.deepEqual(store.events,[]);
    const html=renderPlans(store,ui({formOpen:true,consentChecked:true}));
    assert.ok(html.includes('value="Английский"'));assert.ok(!/id="cancel-form" disabled/.test(html));assert.ok(!/id="refresh-list"[^>]* disabled/.test(html));
  }
});

test('plans: server delete and restore use current revision, never edit the visible list before acknowledgement',async()=>{
  const calls=[];const store=new PlansStore({initData:'auth',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return response(snapshot(1,[event],true));
    if(options.method==='DELETE')return response(snapshot(2,[],true));
    return response(snapshot(3,[event],true));
  }});
  await store.load();await store.remove(event.id);assert.equal(store.events.length,0);await store.restore(event.id);assert.equal(store.events.length,1);
  assert.equal(calls[1].options.method,'DELETE');assert.deepEqual(JSON.parse(calls[1].options.body),{revision:1,consent:true});
  assert.match(calls[2].url,/\/plans\/events\/event-one\/restore$/);assert.deepEqual(JSON.parse(calls[2].options.body),{revision:2,consent:true});
});
