import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {block,blocks} from '../questions.js';

function app({cloudMode=true,definition=block}={}){
 const elements=new Map(),memory=new Map(),queued=[];
 let retries=0,syncCallback,lastQueued='';
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,hidden:false,dataset:{},focus(){},setAttribute(){},append(){}});return elements.get(id);};
 const languages=['ru','en'].map(lang=>({...element(lang),dataset:{lang}}));
 const inputs=[...new Set(['unknown','private','other',...definition.questions.flatMap(q=>q.options.map(o=>o[0]))])].map(value=>({value,checked:false}));
 const edits=definition.questions.map((q,index)=>({dataset:{index:String(index)}}));
 const finishSelectors=new Set(['#finish','#finish-mark','#finish-label','#finish-save-status','#finish-save-panel','#finish-retry']);
 const querySelector=selector=>finishSelectors.has(selector)&&!element('#app').innerHTML.includes(`id="${selector.slice(1)}"`)?null:element(selector);
 const document={documentElement:{},querySelector,querySelectorAll:s=>s==='[data-lang]'?languages:s==='[name=answer]'?inputs:s==='[name=answer]:checked'?inputs.filter(x=>x.checked):s==='.edit'?edits:[],createElement:()=>element('created')};
 const context={document,block:definition,cloudEnabled:cloudMode,testMode:true,storageKey:'test-key',queue:s=>{
  queued.push(JSON.parse(JSON.stringify(s)));
  if(!cloudMode||!s.consent||s.cloudConsentVersion!==1||!Object.keys(s.answers).length)return;
  const content=JSON.stringify({answers:s.answers,language:s.lang,completed:s.completed===true});
  if(content!==lastQueued){lastQueued=content;syncCallback?.('pending');}
 },subscribe:fn=>{syncCallback=fn;fn('idle');},retrySave(){retries++;},cancel(){},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},window:{scrollTo(){}},confirm:()=>true};
 vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),context);
 return {element,languages,inputs,edits,queued,retries:()=>retries,querySelector,setSync:value=>syncCallback(value),start(){element('#consent').onchange({target:{checked:true}});element('#start').onclick();}};
}

test('Autosave keeps a complete draft unfinished until explicit finish, and editing reopens it',()=>{
 const a=app();
 assert.match(a.element('#app').innerHTML,/автоматически сохраняться/);
 assert.equal(a.queued.at(-1).consent,false);
 a.start();
 for(let i=0;i<block.questions.length;i++){
  a.element('#note').oninput({target:{value:`example ${i}`}});
  if(i<block.questions.length-1)a.element('#next').onclick();
 }
 assert.equal(a.queued.at(-1).completed,false);
 assert.equal(a.element('#finish').disabled,false);
 assert.match(a.element('#app').innerHTML,/id="finish"/);
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.equal(a.queued.at(-1).screen,'done');
 assert.equal(a.retries(),1);
 const count=a.queued.length;
 a.element('#finish').onclick();
 assert.equal(a.queued.length,count);
 a.languages[1].onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.match(a.element('#app').innerHTML,/before closing this page/);
 a.element('#review').onclick();a.edits[0].onclick();
 a.element('#note').oninput({target:{value:''}});
 assert.equal(a.queued.at(-1).completed,false);
 a.element('#skip').onclick();
 assert.equal(a.queued.at(-1).completed,false);
 for(let i=1;i<block.questions.length;i++)a.element('#next').onclick();
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.equal(a.queued.at(-1).cloudConsentVersion,1);
});

test('Unanswered questions are not silently skipped; incomplete finish is a no-op',()=>{
 const a=app();a.start();
 for(let i=0;i<block.questions.length;i++)a.element('#next').onclick();
 assert.equal(a.queued.at(-1).screen,'review');
 assert.deepEqual(a.queued.at(-1).answers,{});
 assert.match(a.element('#app').innerHTML,/Пока нет ответа/);
 assert.equal(a.element('#finish').disabled,true);
 const count=a.queued.length;
 a.element('#finish').onclick();
 assert.equal(a.queued.length,count);
 assert.equal(a.retries(),0);
});

