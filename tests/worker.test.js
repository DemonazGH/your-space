import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{validate,tokenHash} from '../worker/index.js';
import {block} from '../questions.js';
const sample=()=>({schemaVersion:1,blockId:'first-steps-v1',consent:true,language:'ru',sessionId:'11111111-1111-4111-8111-111111111111',revision:1,completed:false,answers:{purpose:{values:['try'],text:'Пример',skipped:false}}});
test('Sixth block accepts practical experience and keeps older schemas separate',()=>{const data={...sample(),blockId:'hands-on-and-asking-v1',answers:{practical_task:{values:['settings'],text:'',skipped:false},asking_recently:{values:['not_asked'],text:'',skipped:false}}};assert.equal(validate(data).blockId,'hands-on-and-asking-v1');assert.throws(()=>validate({...sample(),blockId:'hands-on-and-asking-v1'}));});
test('Fifth block validates independently from earlier answers',()=>{const data={...sample(),blockId:'follow-up-examples-v1',answers:{tech_interest:{values:['devices'],text:'',skipped:false},repeat_result:{values:['forgot'],text:'',skipped:false}}};assert.equal(validate(data).blockId,'follow-up-examples-v1');assert.throws(()=>validate({...sample(),blockId:'follow-up-examples-v1'}));});
test('Fourth block accepts its choices and rejects previous block answers',()=>{const data={...sample(),blockId:'content-and-clarity-v1',answers:{content_topics:{values:['games','science'],text:'',skipped:false}}};assert.equal(validate(data).blockId,'content-and-clarity-v1');assert.throws(()=>validate({...sample(),blockId:'content-and-clarity-v1'}));});
test('Third block accepts daily experiences without mixing older block schemas',()=>{const data={...sample(),blockId:'daily-experiences-v1',answers:{outside_activity:{values:['watch_read'],text:'',skipped:false},changed_plan:{values:['time','clarify'],text:'',skipped:false}}};assert.equal(validate(data).blockId,'daily-experiences-v1');assert.throws(()=>validate({...data,blockId:'interests-details-v1'}));});
test('Second block uses its own schema and rejects first-block answers',()=>{const data={...sample(),blockId:'interests-details-v1',answers:{game_actions:{values:['explore'],text:'',skipped:false}}};assert.equal(validate(data).blockId,'interests-details-v1');assert.throws(()=>validate({...sample(),blockId:'interests-details-v1'}));});
test('Reject invalid choices, path traversal and missing consent',()=>{for(const patch of [{sessionId:'../../evil'},{consent:false},{answers:{purpose:{values:['invalid'],text:'',skipped:false}}},{answers:{activities:{values:['play','private'],text:'',skipped:false}}}])assert.throws(()=>validate({...sample(),...patch}));assert.equal(validate(sample()).answers.purpose.text,'Пример');});
test('Reject unauthenticated callers without touching storage',async()=>{const r=await worker.fetch(new Request('https://example.com/answers',{method:'POST',headers:{Origin:'https://example.org'}}),{ALLOWED_ORIGIN:'https://example.org',GITHUB_TOKEN:'fake'});assert.equal(r.status,401);});
test('Reject wrong origin and do not reflect it',async()=>{const r=await worker.fetch(new Request('https://example.com/answers',{headers:{Origin:'https://evil.org'}}),{ALLOWED_ORIGIN:'https://example.org'});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});
test('Save test responses only to test namespace, preserve Unicode, ignore client mode',async()=>{
 const oldFetch=globalThis.fetch,token='a'.repeat(64);let written;
 globalThis.fetch=async(url,options)=>{assert.match(url,/contents\/test\//);if(options.method==='PUT'){written=JSON.parse(options.body);return Response.json({});}return new Response('',{status:404});};
 try{const env={ALLOWED_ORIGIN:'https://example.org',GITHUB_TOKEN:'fake',DATA_REPO:'owner/data',TEST_TOKEN_HASH:await tokenHash(token)};
 const r=await worker.fetch(new Request('https://api/answers',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...sample(),mode:'participant'})}),env);assert.equal(r.status,200);const saved=JSON.parse(Buffer.from(written.content,'base64').toString());assert.equal(saved.mode,'test');assert.equal(saved.answers.purpose.text,'Пример');
 }finally{globalThis.fetch=oldFetch;}
});
test('Older revisions cannot overwrite newer answers',async()=>{const oldFetch=globalThis.fetch,token='b'.repeat(64);let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({sha:'x',content:Buffer.from(JSON.stringify({revision:5})).toString('base64')});};try{const r=await worker.fetch(new Request('https://api/answers',{method:'POST',headers:{Origin:'https://example.org',Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(sample())}),{ALLOWED_ORIGIN:'https://example.org',GITHUB_TOKEN:'fake',DATA_REPO:'owner/data',PARTICIPANT_TOKEN_HASH:await tokenHash(token)});assert.equal(r.status,200);assert.equal(calls,1);assert.equal((await r.json()).revision,5);}finally{globalThis.fetch=oldFetch;}});

