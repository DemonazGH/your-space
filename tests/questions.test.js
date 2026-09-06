import test from 'node:test';
import assert from 'node:assert/strict';
import {block} from '../questions.js';
test('Stable unique question IDs and equivalent bilingual choices',()=>{assert.equal(block.questions.length,6);assert.equal(new Set(block.questions.map(q=>q.id)).size,6);for(const q of block.questions){assert.equal(q.title.length,2);assert(q.title.every(x=>typeof x==='string'&&x.trim()));assert.equal(new Set(q.options.map(o=>o[0])).size,q.options.length);for(const o of q.options){assert.equal(o.length,3);assert(o.every(x=>typeof x==='string'&&x.trim()));assert(!['other','unknown','private'].includes(o[0]));}}});

