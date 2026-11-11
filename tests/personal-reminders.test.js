import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePersonalReminderCallback,runPersonalReminders} from '../worker/personal-reminders.js';

const settings={
 standalone:{cron:'15 5 * * MON-FRI',text:'First example'},
 primary:{cron:'40 20 * * *',text:'Second example',buttonText:'Done'},
 followUp:{cron:'55 20 * * *',text:'Third example'}
};
const storageKey='personal-reminders/current.json';
const at=(date,time)=>new Date(date+'T'+time+':00Z');
const monday='2026-11-16';
const tuesday='2026-11-17';

function fixture(){
 const original=globalThis.fetch;
 const env={DATA_REPO:'owner/private',GITHUB_TOKEN:'fake',TELEGRAM_BOT_TOKEN:'fake',COMPASS_PERSONAL_REMINDERS:JSON.stringify(settings)};
 const records=new Map(),sent=[],acknowledgements=[];
 let revision=0,reads=0;
 const controls={onSave:null,onSend:null,failSend:false};
 const save=(key,value)=>records.set(key,{sha:String(++revision),value:structuredClone(value)});
 save('participant.json',{chatId:123,enabled:true});
 save('admin.json',{chatId:456,enabled:true});
 globalThis.fetch=async(url,request={})=>{
  if(url.startsWith('https://api.telegram.org/')){
   const body=JSON.parse(request.body),method=url.split('/').at(-1);
   if(method==='answerCallbackQuery'){
    acknowledgements.push(body);
    return Response.json({ok:true,result:true});
   }
   assert.equal(method,'sendMessage');
   const messageId=sent.length+1;
   sent.push(body);
   await controls.onSend?.(body,messageId);
   return controls.failSend?Response.json({ok:false},{status:503}):Response.json({ok:true,result:{message_id:messageId}});
  }
  const key=url.split('/contents/compass/')[1];
  assert.ok(key);
  const prior=records.get(key);
  if(request.method==='PUT'){
   const {sha,content}=JSON.parse(request.body);
   if(prior?.sha!==sha)return new Response('',{status:409});
   const value=JSON.parse(Buffer.from(content,'base64').toString('utf8'));
   save(key,value);
   await controls.onSave?.(key,value);
   return Response.json({});
  }
  reads++;
  return prior?Response.json({sha:prior.sha,content:Buffer.from(JSON.stringify(prior.value)).toString('base64')}):new Response('',{status:404});
 };
 const run=(kind,day,time,now=at(day,time),cron=settings[kind].cron)=>
  runPersonalReminders(env,{cron,scheduledTime:at(day,time).getTime()},now);
 const press=(body,messageId,now,overrides={})=>handlePersonalReminderCallback(env,{
  id:'test-query',data:body.reply_markup.inline_keyboard[0][0].callback_data,
  from:{id:123,is_bot:false},message:{message_id:messageId,chat:{id:123,type:'private'}},...overrides
 },now);
 return {env,sent,acknowledgements,controls,run,press,save,get reads(){return reads;},
  current:()=>records.get(storageKey)?.value,restore:()=>{globalThis.fetch=original;}};
}

test('Only the exact configured weekday slot sends a standalone reminder',async()=>{
 const h=fixture();
 try{
  for(const [date,time,now] of [
   [monday,'05:14'],
   ['2026-11-21','05:15'],
   ['2026-11-22','05:15'],
   [monday,'05:15',at(tuesday,'05:15')]
  ])assert.deepEqual(await h.run('standalone',date,time,now),{sent:false});
  assert.deepEqual(await h.run('standalone',monday,'05:15',undefined,'0 18 * * *'),{sent:false});
  assert.equal(h.reads,0);
  assert.deepEqual(await h.run('standalone',monday,'05:15'),{sent:true});
  assert.deepEqual(await h.run('standalone',monday,'05:15'),{sent:false});
  assert.deepEqual(await h.run('standalone','2026-11-20','05:15'),{sent:true});
  assert.deepEqual(h.sent,[{chat_id:123,text:settings.standalone.text},{chat_id:123,text:settings.standalone.text}]);
 }finally{h.restore();}
});

