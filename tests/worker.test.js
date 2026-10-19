import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{validate,tokenHash} from '../worker/index.js';
import {block,blocks} from '../questions.js';
const sample=()=>({schemaVersion:1,blockId:'first-steps-v1',consent:true,language:'ru',sessionId:'11111111-1111-4111-8111-111111111111',revision:1,completed:false,answers:{purpose:{values:['try'],text:'Пример',skipped:false}}});
const schoolSample=()=>({...sample(),blockId:'school-task-motivation-v1',completed:true,answers:{
 school_subject:{values:['english'],text:'',skipped:false},
 school_task_kind:{values:['read'],text:'',skipped:false},
 school_start_reason:{values:['required'],text:'',skipped:false},
 school_start_moment:{values:['clear'],text:'',skipped:false}
}});
const claritySample=()=>({...sample(),blockId:'task-clarity-v1',completed:true,answers:{
 clarity_at_first:{values:['clear'],text:'',skipped:false},
 clarity_meaning:{values:['information'],text:'',skipped:false},
 clarity_source:{values:['task_text'],text:'',skipped:false},
 clarity_check:{values:['no_check'],text:'',skipped:false}
}});
const askingSample=()=>({...sample(),blockId:'working-it-out-or-asking-v1',completed:true,answers:{
 asking_example:{values:['school'],text:'',skipped:false},
 asking_first:{values:['try'],text:'',skipped:false},
 asking_factor:{values:['try'],text:'',skipped:false},
 asking_outcome:{values:['not_needed'],text:'',skipped:false}
}});
const prioritiesSample=()=>({...sample(),blockId:'own-priorities-v1',completed:true,answers:{
 priority_topic:{values:['interests'],text:'',skipped:false},
 priority_change:{values:['understand'],text:'',skipped:false},
 priority_reason:{values:['interest'],text:'',skipped:false},
 priority_next:{values:['explore'],text:'',skipped:false}
}});
const leisureSample=()=>({...sample(),blockId:'leisure-activity-choice-v1',completed:true,answers:{
 leisure_ideas:{values:['mystery','languages'],text:'',skipped:false},
 leisure_next:{values:['example'],text:'',skipped:false}
}});

test('Published block 19 completion still validates without changing its saved answers',()=>{
 const data=schoolSample(),saved=validate(data);assert.equal(saved.blockId,'school-task-motivation-v1');assert.equal(saved.blockVersion,1);assert.equal(saved.completed,true);assert.deepEqual(saved.answers,data.answers);
});

test('Block 20 clarity choices validate independently and cannot be mixed with block 19 answers',()=>{
 const clarity=claritySample();assert.deepEqual(validate(clarity).answers,clarity.answers);
 assert.throws(()=>validate({...clarity,blockId:'school-task-motivation-v1'}),/Invalid answer/);
 assert.throws(()=>validate({...schoolSample(),blockId:'task-clarity-v1'}),/Invalid answer/);
 assert.throws(()=>validate({...clarity,answers:{...clarity.answers,school_start_moment:schoolSample().answers.school_start_moment}}),/Invalid answer/);
 for(const question of blocks.find(b=>b.id==='task-clarity-v1').questions){
  for(const [choice] of question.options){
   const data=claritySample();data.answers[question.id].values=[choice];assert.deepEqual(validate(data).answers,data.answers);
  }
 }
 const invalid=claritySample();invalid.answers.clarity_meaning.values=['result','method'];assert.throws(()=>validate(invalid),/Invalid choice/);
 invalid.answers.clarity_meaning.values=['not_a_clarity_choice'];assert.throws(()=>validate(invalid),/Invalid choice/);
});

test('Published block 20 remains complete and separate from block 21',()=>{
 const clarity=claritySample(),saved=validate(clarity);assert.equal(saved.blockId,'task-clarity-v1');assert.equal(saved.blockVersion,1);assert.equal(saved.completed,true);assert.deepEqual(saved.answers,clarity.answers);
 assert.throws(()=>validate({...clarity,blockId:'working-it-out-or-asking-v1'}),/Invalid answer/);
 assert.throws(()=>validate({...askingSample(),blockId:'task-clarity-v1'}),/Invalid answer/);
 const mixed=askingSample();mixed.answers.clarity_meaning=clarity.answers.clarity_meaning;assert.throws(()=>validate(mixed),/Invalid answer/);
});

test('Block 21 accepts every single choice, including no example and no need to ask',()=>{
 const asking=askingSample();assert.deepEqual(validate(asking).answers,asking.answers);
 for(const question of blocks.find(b=>b.id==='working-it-out-or-asking-v1').questions){
  for(const [choice] of question.options){
   const data=askingSample();data.answers[question.id].values=[choice];assert.deepEqual(validate(data).answers,data.answers);
  }
 }
 const invalid=askingSample();invalid.answers.asking_factor.values=['try','person'];assert.throws(()=>validate(invalid),/Invalid choice/);
 invalid.answers.asking_factor.values=['not_an_asking_choice'];assert.throws(()=>validate(invalid),/Invalid choice/);
 const noExample=askingSample();for(const answer of Object.values(noExample.answers))answer.values=['no_example'];assert.equal(validate(noExample).completed,true);
});

