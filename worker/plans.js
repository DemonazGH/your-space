import {state as registration,decode} from './telegram.js';

const encoder=new TextEncoder();
const timeZone='Europe/Minsk';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
class PlansError extends Error{constructor(status,code){super(code);this.status=status;}}
const fail=(status,code)=>{throw new PlansError(status,code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const onlyKeys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));

async function hmac(key,message){
 const imported=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',imported,encoder.encode(message)));
}
export async function validateInitData(raw,botToken,now=Math.floor(Date.now()/1000)){
 if(typeof raw!=='string'||!raw||encoder.encode(raw).length>8192||!botToken)fail(401,'unauthorized');
 const params=new URLSearchParams(raw),seen=new Set();
 for(const [key] of params){if(seen.has(key))fail(401,'unauthorized');seen.add(key);}
 const hash=params.get('hash'),date=params.get('auth_date');
 if(!/^[a-f0-9]{64}$/i.test(hash||'')||!/^[1-9]\d*$/.test(date||''))fail(401,'unauthorized');
 const issued=Number(date);
 if(!Number.isSafeInteger(issued)||now-issued>86400||issued-now>60)fail(401,'unauthorized');
 // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 // Bot-token HMAC excludes only hash. Telegram's signature field, when present,
 // remains signed; excluding signature applies to the separate Ed25519 method.
 const check=[...params.keys()].filter(key=>key!=='hash').sort().map(key=>`${key}=${params.get(key)}`).join('\n');
 const secret=await hmac(encoder.encode('WebAppData'),botToken),expected=await hmac(secret,check);
 const received=Uint8Array.from(hash.match(/../g),byte=>parseInt(byte,16));
 let difference=0;for(let index=0;index<expected.length;index++)difference|=expected[index]^received[index];
 if(difference)fail(401,'unauthorized');
 let user;try{user=JSON.parse(params.get('user'));}catch{fail(401,'unauthorized');}
 if(!object(user)||!Number.isSafeInteger(user.id)||user.id<1||!(user.is_bot===undefined||user.is_bot===false))fail(401,'unauthorized');
 return user.id;
}

function eventFields(value){
 if(typeof value.title!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(value.title))fail(400,'invalid_event');
 const title=value.title.trim();
 if(!title||title.length>140||typeof value.date!=='string'||typeof value.time!=='string')fail(400,'invalid_event');
 const parts=value.date.match(/^(\d{4})-(\d{2})-(\d{2})$/),date=new Date(value.date+'T00:00:00.000Z');
 if(!parts||Number(parts[1])<1||!Number.isFinite(date.getTime())||date.getUTCFullYear()!==Number(parts[1])||date.getUTCMonth()+1!==Number(parts[2])||date.getUTCDate()!==Number(parts[3])||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))fail(400,'invalid_event');
 return {title,date:value.date,time:value.time};
}
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function storedRecord(value){
 if(!onlyKeys(value,['schemaVersion','revision','consent','events'])||value.schemaVersion!==1||value.consent!==true||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.events)||value.events.length>200)throw Error('invalid_store');
 const ids=new Set();
 for(const event of value.events){
  if(!onlyKeys(event,['id','title','date','time','createdAt','updatedAt','deletedAt'])||!uuid.test(event.id)||ids.has(event.id)||!timestamp(event.createdAt)||!timestamp(event.updatedAt)||('deletedAt' in event&&!timestamp(event.deletedAt)))throw Error('invalid_store');
  const fields=eventFields(event);if(fields.title!==event.title)throw Error('invalid_store');ids.add(event.id);
 }
 return value;
}
const githubHeaders=env=>({Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'personal-guide-plans','X-GitHub-Api-Version':'2022-11-28'});
const fileUrl=(env,mode)=>`https://api.github.com/repos/${env.DATA_REPO}/contents/plans/${mode}/events.json`;
async function readStore(env,mode){
 const response=await fetch(fileUrl(env,mode),{headers:githubHeaders(env)});
 if(response.status===404)return {record:{schemaVersion:1,revision:0,consent:false,events:[]}};
 if(!response.ok)throw Error('storage_failed');
 const file=await response.json();
 if(typeof file.sha!=='string'||!file.sha||typeof file.content!=='string'||file.content.length>300000)throw Error('invalid_store');
 return {sha:file.sha,record:storedRecord(decode(file.content))};
}
function encode(value){
 let text='';for(const byte of encoder.encode(JSON.stringify(value,null,2)))text+=String.fromCharCode(byte);
 return btoa(text);
}
async function writeStore(env,mode,record,sha){
 const response=await fetch(fileUrl(env,mode),{method:'PUT',headers:githubHeaders(env),body:JSON.stringify({message:`Update ${mode} plans`,content:encode(record),...(sha?{sha}:{})})});
 if(response.status===409||response.status===422)fail(409,'conflict');
 if(!response.ok)throw Error('storage_failed');
}
function snapshot(record,mode){
 return {mode,revision:record.revision,consent:record.consent,timeZone,events:record.events.filter(event=>!event.deletedAt).map(({id,title,date,time,createdAt,updatedAt})=>({id,title,date,time,createdAt,updatedAt})).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id))};
}
async function jsonBody(request){
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(400,'invalid_event');
 const advertised=request.headers.get('Content-Length');if(advertised&&(!/^\d+$/.test(advertised)||Number(advertised)>4096))fail(413,'too_large');
 if(!request.body)fail(400,'invalid_event');
 const reader=request.body.getReader(),chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();fail(413,'too_large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_event');}
}

