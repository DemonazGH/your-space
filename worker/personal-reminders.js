import {state,telegram} from './telegram.js';

const stateKey='personal-reminders/current';
const reminderKinds=['standalone','primary','followUp'];
const weekdays=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const weekdayPattern='(?:[1-7]|'+weekdays.join('|')+')';
const cronPattern=new RegExp(String.raw`^([0-5]?\d) ([01]?\d|2[0-3]) \* \* (\*|${weekdayPattern})(?:-(${weekdayPattern}))?$`);
const minskCalendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'});
const callbackPattern=/^compass:done:(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36})$/;
const validId=value=>Number.isSafeInteger(value)&&value>0;

function normalizeCron(value){
 return typeof value==='string'?value.trim().toUpperCase().replace(/\s+/g,' '):'';
}

function weekdayIndex(value){
 return value.length===1?Number(value)-1:weekdays.indexOf(value);
}

function parseCron(value){
 const cron=normalizeCron(value),match=cron.match(cronPattern);
 if(!match)return null;
 const [,minute,hour,first,last]=match;
 if(first==='*'&&last)return null;
 const firstDay=first==='*'?0:weekdayIndex(first);
 const lastDay=first==='*'?6:last?weekdayIndex(last):firstDay;
 return firstDay<=lastDay?{cron,minute:Number(minute),hour:Number(hour),firstDay,lastDay}:null;
}

function selectReminder(env,cron){
 if(!env.COMPASS_PERSONAL_REMINDERS)return null;
 let config;
 try{config=JSON.parse(env.COMPASS_PERSONAL_REMINDERS);}catch{throw Error('personal_reminders_config');}
 const schedules=new Set();
 let selected;
 for(const kind of reminderKinds){
  const reminder=config?.[kind],schedule=parseCron(reminder?.cron);
  if(!schedule||schedules.has(schedule.cron)||typeof reminder.text!=='string'||!reminder.text.trim()||reminder.text.length>4096||
     (kind==='primary'&&(typeof reminder.buttonText!=='string'||!reminder.buttonText.trim())))throw Error('personal_reminders_config');
  schedules.add(schedule.cron);
  if(schedule.cron===cron)selected={kind,reminder,schedule};
 }
 return selected;
}

async function participant(env){
 const [registration,admin]=await Promise.all([state(env,'participant'),state(env,'admin')]);
 const person=registration.value;
 return validId(person?.chatId)&&person.chatId!==admin.value?.chatId?person:null;
}

// A single record rolls over at the start of a new Minsk day. GitHub's SHA
// protects both delivery claims and completion from overwriting concurrent work.
async function updateDay(env,change){
 let current=await state(env,stateKey);
 for(let attempt=0;attempt<3;attempt++){
  const next=change(current.value);
  if(!next)return {written:false,value:current.value};
  try{
   await state(env,stateKey,next,current.sha);
   return {written:true,value:next};
  }catch(error){
   if(attempt===2)throw error;
   const latest=await state(env,stateKey);
   if(latest.sha===current.sha)throw error;
   current=latest;
  }
 }
}

export async function runPersonalReminders(env,controller,now=new Date()){
 const job=selectReminder(env,normalizeCron(controller?.cron));
 if(!job)return {sent:false};
 const {kind,reminder,schedule}=job;
 const when=new Date(controller.scheduledTime),weekday=when.getUTCDay();
 if(when.getUTCHours()!==schedule.hour||when.getUTCMinutes()!==schedule.minute||weekday<schedule.firstDay||weekday>schedule.lastDay)return {sent:false};
 const day=minskCalendar.format(when);
 if(day!==minskCalendar.format(now))return {sent:false};

 const person=await participant(env);
 if(person?.enabled!==true)return {sent:false};
 const {chatId}=person;
 // A callback may arrive before Telegram's response has been saved. The
 // random button token ties that callback to the claimed delivery even then.
 const marker=kind==='primary'?{token:crypto.randomUUID()}:'claimed';
 const claim=await updateDay(env,record=>{
  if(record&&record.day>day)return null;
  const current=record?.day===day?record:{day,chatId};
  if(current.chatId!==chatId||current[kind]!==undefined)return null;
  if(kind==='followUp'&&(!validId(current.primary?.messageId)||current.done===true))return null;
  return {...current,[kind]:marker};
 });
 if(!claim.written)return {sent:false};

 const latest=await participant(env);
 if(latest?.enabled!==true||latest.chatId!==chatId)return {sent:false};
 if(kind==='followUp'){
  const {value:current}=await state(env,stateKey);
  if(current?.day!==day||current.chatId!==chatId||current.done===true)return {sent:false};
 }

 // Telegram does not provide an idempotency key for sendMessage. Keep a claim
 // when the outcome is unknown so retries cannot send another copy.
 const message=await telegram(env,'sendMessage',{
  chat_id:chatId,text:reminder.text,
  ...(kind==='primary'?{reply_markup:{inline_keyboard:[[{text:reminder.buttonText,callback_data:`compass:done:${day}:${marker.token}`}]]}}:{})
 });
 if(!validId(message?.message_id))throw Error('personal_reminders_delivery');
 await updateDay(env,current=>{
  if(current?.day!==day||current.chatId!==chatId)return null;
  if(kind==='primary'){
   if(current.primary?.token!==marker.token||current.primary.messageId!==undefined)return null;
   return {...current,primary:{...marker,messageId:message.message_id}};
  }
  return current[kind]==='claimed'?{...current,[kind]:'sent'}:null;
 });
 return {sent:true};
}

export async function handlePersonalReminderCallback(env,callback,now=new Date()){
 const match=typeof callback?.data==='string'&&callback.data.match(callbackPattern);
 const chat=callback?.message?.chat,from=callback?.from,messageId=callback?.message?.message_id;
 if(!match||typeof callback.id!=='string'||!callback.id||chat?.type!=='private'||from?.is_bot!==false||
    !validId(chat.id)||chat.id!==from.id||!validId(messageId))return;

 const person=await participant(env);
 if(person?.chatId!==chat.id)return;
 const [,day,token]=match;
 let confirmed=false;
 if(person.enabled===true&&day===minskCalendar.format(now)){
  const matchesMessage=record=>record?.day===day&&record.chatId===chat.id&&record.primary?.token===token&&
   (record.primary.messageId===undefined||record.primary.messageId===messageId);
  const {value}=await updateDay(env,record=>matchesMessage(record)&&record.done!==true?{...record,done:true}:null);
  confirmed=matchesMessage(value)&&value.done===true;
 }
 // The acknowledgement appears only to the user who tapped the button.
 // Its expiry cannot undo an already stored confirmation.
 await telegram(env,'answerCallbackQuery',{callback_query_id:callback.id,...(confirmed?{text:'Отмечено'}:{})}).catch(()=>{});
}