const finishSample=()=>({...sample(),blockId:block.id,completed:true,answers:Object.fromEntries(block.questions.map(q=>[q.id,{values:[q.options[0][0]],text:'',skipped:false}]))});
test('Explicit finish validates every question without requiring personal disclosures',()=>{
 assert.equal(block.requiresFinish,true);const response=finishSample();assert.equal(validate(response).completed,true);
 const incomplete=structuredClone(response);delete incomplete.answers[block.questions[0].id];assert.throws(()=>validate(incomplete),/Incomplete finish/);
 incomplete.answers[block.questions[0].id]={values:[],text:'  ',skipped:false};assert.throws(()=>validate(incomplete),/Incomplete finish/);
 assert.equal(validate({...incomplete,completed:false}).completed,false);
 incomplete.answers[block.questions[0].id]={values:[],text:'',skipped:true};assert.equal(validate(incomplete).completed,true);
 for(const value of ['unknown','private']){incomplete.answers[block.questions[0].id]={values:[value],text:'',skipped:false};assert.equal(validate(incomplete).completed,true);}
});

async function finishStorage(){
 const original=globalThis.fetch,token='c'.repeat(64),records=new Map(),messages=[];
 const settings={failSave:false,failTelegram:false},env={ALLOWED_ORIGIN:'https://example.org',GITHUB_TOKEN:'fake',DATA_REPO:'owner/private',PARTICIPANT_TOKEN_HASH:await tokenHash(token),TELEGRAM_BOT_TOKEN:'fake'};
 const answerPath=`participant/${finishSample().sessionId}/${block.id}.json`;
 globalThis.fetch=async(url,options={})=>{
  if(url.includes('api.telegram.org')){messages.push(JSON.parse(options.body));return settings.failTelegram?Response.json({ok:false},{status:503}):Response.json({ok:true,result:{message_id:messages.length}});}
  const path=url.split('/contents/')[1];assert.ok(path);
  if(path==='compass/participant.json')return Response.json({sha:'registration',content:Buffer.from(JSON.stringify({chatId:123,enabled:true})).toString('base64')});
  if(options.method==='PUT'){
   if(path===answerPath&&settings.failSave)return new Response('',{status:502});
   const data=JSON.parse(options.body);if(records.has(path)&&!data.sha)return new Response('',{status:409});records.set(path,JSON.parse(Buffer.from(data.content,'base64')));return Response.json({});
  }
  return records.has(path)?Response.json({sha:'stored',content:Buffer.from(JSON.stringify(records.get(path))).toString('base64')}):new Response('',{status:404});
 };
 const request=value=>new Request('https://host/answers',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(value)});
 return {env,records,messages,settings,answerPath,request,restore:()=>{globalThis.fetch=original;}};
}

test('Only persisted completion sends thanks and Telegram failure cannot fail answer saving',async()=>{
 const store=await finishStorage();try{
  store.settings.failSave=true;let response=await worker.fetch(store.request(finishSample()),store.env);assert.equal(response.status,502);assert.equal(store.messages.length,0);
  store.settings.failSave=false;store.settings.failTelegram=true;response=await worker.fetch(store.request(finishSample()),store.env);assert.equal(response.status,200);assert.equal((await response.json()).saved,true);assert.equal(store.records.get(store.answerPath).completed,true);assert.equal(store.messages.length,1);
  store.settings.failTelegram=false;response=await worker.fetch(store.request(finishSample()),store.env);assert.equal(response.status,200);assert.equal(store.messages.length,1);
 }finally{store.restore();}
});

test('Duplicate revisions use stored answers to recover thanks without trusting stale client completion',async()=>{
 const store=await finishStorage();try{
  const stored={...finishSample(),revision:5,completed:false,mode:'participant'};store.records.set(store.answerPath,stored);
  let response=await worker.fetch(store.request(finishSample()),store.env);assert.equal(response.status,200);assert.equal(store.messages.length,0);
  store.records.set(store.answerPath,{...stored,completed:true});
  const tasks=[];response=await worker.fetch(store.request({...finishSample(),completed:false}),store.env,{waitUntil:task=>tasks.push(task)});assert.equal(response.status,200);await Promise.all(tasks);assert.equal(store.messages.length,1);assert.equal((await response.json()).revision,5);
  response=await worker.fetch(store.request(finishSample()),store.env);assert.equal(response.status,200);assert.equal(store.messages.length,1);
 }finally{store.restore();}
});