export async function handlePlans(request,env){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'};
 const reply=(status,value)=>new Response(value===null?null:JSON.stringify(value),{status,headers});
 if(!env.ALLOWED_ORIGIN||request.headers.get('Origin')!==env.ALLOWED_ORIGIN)return reply(403,{error:'forbidden'});
 headers['Access-Control-Allow-Origin']=env.ALLOWED_ORIGIN;
 if(request.method==='OPTIONS'){
  headers['Access-Control-Allow-Methods']='GET, POST, PATCH, DELETE, OPTIONS';headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Max-Age']='600';
  return reply(204,null);
 }
 const path=new URL(request.url).pathname,match=path.match(/^\/plans\/events\/([^/]+)(\/restore)?$/);
 const operation=path==='/plans'&&request.method==='GET'?'read':path==='/plans/events'&&request.method==='POST'?'create':match&&request.method==='POST'&&match[2]?'restore':match&&!match[2]&&request.method==='PATCH'?'edit':match&&!match[2]&&request.method==='DELETE'?'delete':null;
 if(!operation)return reply(404,{error:'not_found'});
 if(match&&!uuid.test(match[1]))return reply(400,{error:'invalid_event'});
 if(!env.GITHUB_TOKEN||!env.TELEGRAM_BOT_TOKEN||!env.DATA_REPO)return reply(503,{error:'storage_unavailable'});
 try{
  const auth=request.headers.get('Authorization')?.match(/^tma (.+)$/i);
  if(!auth)fail(401,'unauthorized');
  const id=await validateInitData(auth[1],env.TELEGRAM_BOT_TOKEN);
  const [admin,participant]=await Promise.all([registration(env,'admin'),registration(env,'participant')]);
  // An administrator can only use the test namespace, even if bindings overlap.
  const mode=admin.value?.chatId===id?'test':participant.value?.chatId===id?'participant':null;
  if(!mode)fail(403,'forbidden');
  if(env.SAVE_LIMITER&&!(await env.SAVE_LIMITER.limit({key:`plans:${mode}`})).success)fail(429,'retry_later');
  let input,fields;
  if(operation!=='read'){
   input=await jsonBody(request);
   const keys=operation==='create'||operation==='edit'?['revision','consent','title','date','time']:['revision','consent'];
   if(!onlyKeys(input,keys)||input.consent!==true||!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'invalid_event');
   if(operation==='create'||operation==='edit')fields=eventFields(input);
  }
  let loaded;try{loaded=await readStore(env,mode);}catch{fail(503,'storage_unavailable');}
  const {record,sha}=loaded;
  if(operation==='read')return reply(200,snapshot(record,mode));
  if(input.revision!==record.revision||record.revision>=Number.MAX_SAFE_INTEGER)fail(409,'conflict');
  const now=new Date().toISOString();
  if(operation==='create'){
   if(record.events.length>=200)fail(400,'limit_reached');
   record.events.push({id:crypto.randomUUID(),...fields,createdAt:now,updatedAt:now});
  }else{
   const event=record.events.find(event=>event.id===match[1]);
   if(!event||event.deletedAt&&operation!=='restore')fail(404,'not_found');
   if(operation==='restore'){if(!event.deletedAt)fail(409,'conflict');delete event.deletedAt;}
   else if(operation==='delete')event.deletedAt=now;
   else Object.assign(event,fields);
   event.updatedAt=now;
  }
  record.revision++;record.consent=true;
  await writeStore(env,mode,record,sha);
  return reply(200,snapshot(record,mode));
 }catch(error){return reply(error instanceof PlansError?error.status:503,{error:error instanceof PlansError?error.message:'storage_unavailable'});}
}