test('Published block 21 remains unchanged and cannot be mixed with priority answers',()=>{
 const asking=askingSample(),saved=validate(asking);assert.equal(saved.blockId,'working-it-out-or-asking-v1');assert.equal(saved.blockVersion,1);assert.equal(saved.completed,true);assert.deepEqual(saved.answers,asking.answers);
 assert.throws(()=>validate({...asking,blockId:'own-priorities-v1'}),/Invalid answer/);
 assert.throws(()=>validate({...prioritiesSample(),blockId:'working-it-out-or-asking-v1'}),/Invalid answer/);
 const mixed=prioritiesSample();mixed.answers.asking_factor=asking.answers.asking_factor;assert.throws(()=>validate(mixed),/Invalid answer/);
});

test('Block 22 accepts each priority choice and rejects multiple or unknown option IDs',()=>{
 const priorities=prioritiesSample();assert.deepEqual(validate(priorities).answers,priorities.answers);
 for(const question of blocks.find(b=>b.id==='own-priorities-v1').questions){
  for(const [choice] of question.options){
   const data=prioritiesSample();data.answers[question.id].values=[choice];assert.deepEqual(validate(data).answers,data.answers);
  }
 }
 const invalid=prioritiesSample();invalid.answers.priority_topic.values=['interests','future'];assert.throws(()=>validate(invalid),/Invalid choice/);
 invalid.answers.priority_topic.values=['not_a_priority_choice'];assert.throws(()=>validate(invalid),/Invalid choice/);
});

test('Choosing no change, a pause, or uncertainty can explicitly finish block 22',()=>{
 for(const next of ['pause','think']){
  const data=prioritiesSample();data.answers.priority_topic.values=['no_change'];data.answers.priority_change.values=['no_change'];data.answers.priority_reason.values=['not_chosen'];data.answers.priority_next.values=[next];
  const saved=validate(data);assert.equal(saved.completed,true);assert.deepEqual(saved.answers,data.answers);
 }
 const unknown=prioritiesSample();for(const answer of Object.values(unknown.answers))answer.values=['unknown'];assert.equal(validate(unknown).completed,true);
 const undecided=prioritiesSample();undecided.answers.priority_topic.values=['undecided'];undecided.answers.priority_change.values=['no_topic'];undecided.answers.priority_reason.values=['not_chosen'];undecided.answers.priority_next.values=['undecided'];assert.equal(validate(undecided).completed,true);
});

test('Block 23 and the published block 22 keep separate answer schemas',()=>{
 const priorities=prioritiesSample();assert.equal(validate(priorities).completed,true);assert.deepEqual(validate(priorities).answers,priorities.answers);
 const leisure=leisureSample();assert.equal(validate(leisure).blockVersion,1);assert.deepEqual(validate(leisure).answers,leisure.answers);
 assert.throws(()=>validate({...leisure,blockId:'own-priorities-v1'}),/Invalid answer/);
 assert.throws(()=>validate({...priorities,blockId:'leisure-activity-choice-v1'}),/Invalid answer/);
 const mixed=leisureSample();mixed.answers.priority_next=priorities.answers.priority_next;assert.throws(()=>validate(mixed),/Invalid answer/);
});

test('Block 23 accepts combined interests or none alone, while every exclusive choice rejects combinations',()=>{
 const schema=blocks.find(b=>b.id==='leisure-activity-choice-v1'),ideas=schema.questions[0];
 const combined=leisureSample();combined.answers.leisure_ideas.values=['mystery','languages','story','echo','offscreen','other'];assert.deepEqual(validate(combined).answers,combined.answers);
 for(const exclusive of ['none','unknown','private']){
  const alone=leisureSample();alone.answers.leisure_ideas={values:[exclusive],text:'An optional comment',skipped:false};assert.deepEqual(validate(alone).answers,alone.answers);
  for(const other of [...ideas.options.map(option=>option[0]),'other','unknown','private'].filter(value=>value!==exclusive)){
   const contradictory=leisureSample();contradictory.answers.leisure_ideas.values=[exclusive,other];assert.throws(()=>validate(contradictory),/Exclusive choice/);
  }
 }
 for(const question of schema.questions){
  for(const [choice] of question.options){const data=leisureSample();data.answers[question.id].values=[choice];assert.deepEqual(validate(data).answers,data.answers);}
 }
 const multipleNext=leisureSample();multipleNext.answers.leisure_next.values=['example','pause'];assert.throws(()=>validate(multipleNext),/Invalid choice/);
 const incomplete=leisureSample();delete incomplete.answers.leisure_next;assert.throws(()=>validate(incomplete),/Incomplete finish/);assert.equal(validate({...incomplete,completed:false}).completed,false);
});
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
