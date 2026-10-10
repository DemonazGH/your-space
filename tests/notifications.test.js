import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyBlock,minskDate} from '../worker/notifications.js';
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
