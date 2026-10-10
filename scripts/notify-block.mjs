import {block} from '../questions.js';
const key=process.env.TELEGRAM_NOTIFY_KEY;
if(!key)throw Error('Notification key missing');
const r=await fetch('https://personal-guide-api.your-space.workers.dev/telegram/notify',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({blockId:block.id})});
const result=await r.json();
if(!r.ok)throw Error('Notification failed: '+(result.error||r.status));
console.log(JSON.stringify(result));