test('The follow-up needs a confirmed primary delivery from the same Minsk day and sends at most once',async()=>{
 const h=fixture();
 try{
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.deepEqual(await h.run('primary',monday,'20:40'),{sent:true});
  const primary=h.sent[0],button=primary.reply_markup.inline_keyboard[0][0];
  assert.equal(primary.chat_id,123);assert.equal(primary.text,settings.primary.text);
  assert.equal(button.text,settings.primary.buttonText);
  assert.ok(Buffer.byteLength(button.callback_data)<=64);
  assert.deepEqual(await h.run('primary',monday,'20:40'),{sent:false});
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:true});
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.deepEqual(await h.run('followUp',tuesday,'20:55'),{sent:false});
  assert.deepEqual(h.sent[1],{chat_id:123,text:settings.followUp.text});
  assert.equal(h.sent.length,2);
 }finally{h.restore();}
});

test('A private callback binds to the participant, day, button and message and records completion once',async()=>{
 const h=fixture();
 try{
  await h.run('primary',monday,'20:40');
  const primary=h.sent[0],now=at(monday,'20:41');
  await h.press(primary,1,now,{from:{id:456,is_bot:false},message:{message_id:1,chat:{id:456,type:'private'}}});
  await h.press(primary,1,now,{message:{message_id:1,chat:{id:123,type:'group'}}});
  assert.equal(h.acknowledgements.length,0);
  await h.press(primary,2,now);
  await h.press(primary,1,now,{data:'compass:done:'+monday+':'+('a'.repeat(36))});
  await h.press(primary,1,at(monday,'21:01'));
  assert.equal(h.current().done,undefined);
  assert.ok(h.acknowledgements.every(value=>!value.text));
  await h.press(primary,1,now);
  await h.press(primary,1,now);
  assert.equal(h.current().done,true);
  assert.deepEqual(h.acknowledgements.slice(-2),Array(2).fill({callback_query_id:'test-query',text:'Отмечено'}));
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.equal(h.sent.length,1);
  await h.run('primary',tuesday,'20:40');
  assert.equal(h.current().day,tuesday);
  assert.equal(h.current().done,undefined);
  assert.deepEqual(await h.run('followUp',tuesday,'20:55'),{sent:true});
 }finally{h.restore();}
});

test('Registration, opt-out and admin role guard delivery, including an opt-out after claiming',async()=>{
 const h=fixture();
 try{
  h.save('participant.json',{chatId:123,enabled:false});
  assert.deepEqual(await h.run('standalone',monday,'05:15'),{sent:false});
  h.save('participant.json',{chatId:456,enabled:true});
  assert.deepEqual(await h.run('standalone',monday,'05:15'),{sent:false});
  h.save('participant.json',{chatId:123,enabled:true});
  h.controls.onSave=(key)=>{if(key===storageKey)h.save('participant.json',{chatId:123,enabled:false});};
  assert.deepEqual(await h.run('standalone',monday,'05:15'),{sent:false});
  assert.equal(h.sent.length,0);
 }finally{h.restore();}
});

test('Concurrent delivery claims and an uncertain send do not deliver duplicates',async()=>{
 const h=fixture();
 try{
  const first=await Promise.all([h.run('standalone',monday,'05:15'),h.run('standalone',monday,'05:15')]);
  assert.equal(first.filter(result=>result.sent).length,1);
  h.controls.failSend=true;
  await assert.rejects(h.run('primary',monday,'20:40'),/telegram_failed/);
  h.controls.failSend=false;
  assert.deepEqual(await h.run('primary',monday,'20:40'),{sent:false});
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.equal(h.sent.length,2);
 }finally{h.restore();}
});

test('A fast button tap survives the primary delivery acknowledgement and suppresses the follow-up',async()=>{
 const h=fixture();
 try{
  h.controls.onSend=(body,id)=>h.press(body,id,at(monday,'20:40'));
  assert.deepEqual(await h.run('primary',monday,'20:40'),{sent:true});
  assert.equal(h.current().primary.messageId,1);
  assert.equal(h.current().done,true);
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.equal(h.sent.length,1);
 }finally{h.restore();}
});

test('Completion saved during a follow-up claim is rechecked before sending',async()=>{
 const h=fixture();
 try{
  await h.run('primary',monday,'20:40');
  h.controls.onSave=async(key,record)=>{
   if(key===storageKey&&record.followUp==='claimed'&&!record.done)await h.press(h.sent[0],1,at(monday,'20:55'));
  };
  assert.deepEqual(await h.run('followUp',monday,'20:55'),{sent:false});
  assert.equal(h.current().done,true);
  assert.equal(h.sent.length,1);
 }finally{h.restore();}
});
