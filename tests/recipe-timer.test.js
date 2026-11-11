import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimer,formatTime,parseDeadline,TIMER_KEY,TIMER_MS} from '../recipe/app.js';

function memoryStorage(){
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}

test('egg timer keeps its deadline without ticks and restores it after reload',()=>{
  let now=1_790_000_000_000;
  const storage=memoryStorage(),create=()=>createTimer({storage,now:()=>now});
  const timer=create();
  assert.equal(formatTime(timer.state().seconds),'15:00');
  const {deadline}=timer.start();
  assert.equal(storage.getItem(TIMER_KEY),String(deadline));
  now+=9*60_000+1_234;
  assert.equal(formatTime(timer.state().seconds),'05:59');
  assert.equal(timer.start().deadline,deadline,'a second start must not extend a running timer');
  assert.deepEqual(create().state(),timer.state());
  now=deadline+3_000;
  assert.deepEqual(create().state(),{phase:'done',seconds:0,deadline,persistent:true});
});

test('egg timer finishes at zero and reset removes the saved deadline',()=>{
  let now=1_790_000_000_000;
  const storage=memoryStorage(),create=()=>createTimer({storage,now:()=>now});
  const timer=create(),{deadline}=timer.start();
  now=deadline-1;
  assert.equal(timer.state().seconds,1);
  now=deadline;
  assert.equal(timer.state().phase,'done');
  assert.equal(formatTime(timer.state().seconds),'00:00');
  assert.equal(timer.reset().phase,'idle');
  assert.equal(storage.getItem(TIMER_KEY),null);
  assert.equal(formatTime(create().state().seconds),'15:00');
});

test('egg timer handles invalid storage and still works when browser storage is denied',()=>{
  const now=1_790_000_000_000;
  for(const raw of ['bad','1.0','0',String(now+TIMER_MS+61_000),String(Number.MAX_SAFE_INTEGER+1)])assert.equal(parseDeadline(raw,now),null);
  const blocked=()=>{throw new Error('storage denied');};
  const timer=createTimer({storage:{getItem:blocked,setItem:blocked,removeItem:blocked},now:()=>now});
  assert.equal(timer.state().persistent,false);
  assert.equal(timer.start().phase,'running');
  assert.equal(timer.state().deadline,now+TIMER_MS);
  assert.equal(timer.state().persistent,false);
  assert.equal(timer.reset().phase,'idle');
});
