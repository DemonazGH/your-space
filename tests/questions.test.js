import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {firstBlock as block} from '../questions.js';
import {secondBlock as second} from '../questions.js';
import {block as activeBlock,blocks} from '../questions.js';
test('Second block has four bilingual questions and a distinct identity',()=>{assert.notEqual(second.id,block.id);assert.equal(second.questions.length,4);assert.equal(new Set(second.questions.map(q=>q.id)).size,4);for(const q of second.questions){assert.equal(q.title.length,2);for(const o of q.options){assert.equal(o.length,3);assert(o.every(x=>x.trim()));}}});
test('Stable unique question IDs and equivalent bilingual choices',()=>{assert.equal(block.questions.length,6);assert.equal(new Set(block.questions.map(q=>q.id)).size,6);for(const q of block.questions){assert.equal(q.title.length,2);assert(q.title.every(x=>typeof x==='string'&&x.trim()));assert.equal(new Set(q.options.map(o=>o[0])).size,q.options.length);for(const o of q.options){assert.equal(o.length,3);assert(o.every(x=>typeof x==='string'&&x.trim()));assert(!['other','unknown','private'].includes(o[0]));}}});

// Fingerprints of answer schemas from the published 19-block catalogue. Labels
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
 ['school-task-motivation-v1','6feb3bab17fe36943dfe7f39b7f5f58f2367e7fd41206cc6cc8e0d331176b908']
];
function schemaDigest(definition){
 const schema={id:definition.id,version:definition.version,requiresFinish:definition.requiresFinish===true,questions:definition.questions.map(q=>({id:q.id,type:q.type,options:q.options.map(o=>o[0])}))};
 return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

test('The 20-block catalogue preserves all 19 published answer schemas and unique identities',()=>{
 assert.equal(blocks.length,20);
 assert.deepEqual(blocks.map(b=>b.id),[...historicalSchemas.map(([id])=>id),'task-clarity-v1']);
 assert.equal(new Set(blocks.map(b=>b.id)).size,20);assert.equal(blocks.at(-1),activeBlock);
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
 assert.equal(activeBlock.id,'task-clarity-v1');assert.equal(activeBlock.version,1);assert.equal(activeBlock.requiresFinish,true);
 assert.deepEqual(activeBlock.questions.map(q=>[q.id,q.type,q.options.map(o=>o[0])]),[
  ['clarity_at_first','single',['clear','partly','unclear','forgot']],
  ['clarity_meaning','single',['result','information','first_step','method','material','several','forgot']],
  ['clarity_source','single',['task_text','reread','example','person','similar','try','several','forgot']],
  ['clarity_check','single',['task_text','example','person','while_doing','no_check','several','forgot']]
 ]);
});


