import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {block} from '../questions.js';

function attributes(tag){
 return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([,name,,value])=>[name.toLowerCase(),value.replaceAll('&amp;','&')]));
}
function releaseAssets(html,app){
 const assets=[];
 for(const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)){
  const attr=attributes(tag);
  if(/^<script\b/i.test(tag)&&attr.type==='module')assets.push(attr.src);
  if(/^<link\b/i.test(tag)&&attr.rel==='stylesheet')assets.push(attr.href);
 }
 for(const [,specifier] of app.matchAll(/^\s*import\s+[^;\n]*?\sfrom\s*["']([^"']+)["']\s*;/gm))assets.push(specifier);
 return assets;
}
function assertCurrentRelease(assets){
 const names=[],revisions=[];
 for(const asset of assets){
  assert.equal(typeof asset,'string','Every release asset must have a URL');
  assert.match(asset,/^(?:\.\/)?(?:app\.js|style\.css|questions\.js|cloud\.js)\?[^#]+$/,'Release assets must be versioned relative URLs');
  const url=new URL(asset,'https://release.example/your-space/');
  names.push(url.pathname.slice('/your-space/'.length));
  assert.deepEqual(url.searchParams.getAll('block'),[block.id],`Stale or missing block identity: ${asset}`);
  const revisionsForAsset=url.searchParams.getAll('rev');assert.equal(revisionsForAsset.length,1,`Missing or repeated revision: ${asset}`);
  assert.match(revisionsForAsset[0],/^[1-9]\d*$/,`Revision must be a positive integer: ${asset}`);
  assert.ok(Number.isSafeInteger(Number(revisionsForAsset[0])),`Revision is too large: ${asset}`);
  revisions.push(revisionsForAsset[0]);
 }
 assert.deepEqual(names.sort(),['app.js','cloud.js','questions.js','style.css']);
 assert.equal(new Set(revisions).size,1,'The page, app and module dependencies must share one release revision');
}

test('The published page and its static module graph share the active block release identity',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assertCurrentRelease(releaseAssets(html,app));
 const home=html.match(/<a\b[^>]*aria-label=["']Home["'][^>]*>/)?.[0];assert.ok(home);
 assert.equal(new URL(attributes(home).href,'https://release.example/your-space/').searchParams.get('block'),block.id,'Home must reopen the current block instead of a cached bare page');
});

test('Release validation catches the stale cached dependency and tolerates HTML ampersand encoding',()=>{
 const query=`block=${block.id}&rev=1`;
 const html=`<link rel="stylesheet" href="./style.css?${query.replace('&','&amp;')}"><script src="app.js?${query}" type="module"></script>`;
 const app=`import {block} from './questions.js?${query}';\nimport {queue} from './cloud.js?${query}';`;
 const assets=releaseAssets(html,app);assertCurrentRelease(assets);
 for(const stale of ['./questions.js',`./questions.js?block=previous-set-v1&rev=1`,`./questions.js?block=${block.id}`,`./questions.js?block=${block.id}&rev=0`,`./questions.js?block=${block.id}&rev=2`]){
  assert.throws(()=>assertCurrentRelease(assets.map(asset=>asset.startsWith('./questions.js')?stale:asset)));
 }
});
