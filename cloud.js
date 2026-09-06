// Only the service address is public. Access keys are supplied in private links.
const endpoint='https://personal-guide-api.your-space.workers.dev/answers';
let access=null;
try {
  const fragment=new URLSearchParams(location.hash.slice(1));
  const token=fragment.get('access');
  if(token&&/^[a-f0-9]{64}$/.test(token)) {
    access={token,mode:fragment.get('mode')==='test'?'test':'participant'};
    sessionStorage.setItem('guide-access',JSON.stringify(access));
    history.replaceState(null,'',location.pathname+location.search);
  } else {
    const stored=JSON.parse(sessionStorage.getItem('guide-access'));
    if(stored&&/^[a-f0-9]{64}$/.test(stored.token))access=stored;
  }
}catch{}
export const cloudEnabled=!!access;
export const testMode=access?.mode==='test';
export const storageKey=cloudEnabled?'guide-cloud-v1-'+access.token.slice(0,16):'your-space-draft-v1';
let timer,pending,running=false,last='',retry=0,callback=()=>{},status='idle',lastError='',generation=0;
function update(value){status=value;callback(status);}
export function subscribe(fn){callback=fn;fn(status);}
export function cancel(){generation++;clearTimeout(timer);pending=null;last='';update('idle');}
export function queue(state,blockId){
 if(!cloudEnabled||!state.consent||state.cloudConsentVersion!==1||!Object.keys(state.answers).length)return;
 const content=JSON.stringify({answers:state.answers,language:state.lang,completed:state.completed===true});
 if(last===content)return;
 last=content;state.sessionId??=crypto.randomUUID();state.revision=(state.revision||0)+1;
 pending={schemaVersion:1,blockId,consent:true,sessionId:state.sessionId,revision:state.revision,language:state.lang,completed:state.completed===true,answers:JSON.parse(JSON.stringify(state.answers))};
 update('pending');clearTimeout(timer);timer=setTimeout(send,1800);
}
async function send(){
 if(running||!pending)return;
 if(!navigator.onLine){update('offline');return;}
 running=true;const item=pending,epoch=generation;pending=null;update('saving');
 try {
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access.token}`},body:JSON.stringify(item),signal:AbortSignal.timeout(15000),credentials:'omit',referrerPolicy:'no-referrer'});
  if(!r.ok){lastError=String(r.status);throw Error('Save failed');}
  const result=await r.json();if(result.saved!==true||result.revision<item.revision)throw Error('Not acknowledged');
  if(epoch!==generation)return;
  retry=0;update(pending?'pending':'saved');
 }catch{
  if(epoch!==generation)return;
  pending??=item;
  update(['401','403'].includes(lastError)?'accessError':'offline');
  retry++;clearTimeout(timer);timer=setTimeout(send,Math.min(60000,3000*2**Math.min(retry,4)));
 }finally{running=false;if(pending&&status==='pending'){clearTimeout(timer);timer=setTimeout(send,1800);}}
}
window.addEventListener('online',()=>{lastError='';send();});
export function retrySave(){lastError='';clearTimeout(timer);send();}
