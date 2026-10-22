import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTelegram} from '../worker/telegram.js';
import {block} from '../questions.js';
const env={TELEGRAM_WEBHOOK_SECRET:'hook',TELEGRAM_SETUP_KEY:'setup',TELEGRAM_ADMIN_INVITE:'invite',GITHUB_TOKEN:'fake',DATA_REPO:'owner/private',TELEGRAM_BOT_TOKEN:'fake'};
const req=(id,text,secret='hook',type='private')=>new Request('https://host/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify({update_id:id,message:{chat:{id:123,type},from:{id:123},text}})});
test('Telegram rejects forged webhook and setup without network calls',async()=>{assert.equal((await handleTelegram(req(1,'/start invite','wrong'),env)).status,401);assert.equal((await handleTelegram(new Request('https://host/telegram/setup',{method:'POST'}),env)).status,401);});
test('Telegram private invitation, duplicate update, stop and occupied role',async()=>{
 const old=globalThis.fetch;let saved=null,sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(url.includes('api.telegram.org')){sent.push(JSON.parse(opts.body));return Response.json({ok:true,result:{}});}
  if(url.includes('/participant.json'))return new Response('',{status:404});
  if(opts.method==='PUT'){saved=JSON.parse(Buffer.from(JSON.parse(opts.body).content,'base64').toString());return Response.json({});}
  return saved?Response.json({sha:'sha',content:Buffer.from(JSON.stringify(saved)).toString('base64')}):new Response('',{status:404});
 };
 try{
  assert.equal((await handleTelegram(req(1,'/start bad'),env)).status,200);assert.equal(saved,null);assert.equal(sent.length,0);
  await handleTelegram(req(2,'/start invite','hook','group'),env);assert.equal(saved,null);
  await handleTelegram(req(3,'/start invite'),env);assert.equal(saved.chatId,123);assert.equal(sent.length,1);
  await handleTelegram(req(3,'/start invite'),env);assert.equal(sent.length,1);
  await handleTelegram(req(4,'/stop'),env);assert.equal(saved.enabled,false);
  const other=new Request('https://host/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'hook'},body:JSON.stringify({update_id:5,message:{chat:{id:456,type:'private'},from:{id:456},text:'/start invite'}})});
  await handleTelegram(other,env);assert.equal(saved.chatId,123);assert.equal(sent.length,2);
 }finally{globalThis.fetch=old;}
});

test('Telegram guide versions the page while keeping role-specific access only in the fragment',async()=>{
 const original=globalThis.fetch;
 const credentials={...env,TELEGRAM_TEST_ACCESS:'a'.repeat(64),TELEGRAM_PARTICIPANT_ACCESS:'b'.repeat(64)};
 try{
  for(const role of ['admin','participant']){
   const sent=[],records={admin:{chatId:role==='admin'?123:456,enabled:true,lastUpdate:-1},participant:{chatId:role==='participant'?123:456,enabled:true,lastUpdate:-1}};
   globalThis.fetch=async(url,options={})=>{
    if(url.includes('api.telegram.org')){sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{}});}
    const key=url.match(/\/compass\/(admin|participant)\.json$/)?.[1];assert.ok(key);
    if(options.method==='PUT'){records[key]=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64'));return Response.json({});}
    return Response.json({sha:key,content:Buffer.from(JSON.stringify(records[key])).toString('base64')});
   };
   assert.equal((await handleTelegram(req(1,'/guide'),credentials)).status,200);assert.equal(sent.length,1);
   const link=new URL(sent[0].reply_markup.inline_keyboard[0][0].url),fragment=new URLSearchParams(link.hash.slice(1));
   assert.equal(link.origin,'https://demonazgh.github.io');assert.equal(link.pathname,'/your-space/');
   assert.equal(link.searchParams.get('block'),block.id);assert.deepEqual([...link.searchParams.keys()],['block']);
   assert.equal(link.searchParams.has('access'),false);assert.equal(link.search.includes(credentials.TELEGRAM_TEST_ACCESS),false);assert.equal(link.search.includes(credentials.TELEGRAM_PARTICIPANT_ACCESS),false);
   assert.equal(fragment.get('access'),role==='admin'?credentials.TELEGRAM_TEST_ACCESS:credentials.TELEGRAM_PARTICIPANT_ACCESS);
   assert.equal(fragment.get('mode'),role==='admin'?'test':'participant');
  }
 }finally{globalThis.fetch=original;}
});
