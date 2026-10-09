import {block} from '../questions.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function matches(a,b){if(typeof a!=='string'||typeof b!=='string'||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function telegram(env,method,body={}){
 const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok||!data.ok)throw Error('telegram_failed');return data.result;
}
function encode(x){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(x))));}
function decode(x){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(x.replace(/\n/g,'')),c=>c.charCodeAt(0))));}
async function state(env,role,value,sha){
 const url=`https://api.github.com/repos/${env.DATA_REPO}/contents/compass/${role}.json`;
 const headers={Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'compass','Content-Type':'application/json'};
 const r=await fetch(url,{headers,...(value?{method:'PUT',body:JSON.stringify({message:'Update Compass registration',content:encode(value),...(sha?{sha}:{})})}:{})});
 if(!value&&r.status===404)return {value:null};if(!r.ok)throw Error('storage_failed');const f=await r.json();return value?{}:{value:decode(f.content),sha:f.sha};
}
export async function handleTelegram(request,env){
 const path=new URL(request.url).pathname;
 if(request.method!=='POST')return json({error:'not_found'},404);
 if(path==='/telegram/setup'){
  if(!matches(request.headers.get('Authorization'),`Bearer ${env.TELEGRAM_SETUP_KEY||''}`)||!env.TELEGRAM_SETUP_KEY)return json({error:'unauthorized'},401);
  try{
   const me=await telegram(env,'getMe');if(me.username!=='ArtsiomCompassBot')return json({error:'unexpected_bot'},409);
   await telegram(env,'setWebhook',{url:'https://personal-guide-api.your-space.workers.dev/telegram/webhook',secret_token:env.TELEGRAM_WEBHOOK_SECRET,max_connections:1,allowed_updates:['message']});
   await telegram(env,'setMyCommands',{commands:[{command:'start',description:'Начать / Start'},{command:'guide',description:'Открыть путеводитель'},{command:'status',description:'Статус подключения'},{command:'stop',description:'Отключить уведомления'},{command:'resume',description:'Включить уведомления'},{command:'help',description:'Помощь'}]});
   const hook=await telegram(env,'getWebhookInfo');return json({ok:true,username:me.username,webhook:hook.url,pending:hook.pending_update_count});
  }catch{return json({error:'setup_failed'},502);}
 }
 if(path!=='/telegram/webhook')return json({error:'not_found'},404);
 if(!matches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env.TELEGRAM_WEBHOOK_SECRET))return json({error:'unauthorized'},401);
 let update;try{const raw=await request.text();if(raw.length>20000)return json({error:'too_large'},413);update=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
 const m=update.message;
 if(!Number.isSafeInteger(update.update_id)||!m||m.chat?.type!=='private'||m.from?.is_bot||m.from?.id!==m.chat?.id||typeof m.text!=='string')return json({ok:true});
 const [command,arg]=m.text.trim().split(/\s+/,2);const cmd=command.split('@')[0];
 try{
  const admin=await state(env,'admin'),participant=await state(env,'participant');
  let role=admin.value?.chatId===m.chat.id?'admin':participant.value?.chatId===m.chat.id?'participant':null;
  let record=role==='admin'?admin:participant;
  if(!role&&cmd==='/start'){
   role=matches(arg,env.TELEGRAM_ADMIN_INVITE)?'admin':matches(arg,env.TELEGRAM_PARTICIPANT_INVITE)?'participant':null;
   if(role){record=role==='admin'?admin:participant;if(record.value)role=null;}
   if(role){record.value={chatId:m.chat.id,enabled:true,registeredAt:new Date().toISOString(),lastUpdate:-1};}
  }
  // Unknown accounts receive no messages and cannot access private links or register without an invitation.
  if(!role)return json({ok:true});
  if((record.value.lastUpdate??-1)>=update.update_id)return json({ok:true});
  let text,markup;
  if(cmd==='/stop'){record.value.enabled=false;text='Уведомления отключены. Включить снова: /resume.';}
  else if(cmd==='/resume'){record.value.enabled=true;text='Уведомления включены. Отключить: /stop.';}
  else if(cmd==='/guide'){
   const token=role==='admin'?env.TELEGRAM_TEST_ACCESS:env.TELEGRAM_PARTICIPANT_ACCESS;
   if(!token)throw Error('missing_access');
   text=`${block.label[0]}. Можно ответить, когда будет удобно.`;
   markup={inline_keyboard:[[{text:'Открыть путеводитель',url:`https://demonazgh.github.io/your-space/#access=${token}&mode=${role==='admin'?'test':'participant'}`}]]};
  }else if(cmd==='/status')text=`Compass подключён. Роль: ${role==='admin'?'администратор':'участник'}. Уведомления: ${record.value.enabled?'включены':'отключены'}.\nСейчас проверяем подключение. Автоуведомления и события ещё не настроены.`;
  else text=`Привет! Я Compass 🧭 — бот персонального путеводителя. ${role==='admin'?'Твой аккаунт подключён как администратор.':'Ты подключён по личному приглашению.'}\n/guide — открыть путеводитель${role==='admin'?' в тестовом режиме':''}\n/status — статус\n/stop — отключить уведомления\n/resume — включить снова\nСейчас проверяем подключение; напоминания о событиях ещё не настроены. Telegram ID и настройки сохраняются на сервере Cloudflare и в приватном хранилище Дмитрия. Ответы на анкету здесь не показываются.`;
  // Persist before replying so retried Telegram updates cannot repeat registration or commands.
  record.value.lastUpdate=update.update_id;await state(env,role,record.value,record.sha);
  await telegram(env,'sendMessage',{chat_id:m.chat.id,text,link_preview_options:{is_disabled:true},...(markup?{reply_markup:markup}:{})});
  return json({ok:true});
 }catch{return json({error:'temporary_failure'},503);}
}
