import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyBlock,minskDate,thankCompletedBlock} from '../worker/notifications.js';
import {block} from '../questions.js';
import worker from '../worker/index.js';
test('Minsk calendar date does not follow Warsaw daylight saving',()=>{assert.equal(minskDate(new Date('2026-12-01T21:30:00Z')),'2026-12-02');});
test('Notifications skip opt-out and completed blocks; deduplicate publication and evening',async()=>{
 const original=globalThis.fetch;let enabled=false,done=false,sends=0,published=true;const records=new Map();
 const env={DATA_REPO:'owner/private',GITHUB_TOKEN:'fake',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_PARTICIPANT_ACCESS:'private-link'};
 globalThis.fetch=async(url,options={})=>{
  if(url.includes('api.telegram.org')){sends++;const body=JSON.parse(options.body);assert.equal(body.chat_id,123);assert.match(body.reply_markup.inline_keyboard[0][0].url,/mode=participant/);return Response.json({ok:true,result:{message_id:sends}});}
  if(url.includes('github.io'))return new Response(`export const block = {id:'${published?block.id:'old'}'}`);
  if(url.includes('/git/trees/'))return Response.json({tree:done?[{type:'blob',path:`participant/id/${block.id}.json`}]:[]});
  if(url.includes('/contents/participant/'))return Response.json({content:Buffer.from(JSON.stringify({blockId:block.id,completed:true})).toString('base64')});
  const key=url.split('/contents/compass/')[1];
  if(key==='participant.json')return Response.json({sha:'s',content:Buffer.from(JSON.stringify({chatId:123,enabled})).toString('base64')});
  if(options.method==='PUT'){const body=JSON.parse(options.body);if(records.has(key)&&!body.sha)return new Response('',{status:409});records.set(key,JSON.parse(Buffer.from(body.content,'base64')));return Response.json({});}
  return records.has(key)?Response.json({sha:'s',content:Buffer.from(JSON.stringify(records.get(key))).toString('base64')}):new Response('',{status:404});
 };
 try{
  assert.equal((await notifyBlock(env)).reason,'disabled_or_unregistered');assert.equal(sends,0);
  enabled=true;done=true;assert.equal((await notifyBlock(env)).reason,'completed');assert.equal(sends,0);
  done=false;published=false;await assert.rejects(()=>notifyBlock(env),/publication_not_ready/);assert.equal(sends,0);published=true;
  assert.equal((await notifyBlock(env)).sent,true);assert.equal((await notifyBlock(env)).reason,'already_sent');assert.equal(sends,1);
  const date=new Date('2026-10-10T18:00:00Z');assert.equal((await notifyBlock(env,'evening',date)).sent,true);assert.equal((await notifyBlock(env,'evening',date)).reason,'already_sent');assert.equal(sends,2);
  done=true;assert.equal((await notifyBlock(env,'evening',new Date('2026-10-11T18:00:00Z'))).reason,'completed');assert.equal(sends,2);
 }finally{globalThis.fetch=original;}
});
test('Notification endpoint rejects callers without dedicated secret',async()=>{const r=await worker.fetch(new Request('https://host/telegram/notify',{method:'POST'}),{TELEGRAM_NOTIFY_KEY:'secret'});assert.equal(r.status,401);});