test('Private, unknown, and deliberate skip allow completion without free text',()=>{
 for(const value of ['private','unknown','skip']){
  const a=app();a.start();
  for(let i=0;i<block.questions.length;i++){
   if(value==='skip')a.element('#skip').onclick();
   else{const input=a.inputs.find(x=>x.value===value);input.checked=true;input.onchange();a.element('#next').onclick();}
  }
  assert.equal(a.queued.at(-1).completed,false);
  assert.equal(a.element('#finish').disabled,false);
  a.element('#finish').onclick();
  assert.equal(a.queued.at(-1).completed,true);
  for(const q of block.questions){
   const answer=a.queued.at(-1).answers[q.id];
   assert.deepEqual(answer.values,value==='skip'?[]:[value]);
   assert.equal(answer.skipped,value==='skip');
   assert.equal(answer.text,'');
  }
 }
});

test('The welcome page shows the actual question count in both languages',()=>{
 const a=app();
 assert.match(a.element('#app').innerHTML,new RegExp(`Вопросов: ${block.questions.length}`));
 a.languages[1].onclick();
 assert.match(a.element('#app').innerHTML,new RegExp(`Questions: ${block.questions.length}`));
});

test('The activity menu accepts several interests and keeps none exclusive in both directions',()=>{
 const definition=blocks.find(item=>item.questions.some(question=>question.id==='leisure_ideas'));
 assert.ok(definition);
 const a=app({definition});a.start();
 const choose=value=>{const input=a.inputs.find(x=>x.value===value);input.checked=true;input.onchange();};
 const values=()=>a.queued.at(-1).answers.leisure_ideas.values;
 choose('mystery');choose('story');
 assert.deepEqual(values(),['mystery','story']);
 choose('none');assert.deepEqual(values(),['none']);
 assert.equal(a.inputs.find(x=>x.value==='story').checked,false);
 choose('languages');assert.deepEqual(values(),['languages']);
 assert.equal(a.inputs.find(x=>x.value==='none').checked,false);
 choose('none');choose('other');assert.deepEqual(values(),['other']);
 choose('private');assert.deepEqual(values(),['private']);
 choose('mystery');assert.deepEqual(values(),['mystery']);
 choose('none');choose('unknown');assert.deepEqual(values(),['unknown']);
});

const passageFixture={...block,id:'passage-fixture-v1',questions:[
 {id:'story_choice',type:'single',title:['Что может быть дальше?','What could happen next?'],
  passage:{title:['Дверь <img src=x> & ключ','The door <script>bad()</script> & key'],paragraphs:[
   ['Он сказал: "Кто здесь?" <b>Тихо.</b>','She said: "Who is there?" <b>Silence.</b>'],
   ["Потом услышал 'шаги' & замер.","Then she heard 'steps' & stopped."]
  ]},hint:['Подумай об этом случае.','Think about that moment.'],options:[['continue','Продолжить','Continue']]},
 {id:'plain_choice',type:'single',title:['Обычный вопрос','A plain question'],hint:['Обычная подсказка.','A plain hint.'],options:[['continue','Продолжить','Continue']]}
]};

test('A passage renders separate escaped paragraphs after the question and before its hint in Russian and English',()=>{
 const a=app({definition:passageFixture});a.start();
 for(const [language,hint,expected] of [
  [0,'Подумай об этом случае.',['Дверь &lt;img src=x&gt; &amp; ключ','&quot;Кто здесь?&quot; &lt;b&gt;Тихо.&lt;/b&gt;','&#39;шаги&#39; &amp; замер.']],
  [1,'Think about that moment.',['The door &lt;script&gt;bad()&lt;/script&gt; &amp; key','&quot;Who is there?&quot; &lt;b&gt;Silence.&lt;/b&gt;','&#39;steps&#39; &amp; stopped.']]
 ]){
  a.languages[language].onclick();
  const html=a.element('#app').innerHTML,card=html.match(/<section class="passage-card"[\s\S]*?<\/section>/)?.[0];
  assert.ok(card);assert.match(card,/aria-labelledby="passage-title"/);assert.match(card,/<h2 id="passage-title">/);
  for(const text of expected)assert.ok(card.includes(text));
  assert.doesNotMatch(card,/<(?:img|script|b)(?:\s|>)/);
  assert.equal((card.match(/<p>/g)||[]).length,2);
  assert.ok(html.indexOf('</h1>')<html.indexOf(card));
  assert.ok(html.indexOf(card)<html.indexOf(hint));
  assert.ok(html.indexOf(hint)<html.indexOf('<fieldset'));
 }
});

