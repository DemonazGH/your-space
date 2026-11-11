export const TIMER_MS=15*60*1000;
export const TIMER_KEY='compass:boiled-eggs:deadline:v1';

function browserStorage(){try{return globalThis.localStorage||null;}catch{return null;}}

export function parseDeadline(raw,now){
  if(typeof raw!=='string'||!/^\d{1,16}$/.test(raw))return null;
  const deadline=Number(raw);
  return Number.isSafeInteger(deadline)&&deadline>0&&deadline<=now+TIMER_MS+60_000?deadline:null;
}

export function createTimer({storage=browserStorage(),now=Date.now}={}){
  let deadline=null;
  let persistent=Boolean(storage);
  try{deadline=parseDeadline(storage?.getItem(TIMER_KEY),now());}catch{persistent=false;}

  function state(){
    const milliseconds=deadline===null?TIMER_MS:Math.max(0,deadline-now());
    const seconds=Math.ceil(Math.min(TIMER_MS,milliseconds)/1000);
    return {phase:deadline===null?'idle':milliseconds>0?'running':'done',seconds,deadline,persistent};
  }
  function start(){
    if(state().phase==='running')return state();
    deadline=now()+TIMER_MS;
    try{storage?.setItem(TIMER_KEY,String(deadline));persistent=Boolean(storage);}catch{persistent=false;}
    return state();
  }
  function reset(){
    deadline=null;
    try{storage?.removeItem(TIMER_KEY);persistent=Boolean(storage);}catch{persistent=false;}
    return state();
  }
  return {state,start,reset};
}

export function formatTime(seconds){
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}

function makeSound(){
  let context;
  async function prepare(){
    try{
      const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Audio)return false;
      context??=new Audio();
      if(context.state!=='running')await context.resume();
      return context.state==='running';
    }catch{return false;}
  }
  function signal(){
    if(!context||context.state!=='running'||document.visibilityState!=='visible')return false;
    try{
      for(const offset of [0,.29]){
        const start=context.currentTime+offset;
        const tone=context.createOscillator(),volume=context.createGain();
        tone.type='sine';tone.frequency.value=660;
        volume.gain.setValueAtTime(0,start);
        volume.gain.linearRampToValueAtTime(.085,start+.035);
        volume.gain.linearRampToValueAtTime(0,start+.19);
        tone.connect(volume);volume.connect(context.destination);
        tone.start(start);tone.stop(start+.2);
      }
      return true;
    }catch{return false;}
  }
  return {prepare,signal};
}

export function mountTimer(root=document){
  const card=root.querySelector('#egg-timer');
  if(!card)return;
  const digits=card.querySelector('#timer-digits'),progress=card.querySelector('#timer-progress');
  const status=card.querySelector('#timer-status'),start=card.querySelector('#timer-start'),reset=card.querySelector('#timer-reset');
  const soundButton=card.querySelector('#timer-sound'),soundStatus=card.querySelector('#sound-status');
  const storageNote=card.querySelector('#storage-note');
  const timer=createTimer(),sound=makeSound();
  let previous=timer.state().phase,interval=null;
  const messages={idle:'Начинай, когда выключишь плиту.',running:'Таймер идёт.',done:'Время вышло. Пора охладить яйца.'};

  function render(){
    const {phase,seconds,persistent}=timer.state();
    if(previous==='running'&&phase==='done')sound.signal();
    previous=phase;
    card.dataset.phase=phase;
    digits.textContent=formatTime(seconds);
    digits.setAttribute('aria-label',`Осталось ${Math.floor(seconds/60)} мин. ${seconds%60} сек.`);
    progress.value=TIMER_MS/1000-seconds;
    if(status.textContent!==messages[phase])status.textContent=messages[phase];
    start.disabled=phase==='running';
    start.textContent=phase==='running'?'Таймер запущен':phase==='done'?'Запустить снова':'Запустить таймер';
    reset.disabled=phase==='idle';
    storageNote.hidden=persistent;
    if(phase==='running'&&interval===null)interval=setInterval(render,250);
    if(phase!=='running'&&interval!==null){clearInterval(interval);interval=null;}
  }

  start.addEventListener('click',()=>{
    if(timer.state().phase==='running')return;
    soundStatus.textContent='';
    void sound.prepare();
    timer.start();render();
    // Keep the active timer reachable when the start button becomes disabled.
    reset.focus();
  });
  reset.addEventListener('click',()=>{timer.reset();soundStatus.textContent='';render();start.focus();});
  soundButton.disabled=false;
  soundButton.addEventListener('click',async()=>{
    if(await sound.prepare()&&sound.signal())soundStatus.textContent='Проверка звука.';
    else soundStatus.textContent='Звук недоступен. Можно следить за временем на экране.';
  });
  document.addEventListener('visibilitychange',render);
  globalThis.addEventListener('pageshow',render);
  render();
  return timer;
}

if(typeof document!=='undefined')mountTimer();
