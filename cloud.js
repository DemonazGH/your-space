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
let timer,pending,inFlight=null,last='',retry=0,callback=()=>{},status='idle',generation=0,urgent=false;
function update(value){status=value;callback(status);}
export function subscribe(fn){callback=fn;fn(status);}
function clearSchedule(){clearTimeout(timer);timer=undefined;}
function schedule(delay){clearSchedule();if(pending)timer=setTimeout(()=>{timer=undefined;return send();},delay);}
function retryDelay(){retry=Math.min(retry+1,5);return Math.min(60000,3000*2**retry);}
export function cancel(){
 generation++;clearSchedule();pending=null;last='';retry=0;urgent=false;
 inFlight?.controller.abort();update('idle');
}
export function queue(state,blockId){
 if(!cloudEnabled)return;
 if(!state?.consent||state.cloudConsentVersion!==1||!state.answers||!Object.keys(state.answers).length){
  if(pending||inFlight||last)cancel();
  return;
 }
 state.sessionId??=crypto.randomUUID();
 const content=JSON.stringify({blockId,sessionId:state.sessionId,answers:state.answers,language:state.lang,completed:state.completed===true});
 if(last===content)return;
 last=content;state.revision=(state.revision||0)+1;
 pending={schemaVersion:1,blockId,consent:true,sessionId:state.sessionId,revision:state.revision,language:state.lang,completed:state.completed===true,answers:JSON.parse(JSON.stringify(state.answers))};
 update('pending');
 if(inFlight){urgent=true;clearSchedule();}else schedule(1800);
}
async function send(){
 if(inFlight){if(pending)urgent=true;return;}
 if(!pending)return;
 clearSchedule();
 // Mobile browsers can miss the online event; a bounded timer must remain armed.
 if(navigator.onLine===false){update('offline');schedule(retryDelay());return;}
 const item=pending,epoch=generation,controller=new AbortController();
 const task={controller};inFlight=task;pending=null;urgent=false;update('saving');
 const deadline=setTimeout(()=>controller.abort(),15000);
 let errorStatus='',delay=0;
 try {
  const body=JSON.stringify(item);
  // The server accepts at most 20,000 UTF-16 code units, at most 60 KB in UTF-8.
  // keepalive is best effort and does not guarantee delivery after a browser closes.
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access.token}`},body,signal:controller.signal,keepalive:body.length<=20000,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!r.ok){errorStatus=String(r.status);throw Error('Save failed');}
  const result=await r.json();if(result.saved!==true||!Number.isSafeInteger(result.revision)||result.revision<item.revision)throw Error('Not acknowledged');
  if(epoch!==generation)return;
  retry=0;update(pending?'pending':'saved');
 }catch{
  if(epoch!==generation)return;
  pending??=item;
  update(['401','403'].includes(errorStatus)?'accessError':'offline');
  delay=retryDelay();
 }finally{
  clearTimeout(deadline);
  if(inFlight===task)inFlight=null;
  if(pending)schedule(urgent||epoch!==generation?0:delay);
 }
}
export function retrySave(){urgent=true;clearSchedule();return send();}
for(const name of ['online','focus','pageshow','pagehide'])window.addEventListener(name,retrySave);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'||document.visibilityState==='visible')retrySave();
});
