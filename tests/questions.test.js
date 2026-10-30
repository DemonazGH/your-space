import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {firstBlock as block} from '../questions.js';
import {secondBlock as second} from '../questions.js';
import {block as activeBlock,blocks,twentySeventhBlock} from '../questions.js';
test('Second block has four bilingual questions and a distinct identity',()=>{assert.notEqual(second.id,block.id);assert.equal(second.questions.length,4);assert.equal(new Set(second.questions.map(q=>q.id)).size,4);for(const q of second.questions){assert.equal(q.title.length,2);for(const o of q.options){assert.equal(o.length,3);assert(o.every(x=>x.trim()));}}});
test('Stable unique question IDs and equivalent bilingual choices',()=>{assert.equal(block.questions.length,6);assert.equal(new Set(block.questions.map(q=>q.id)).size,6);for(const q of block.questions){assert.equal(q.title.length,2);assert(q.title.every(x=>typeof x==='string'&&x.trim()));assert.equal(new Set(q.options.map(o=>o[0])).size,q.options.length);for(const o of q.options){assert.equal(o.length,3);assert(o.every(x=>typeof x==='string'&&x.trim()));assert(!['other','unknown','private'].includes(o[0]));}}});

// Fingerprints of answer schemas from the published 27-block catalogue. Labels
// may be improved, but saved question IDs, choice IDs, types and versions must stay valid.
const historicalSchemas=[
 ['first-steps-v1','f0ca255be1cba1838ae6a761270128b94b878cea9e3b445a7383fb4c237dec56'],
 ['interests-details-v1','b154becc18cfcea8add78d29a927cfc65d64d1530ea7b15e2177765dc4ab33d2'],
 ['daily-experiences-v1','d8191577eb10143caf5051fe531f116cbef7a97671e42ed8835df32d309944c9'],
 ['content-and-clarity-v1','675d7592c16346d6f0483ee0c2e6afd9f76d68ebd956bd45e795c5bc1fb1174b'],
 ['follow-up-examples-v1','5f153fadf61c6af843e4015553a61d8daeeb82ce21a27bfd3c4bf7914f8c7b49'],
 ['hands-on-and-asking-v1','acfcd5e4182021c63052748a38279e32c2c6efd98552dddc3d24f6fc54c948b8'],
 ['settings-and-timing-v1','6b93be0596330b512548cfde6d3b16b686437f7365f97d6ca4d8dddb5baf2507'],
 ['finding-solutions-v1','06b5ee407346423661441ede6d6701723fe0032655b8aebe330cc9056fb895b4'],
 ['small-activity-v1','af0961cf3a395b903db40401f952ee3b711a31a277818fd2f3571f786a7033d3'],
 ['game-idea-first-step-v1','fa9150033c2e39643520694c78991764bc05a0e101bb733d86e812d929c15d99'],
 ['helping-new-player-v1','eaad098311b3b9b0bac1ce9808ba9f30e1160c89ae10d45f8095d5e3610d7dd1'],
 ['app-convenience-v1','a9aebea55fcecd00e4fde4d966318cdfa4a396c42a7abf8e923d0e06eafa23f4'],
 ['device-choice-and-start-v1','da3d512265636757b136f1ba17f7b8eb77c31986c3f22ad2f2b4325c334f9a84'],
 ['information-and-packing-v1','a333814afdf83e0623e3abde3db0ce034d578c5cf44570076249e0777f1ccf56'],
 ['switching-activities-v1','53b5feba1727065bc7aea2840c0c5e396e8b4a72fab8fd85feddd24de1224187'],
 ['learning-something-new-v1','9f26ca2797476d9a11174fadcc03fd4a7ea86e77e96c1ac82d7ce6007514d012'],
 ['learning-outside-games-v1','528e033c3eb1bb53a9adb21ae4116ccd6c694c4daca5fd7380749e7abae942c0'],
 ['learning-away-from-screens-v1','d19de19b6160dc52a66d195c8986bb0de8a25b7bd32bbd6795c16df85fb57c30'],
 ['school-task-motivation-v1','6feb3bab17fe36943dfe7f39b7f5f58f2367e7fd41206cc6cc8e0d331176b908'],
 ['task-clarity-v1','eac852a994eceb9748d46ddc822a5523a1e95042d22ca0365ea7291917509fb6'],
 ['working-it-out-or-asking-v1','9c676a7a1298ac110268aef744f1d68ebf6eb2c6b39b2ead186fc4c37eab30cd'],
 ['own-priorities-v1','3490aa13c218bc9c3cb755db156b7b1bd43a16b17f39957144460513c31a73a9'],
 ['leisure-activity-choice-v1','20f3fd1271bf01885bd1f7716aec290b49ad0a16badeddab875fda1e6d2c4ead'],
 ['detective-story-choice-v1','ef1e741b4cad2c0fd3057d2a84d9d1a8b4c995dcce5bbb7ba9277037cb25c63c'],
 ['phone-daily-helper-v1','cc158ed9b49a4aae273184afbc161824417f29d6755cd2aac37cbacdac4916e2'],
 ['plans-screen-preview-v1','b5f2d690a1d1304ec33cb90cd0bda0e83b1f76d0a0a8a58251ab8a9abc885e6a'],
 ['plans-entry-choice-v1','af11003abada3591d1262b89a086f7fc29527d81185fc9f47c1d4db81237ff98']
];
function schemaDigest(definition){
 const schema={id:definition.id,version:definition.version,requiresFinish:definition.requiresFinish===true,questions:definition.questions.map(q=>({id:q.id,type:q.type,options:q.options.map(o=>o[0]),...(q.exclusiveOptions?{exclusiveOptions:q.exclusiveOptions}:{})}))};
 return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

test('The 28-block catalogue preserves all 27 published answer schemas and unique identities',()=>{
 assert.equal(blocks.length,28);
 assert.deepEqual(blocks.map(b=>b.id),[...historicalSchemas.map(([id])=>id),'plans-first-use-v1']);
 assert.equal(new Set(blocks.map(b=>b.id)).size,28);assert.equal(blocks.at(-1),activeBlock);
 for(const [id,digest] of historicalSchemas){assert.equal(schemaDigest(blocks.find(b=>b.id===id)),digest,`Published answer schema changed: ${id}`);}
});

test('The catalogue is bilingual with unique choices, and current choices do not use reserved IDs',()=>{
 for(const definition of blocks){
  for(const field of ['label','title','intro']){if(definition[field]===undefined&&definition!==activeBlock)continue;assert.equal(definition[field].length,2);assert.ok(definition[field].every(value=>typeof value==='string'&&value.trim()));}
  assert.equal(new Set(definition.questions.map(q=>q.id)).size,definition.questions.length);
  for(const question of definition.questions){
   assert.ok(['single','multi'].includes(question.type));assert.equal(question.title.length,2);assert.ok(question.title.every(value=>typeof value==='string'&&value.trim()));
   if(question.hint){assert.equal(question.hint.length,2);assert.ok(question.hint.every(value=>typeof value==='string'&&value.trim()));}
   assert.equal(new Set(question.options.map(option=>option[0])).size,question.options.length);
   for(const option of question.options){assert.equal(option.length,3);assert.ok(option.every(value=>typeof value==='string'&&value.trim()));if(definition===activeBlock)assert.ok(!['other','unknown','private'].includes(option[0]));}
  }
 }
});

test('Block 20 asks four separate clarity questions and preserves explicit finishing',()=>{
 const clarityBlock=blocks.find(b=>b.id==='task-clarity-v1');
 assert.ok(clarityBlock);assert.equal(clarityBlock.version,1);assert.equal(clarityBlock.requiresFinish,true);
 assert.deepEqual(clarityBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['clarity_at_first','single',['clear','partly','unclear','forgot']],
  ['clarity_meaning','single',['result','information','first_step','method','material','several','forgot']],
  ['clarity_source','single',['task_text','reread','example','person','similar','try','several','forgot']],
  ['clarity_check','single',['task_text','example','person','while_doing','no_check','several','forgot']]
 ]);
});

