import {block} from '../questions.js';

export async function tokenHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b) { if(typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0; }
export function validate(x) {
  if(!x || x.schemaVersion!==1 || x.blockId!==block.id || x.consent!==true || !['ru','en'].includes(x.language))throw Error('Invalid envelope');
  if(!/^[a-f0-9-]{36}$/.test(x.sessionId)||!Number.isSafeInteger(x.revision)||x.revision<1||typeof x.completed!=='boolean')throw Error('Invalid session');
  if(!x.answers||Array.isArray(x.answers)||typeof x.answers!=='object')throw Error('Invalid answers');
  const answers={};
  for(const [id,a] of Object.entries(x.answers)) {
    const q=block.questions.find(q=>q.id===id);
    if(!q||!a||!Array.isArray(a.values)||typeof a.text!=='string'||a.text.length>1200||typeof a.skipped!=='boolean')throw Error('Invalid answer');
    const valid=new Set([...q.options.map(o=>o[0]),'other','unknown','private']);
    if(a.values.some(v=>!valid.has(v))||new Set(a.values).size!==a.values.length||a.values.length>(q.type==='multi'?valid.size:1))throw Error('Invalid choice');
    if(a.values.length>1&&a.values.some(v=>['unknown','private'].includes(v)))throw Error('Exclusive choice');
    if(a.skipped&&(a.values.length||a.text.trim()))throw Error('Invalid skip');
    answers[id]={values:a.values,text:a.text,skipped:a.skipped};
  }
  return {schemaVersion:1,blockId:block.id,blockVersion:block.version,sessionId:x.sessionId,revision:x.revision,language:x.language,completed:x.completed,consent:true,answers};
}
function base64(s){const bytes=new TextEncoder().encode(s);let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text);}
function decode64(s){return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g,'')),c=>c.charCodeAt(0)));}

export default {
 async fetch(request,env) {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  const origin=request.headers.get('Origin');
  if(origin!==env.ALLOWED_ORIGIN)return reply(403,{error:'origin_denied'});
  headers['Access-Control-Allow-Origin']=origin;
  if(request.method==='OPTIONS') {
    headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Max-Age']='600';
    return new Response(null,{status:204,headers});
  }
  if(new URL(request.url).pathname!=='/answers'||request.method!=='POST')return reply(404,{error:'not_found'});
  if(!env.GITHUB_TOKEN)return reply(503,{error:'not_configured'});
  const auth=request.headers.get('Authorization')||'';
  if(!/^Bearer [a-f0-9]{64}$/.test(auth))return reply(401,{error:'unauthorized'});
  const hash=await tokenHash(auth.slice(7));
  const mode=equal(hash,env.TEST_TOKEN_HASH)?'test':equal(hash,env.PARTICIPANT_TOKEN_HASH)?'participant':null;
  if(!mode)return reply(401,{error:'unauthorized'});
  if(env.SAVE_LIMITER&&!(await env.SAVE_LIMITER.limit({key:mode})).success)return reply(429,{error:'retry_later'});
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{error:'json_required'});
  let data;try{const raw=await request.text();if(raw.length>20000)return reply(413,{error:'too_large'});data=validate(JSON.parse(raw));}catch{return reply(400,{error:'invalid_answers'});}
  const path=`${mode}/${data.sessionId}/${block.id}.json`;
  const url=`https://api.github.com/repos/${env.DATA_REPO}/contents/${path}`;
  const ghHeaders={'Authorization':`Bearer ${env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','User-Agent':'personal-guide-api','X-GitHub-Api-Version':'2022-11-28'};
  try {
    const previous=await fetch(url,{headers:ghHeaders});let sha;
    if(previous.ok){const file=await previous.json();sha=file.sha;const saved=JSON.parse(decode64(file.content));if(saved.revision>=data.revision)return reply(200,{saved:true,revision:saved.revision,mode});}
    else if(previous.status!==404)return reply(502,{error:'storage_unavailable'});
    const savedAt=new Date().toISOString();
    const result=await fetch(url,{method:'PUT',headers:{...ghHeaders,'Content-Type':'application/json'},body:JSON.stringify({message:`Save ${mode} response`,content:base64(JSON.stringify({...data,mode,savedAt},null,2)),...(sha?{sha}:{})})});
    if(!result.ok)return reply(result.status===409||result.status===422?409:502,{error:'save_failed'});
    return reply(200,{saved:true,revision:data.revision,mode,savedAt});
  }catch{return reply(502,{error:'storage_unavailable'});}
 }
};