test('Questions without a passage keep their normal hint and choices when moving between questions',()=>{
 const a=app({definition:passageFixture});a.start();
 a.element('#note').oninput({target:{value:'My own answer'}});a.element('#next').onclick();
 let html=a.element('#app').innerHTML;
 assert.doesNotMatch(html,/passage-card|passage-title/);
 assert.match(html,/<h1 id="heading" tabindex="-1">Обычный вопрос<\/h1><p>Обычная подсказка\.<\/p><fieldset/);
 assert.match(html,/name="answer" value="continue"/);
 a.element('#back').onclick();html=a.element('#app').innerHTML;
 assert.match(html,/class="passage-card"/);
 assert.equal(a.queued.at(-1).answers.story_choice.text,'My own answer');
});

const planFixture={...block,id:'plan-fixture-v1',questions:[
 {id:'plan_look',type:'single',title:['Как тебе такой экран?','What do you think of this screen?'],
  planPreview:{
   title:['Макет <img src=x> & планы','Preview <script>bad()</script> & plans'],
   button:['Мои планы "пример"','My plans "sample"'],
   notice:['Все события вымышлены. Реальные планы и уведомления не создаются. <b>Пример</b>.','All events are made up. No real plans or reminders are created. <b>Sample</b>.'],
   items:[
    {when:['Сегодня <b>18:00</b>','Today <b>18:00</b>'],title:['Встреча "пример" & заметка','A "sample" meeting & note']},
    {when:['Завтра','Tomorrow'],title:['Дело <script>bad()</script>','A task <img src=x>']},
    {when:['В пятницу','On Friday'],title:['Третий пример','A third sample']},
    {when:['В субботу','On Saturday'],title:['Четвёртый пример','A fourth sample']}
   ]
  },hint:['Выбери то, что думаешь.','Choose what you think.'],options:[['yes','Подходит','It suits me']]},
 {id:'plain_plan_question',type:'single',title:['Другой вопрос','Another question'],hint:['Обычная подсказка.','A plain hint.'],options:[['yes','Да','Yes']]}
]};

test('Plan previews are initially closed, clearly fictional and fully escaped in Russian and English',()=>{
 const a=app({definition:planFixture});a.start();
 for(const [language,hint,expected] of [
  [0,'Выбери то, что думаешь.',['Макет &lt;img src=x&gt; &amp; планы','Мои планы &quot;пример&quot;','Все события вымышлены. Реальные планы и уведомления не создаются. &lt;b&gt;Пример&lt;/b&gt;.','Сегодня &lt;b&gt;18:00&lt;/b&gt;','Встреча &quot;пример&quot; &amp; заметка','Дело &lt;script&gt;bad()&lt;/script&gt;']],
  [1,'Choose what you think.',['Preview &lt;script&gt;bad()&lt;/script&gt; &amp; plans','My plans &quot;sample&quot;','All events are made up. No real plans or reminders are created. &lt;b&gt;Sample&lt;/b&gt;.','Today &lt;b&gt;18:00&lt;/b&gt;','A &quot;sample&quot; meeting &amp; note','A task &lt;img src=x&gt;']]
 ]){
  a.languages[language].onclick();
  const html=a.element('#app').innerHTML,preview=html.match(/<section class="plan-preview"[\s\S]*?<\/section>/)?.[0];
  assert.ok(preview);for(const text of expected)assert.ok(preview.includes(text));
  assert.match(preview,/<details class="plan-preview-details"><summary aria-describedby="plan-preview-notice">/);
  assert.ok(preview.indexOf('id="plan-preview-notice"')<preview.indexOf('<details'));
  assert.doesNotMatch(preview,/<details\b[^>]*\bopen(?:\s|=|>)/);
  assert.doesNotMatch(preview,/<(?:img|script|b)(?:\s|>)|<(?:input|button)\b|on(?:click|toggle)=/);
  assert.equal((preview.match(/<li class="plan-preview-item">/g)||[]).length,4);
  assert.ok(html.indexOf('</h1>')<html.indexOf(preview));assert.ok(html.indexOf(preview)<html.indexOf(hint));assert.ok(html.indexOf(hint)<html.indexOf('<fieldset'));
  assert.deepEqual(a.queued.at(-1).answers,{});assert.equal(a.queued.at(-1).completed,false);
 }
});