const completionResponse=()=>({blockId:block.id,mode:'participant',completed:true,sessionId:'11111111-1111-4111-8111-111111111111',revision:3,answers:Object.fromEntries(block.questions.map(q=>[q.id,{values:[q.options[0][0]],text:'',skipped:false}]))});
function completionStorage(){
 const original=globalThis.fetch,records=new Map(),sent=[];
 const options={enabled:true,telegramFails:false,disableOnClaim:false};
 const env={DATA_REPO:'owner/private',GITHUB_TOKEN:'fake',TELEGRAM_BOT_TOKEN:'fake'};
 globalThis.fetch=async(url,request={})=>{
  if(url.includes('api.telegram.org')){
   const message=JSON.parse(request.body);sent.push(message);
   assert.equal(records.get(`deliveries/${block.id}-completion.json`)?.status,'claimed');
   return options.telegramFails?Response.json({ok:false},{status:503}):Response.json({ok:true,result:{message_id:sent.length}});
  }
  const key=url.split('/contents/compass/')[1];assert.ok(key);
  if(key==='participant.json')return Response.json({sha:'participant',content:Buffer.from(JSON.stringify({chatId:123,enabled:options.enabled})).toString('base64')});
  if(request.method==='PUT'){
   const body=JSON.parse(request.body);
   if(records.has(key)&&!body.sha)return new Response('',{status:409});
   const value=JSON.parse(Buffer.from(body.content,'base64'));records.set(key,value);
   if(value.status==='claimed'&&options.disableOnClaim)options.enabled=false;
   return Response.json({});
  }
  return records.has(key)?Response.json({sha:'delivery',content:Buffer.from(JSON.stringify(records.get(key))).toString('base64')}):new Response('',{status:404});
 };
 return {env,options,records,sent,restore:()=>{globalThis.fetch=original;}};
}

test('Finish thanks exclude drafts, test responses, old blocks and incomplete answers',async()=>{
 const store=completionStorage();try{
  const response=completionResponse();
  for(const change of [{completed:false},{mode:'test'},{blockId:'first-steps-v1'},{answers:{}},{answers:{[block.questions[0].id]:{values:[],text:' ',skipped:false}}}]){
   assert.equal((await thankCompletedBlock(store.env,{...response,...change})).reason,'not_applicable');
  }
  assert.equal(store.records.size,0);assert.equal(store.sent.length,0);
 }finally{store.restore();}
});

test('Finish thanks send private B2 English gratitude once per block across sessions',async()=>{
 const store=completionStorage();try{
  const response=completionResponse();assert.equal((await thankCompletedBlock(store.env,response)).sent,true);
  const message=store.sent[0];assert.equal(message.chat_id,123);assert.match(message.text,/Thanks, Artsiom!/);assert.match(message.text,/take a break/);assert.ok(!message.text.includes(block.questions[0].title[0]));
  assert.equal((await thankCompletedBlock(store.env,response)).reason,'already_sent');
  assert.equal((await thankCompletedBlock(store.env,{...response,sessionId:'22222222-2222-4222-8222-222222222222',revision:99})).reason,'already_sent');
  assert.equal(store.sent.length,1);assert.equal(store.records.get(`deliveries/${block.id}-completion.json`).status,'sent');
 }finally{store.restore();}
});

test('Finish thanks respect opt-out before claiming and immediately before sending',async()=>{
 const store=completionStorage();try{
  store.options.enabled=false;assert.equal((await thankCompletedBlock(store.env,completionResponse())).reason,'disabled_or_unregistered');assert.equal(store.records.size,0);
  store.options.enabled=true;store.options.disableOnClaim=true;assert.equal((await thankCompletedBlock(store.env,completionResponse())).reason,'disabled');assert.equal(store.sent.length,0);
 }finally{store.restore();}
});

test('Concurrent finishes claim one delivery and uncertain Telegram sends are not retried',async()=>{
 let store=completionStorage();try{
  const results=await Promise.allSettled([thankCompletedBlock(store.env,completionResponse()),thankCompletedBlock(store.env,completionResponse())]);
  assert.equal(store.sent.length,1);assert.equal(results.filter(result=>result.status==='fulfilled'&&result.value.sent).length,1);
 }finally{store.restore();}
 store=completionStorage();try{
  store.options.telegramFails=true;await assert.rejects(()=>thankCompletedBlock(store.env,completionResponse()),/telegram_failed/);
  store.options.telegramFails=false;assert.equal((await thankCompletedBlock(store.env,completionResponse())).reason,'delivery_requires_review');assert.equal(store.sent.length,1);
 }finally{store.restore();}
});
