import {block} from '../questions.js';
import {state,telegram,decode} from './telegram.js';
const headers=env=>({Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'compass'});
export const minskDate=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
async function completed(env){
 const root=`https://api.github.com/repos/${env.DATA_REPO}`;
 const r=await fetch(`${root}/git/trees/main?recursive=1`,{headers:headers(env)});if(!r.ok)throw Error('storage_unavailable');
 const tree=await r.json();if(tree.truncated)throw Error('incomplete_tree');
 const files=tree.tree.filter(f=>f.type==='blob'&&f.path.startsWith('participant/')&&f.path.endsWith(`/${block.id}.json`));
 for(const f of files){const res=await fetch(`${root}/contents/${f.path}`,{headers:headers(env)});if(!res.ok)throw Error('storage_unavailable');const value=decode((await res.json()).content);if(value.blockId===block.id&&value.completed===true)return true;}
 return false;
}
export async function notifyBlock(env,kind='publication',now=new Date()){
 if(!['publication','evening'].includes(kind))throw Error('invalid_kind');
 const participant=(await state(env,'participant')).value;
 if(!participant?.enabled)return {sent:false,reason:'disabled_or_unregistered'};
 if(!env.TELEGRAM_PARTICIPANT_ACCESS)throw Error('missing_access');
 // Verify the public site actually serves the same active block as the Worker.
 const site=await fetch('https://demonazgh.github.io/your-space/questions.js',{cache:'no-store'});
 if(!site.ok)throw Error('site_unavailable');
 const active=(await site.text()).match(/export const block\s*=\s*\{\s*id:\s*['"]([^'"]+)['"]/);
 if(active?.[1]!==block.id)throw Error('publication_not_ready');
 if(await completed(env))return {sent:false,reason:'completed'};
 const key=`deliveries/${block.id}-${kind==='publication'?'publication':minskDate(now)}`;
 const prior=await state(env,key);
 if(prior.value){if(prior.value.status==='sent')return {sent:false,reason:'already_sent'};throw Error('delivery_requires_review');}
 // Atomic create claims this delivery before Telegram is called. Never automatically
 // retry an uncertain send: Telegram sendMessage has no idempotency key.
 const claim={blockId:block.id,kind,status:'claimed',createdAt:now.toISOString()};
 await state(env,key,claim);
 // Recheck opt-out immediately before sending.
 if(!(await state(env,'participant')).value?.enabled)return {sent:false,reason:'disabled'};
 const text=kind==='publication'?`Готов новый блок 🧭\n${block.label[0]}\nЧетыре коротких вопроса. Можно ответить, когда будет удобно.\nОтключить уведомления: /stop.`:`Небольшое напоминание 🧭\n${block.label[0]} ещё можно пройти. Если сейчас неудобно, вернись позже.\nОтключить уведомления: /stop.`;
 const result=await telegram(env,'sendMessage',{chat_id:participant.chatId,text,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:'Открыть блок',url:`https://demonazgh.github.io/your-space/#access=${env.TELEGRAM_PARTICIPANT_ACCESS}&mode=participant`}]]}});
 const current=await state(env,key);
 await state(env,key,{...claim,status:'sent',sentAt:new Date().toISOString(),messageId:result.message_id},current.sha);
 return {sent:true,blockId:block.id,messageId:result.message_id};
}