test('Viewing a plan preview does not fill answers and ordinary questions do not display it',()=>{
 const a=app({definition:planFixture});a.start();
 assert.match(a.element('#app').innerHTML,/class="plan-preview"/);
 a.element('#next').onclick();
 assert.doesNotMatch(a.element('#app').innerHTML,/plan-preview/);
 assert.match(a.element('#app').innerHTML,/<h1 id="heading" tabindex="-1">Другой вопрос<\/h1><p>Обычная подсказка\.<\/p><fieldset/);
 assert.deepEqual(a.queued.at(-1).answers,{});assert.equal(a.queued.at(-1).completed,false);assert.equal(a.element('#finish').disabled,true);
 a.element('#next').onclick();
 assert.equal(a.queued.at(-1).screen,'review');assert.deepEqual(a.queued.at(-1).answers,{});assert.equal(a.element('#finish').disabled,true);
});

test('Finish shows waiting or retry until remote acknowledgement, then permits closing',()=>{
 const a=app();a.start();
 for(let i=0;i<block.questions.length;i++)a.element('#skip').onclick();
 a.element('#finish').onclick();
 assert.equal(a.queued.at(-1).completed,true);
 assert.match(a.element('#heading').textContent,/Сохраняем/);
 assert.notEqual(a.element('#finish-mark').textContent,'✓');
 assert.match(a.element('#finish-save-status').textContent,/Дождись подтверждения/);
 assert.equal(a.element('#finish-retry').hidden,true);
 a.setSync('offline');
 assert.match(a.element('#finish-save-status').textContent,/пока не отправлены/);
 assert.equal(a.element('#finish-retry').hidden,false);
 a.element('#finish-retry').onclick();assert.equal(a.retries(),2);
 a.languages[1].onclick();
 assert.match(a.element('#finish-save-status').textContent,/still being sent/);
 a.setSync('offline');assert.match(a.element('#finish-save-status').textContent,/have not been sent/);
 a.setSync('saving');
 assert.match(a.element('#heading').textContent,/Saving/);
 assert.equal(a.element('#finish-retry').hidden,true);
 a.setSync('saved');
 assert.match(a.element('#finish-save-status').textContent,/Answers saved for Dzmitry/);
 assert.match(a.element('#finish-save-status').textContent,/close this page now/);
 assert.equal(a.element('#finish-mark').textContent,'✓');
 assert.equal(a.element('#finish-label').textContent,'Set complete');
 a.setSync('accessError');
 assert.match(a.element('#finish-save-status').textContent,/could not be saved online/);
 assert.notEqual(a.element('#finish-mark').textContent,'✓');
});

test('The local demo does not claim remote saving or render the cloud finish panel',()=>{
 const a=app({cloudMode:false});a.start();
 for(let i=0;i<block.questions.length;i++)a.element('#skip').onclick();
 a.element('#finish').onclick();
 assert.doesNotMatch(a.element('#app').innerHTML,/id="finish-save-panel"/);
 assert.match(a.element('#app').innerHTML,/Автоматически ничего не отправлено/);
});

test('Synchronous pending notification during finish tolerates the still-visible question or review DOM',()=>{
 for(const fromReview of [false,true]){
  const a=app();a.start();
  for(let i=0;i<block.questions.length;i++){
   a.element('#note').oninput({target:{value:`answer ${i}`}});
   if(i<block.questions.length-1||fromReview)a.element('#next').onclick();
  }
  assert.equal(a.querySelector('#finish-mark'),null);
  assert.equal(a.querySelector('#finish-save-panel'),null);
  assert.doesNotThrow(()=>a.element('#finish').onclick());
  assert.equal(a.queued.at(-1).completed,true);
  assert.equal(a.queued.at(-1).screen,'done');
  assert.ok(a.querySelector('#finish-save-panel'));
  assert.match(a.element('#finish-save-status').textContent,/Дождись подтверждения/);
  assert.equal(a.retries(),1);
  a.setSync('saved');assert.match(a.element('#finish-save-status').textContent,/страницу можно закрыть/);
 }
});