test('Block 21 distinguishes first action, its reason and whether asking actually happened',()=>{
 const askingBlock=blocks.find(b=>b.id==='working-it-out-or-asking-v1');
 assert.ok(askingBlock);assert.equal(askingBlock.version,1);assert.equal(askingBlock.requiresFinish,true);
 assert.deepEqual(askingBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['asking_example','single',['school','home','digital','outside','no_example','forgot']],
  ['asking_first','single',['try','information','person','later','not_started','no_example','forgot']],
  ['asking_factor','single',['try','information','person','unavailable','uncomfortable','several','no_example','forgot']],
  ['asking_outcome','single',['helpful','unclear','not_yet','decided_no','not_needed','no_example','forgot']]
 ]);
});

test('Block 22 offers personal priorities without requiring a change or a further task',()=>{
 const prioritiesBlock=blocks.find(b=>b.id==='own-priorities-v1');
 assert.ok(prioritiesBlock);assert.equal(prioritiesBlock.version,1);assert.equal(prioritiesBlock.requiresFinish,true);
 assert.deepEqual(prioritiesBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['priority_topic','single',['interests','future','daily','people','rest','no_change','undecided']],
  ['priority_change','single',['understand','options','learn','easier','choice','no_change','no_topic']],
  ['priority_reason','single',['interest','useful','comfort','choice','future','several','not_chosen']],
  ['priority_next','single',['explore','details','try','think','pause','undecided']]
 ]);
});

test('Block 23 uses only two bilingual questions, with several interests or an exclusive none choice',()=>{
 const leisureBlock=blocks.find(b=>b.id==='leisure-activity-choice-v1');
 assert.ok(leisureBlock);assert.equal(leisureBlock.version,1);assert.equal(leisureBlock.requiresFinish,true);
 assert.deepEqual(leisureBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['leisure_ideas','multi',['mystery','languages','story','echo','offscreen','none']],
  ['leisure_next','single',['example','more_ideas','later','pause']]
 ]);
 assert.deepEqual(leisureBlock.questions[0].exclusiveOptions,['none']);
});

test('Block 24 presents one bilingual story and two short choices without requiring a written solution',()=>{
 const storyBlock=blocks.find(b=>b.id==='detective-story-choice-v1');
 assert.ok(storyBlock);assert.equal(storyBlock.version,1);assert.equal(storyBlock.requiresFinish,true);
 assert.deepEqual(storyBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['story_path','single',['game','room_history','shared_story','no_choice']],
  ['story_impression','single',['curious','neutral','not_for_me','not_read']]
 ]);
 const [story,feedback]=storyBlock.questions;
 assert.equal(story.passage.title.length,2);assert.ok(story.passage.title.every(text=>typeof text==='string'&&text.trim()));
 assert.equal(story.passage.paragraphs.length,3);
 for(const paragraph of story.passage.paragraphs){assert.equal(paragraph.length,2);assert.ok(paragraph.every(text=>typeof text==='string'&&text.trim()));}
 assert.equal(feedback.passage,undefined);
});

test('Block 25 separates current phone uses, an optional feature and preferred control in three questions',()=>{
 const phoneBlock=blocks.find(b=>b.id==='phone-daily-helper-v1');
 assert.ok(phoneBlock);assert.equal(phoneBlock.version,1);assert.equal(phoneBlock.requiresFinish,true);
 assert.deepEqual(phoneBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['phone_current','multi',['explain','contact','save','plans','activities','none']],
  ['phone_feature','single',['overview','reminders','lists','message_help','search','none']],
  ['phone_control','single',['on_demand','one_button','chosen_time','example','not_needed']]
 ]);
 assert.deepEqual(phoneBlock.questions[0].exclusiveOptions,['none']);
});

test('Block 26 asks for preferred plan contents and one impression of an optional preview',()=>{
 const plansBlock=blocks.find(b=>b.id==='plans-screen-preview-v1');
 assert.ok(plansBlock);assert.equal(plansBlock.version,1);assert.equal(plansBlock.requiresFinish,true);
 assert.deepEqual(plansBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['plan_contents','multi',['study','appointments','personal','untimed','none']],
  ['plan_feedback','single',['as_is','fewer','more_details','other_plans','not_needed','not_viewed']]
 ]);
 assert.deepEqual(plansBlock.questions[0].exclusiveOptions,['none']);
 const preview=plansBlock.questions[0].planPreview;
 assert.deepEqual(plansBlock.questions[1].planPreview,preview);
 for(const field of ['title','button','notice']){assert.equal(preview[field].length,2);assert.ok(preview[field].every(text=>typeof text==='string'&&text.trim()));}
 assert.equal(preview.items.length,4);
 for(const item of preview.items){for(const field of ['when','title']){assert.equal(item[field].length,2);assert.ok(item[field].every(text=>typeof text==='string'&&text.trim()));}}
});

test('Block 27 asks two single-choice preferences about the source and entry method of plans',()=>{
 assert.equal(twentySeventhBlock.id,'plans-entry-choice-v1');assert.equal(twentySeventhBlock.version,1);assert.equal(twentySeventhBlock.requiresFinish,true);
 assert.equal(blocks.at(-2),twentySeventhBlock);
 assert.deepEqual(twentySeventhBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['plan_source','single',['self','suggestions','both','not_now']],
  ['plan_entry','single',['fields','line','example','not_now']]
 ]);
 assert.ok(twentySeventhBlock.questions.every(question=>question.entryMockup===true));
});

test('Block 28 asks about actual first use without requiring a new attempt or opening a mockup',()=>{
 assert.equal(activeBlock.id,'plans-first-use-v1');assert.equal(activeBlock.version,1);assert.equal(activeBlock.requiresFinish,true);
 assert.deepEqual(activeBlock.questions.map(question=>[question.id,question.type,question.options.map(option=>option[0])]),[
  ['plan_try','single',['self','help','started','not_tried']],
  ['plan_experience','single',['easy','figured_out','error','inconvenient','unfinished','not_tried']]
 ]);
 assert.ok(activeBlock.questions.every(question=>!question.entryMockup&&!question.planPreview&&!question.passage));
 assert.ok(!/https?:\/\/|t\.me\/|<a\b/i.test(JSON.stringify(activeBlock)));
});


