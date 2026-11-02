/* Scan -> immutable library -> bounded public pages.  Synthetic records only. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog;
const root = fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-catalog-'));
const call = (object, method, ...args) => new Promise((resolve,reject) => object[method](...args,(e,r) => e ? reject(e) : resolve(r)));
function ep(n) { return {id:'w:/Harbour/S01E'+n+'.mkv',path:'/Harbour/S01E'+n+'.mkv',file:'Harbour.S01E'+n+'.mkv',kind:'episode',title:'Harbour',ancestors:['Harbour','Season 1'],classification:{showTitle:'Harbour',season:1,numbers:[n],order:'aired',title:'Harbour',review:[]}}; }
(async function () {
 try {
  const catalog = new Catalog(root); await call(catalog,'open');
  await call(catalog,'importScan','demo',{files:[ep(10),ep(2)],partial:false});
  const shows = await call(catalog,'query',{kind:'show'}); assert.equal(shows.total,1);
  const handle = shows.items[0].handle;
  const detail = await call(catalog,'detail',{kind:'show',handle}); assert.equal(detail.buckets[0].count,2);
  const episodes = await call(catalog,'query',{kind:'episode',show:handle,limit:1}); assert.equal(episodes.items[0].number,2); assert(episodes.nextCursor);
  const episode = await call(catalog,'detail',{kind:'episode',handle:episodes.items[0].handle}); assert.equal(episode.versions.length,1);
  const publicText = JSON.stringify(episode); assert(!publicText.includes('w:/')); assert(!publicText.includes('"path"')); assert(!publicText.includes('"url"'));
  const physical = await call(catalog,'file',episode.versions[0].handle); assert.equal(physical.sourceId,'demo'); assert.equal(physical.classification.numbers[0],2);
  await call(catalog,'importScan','demo',{files:[ep(2)],partial:true});
  assert.equal((await call(catalog,'query',{kind:'episode',show:handle})).total,2);
  await assert.rejects(call(catalog,'query',{kind:'episode',cursor:episodes.nextCursor}),{code:'STALE_CURSOR'});
  await call(catalog,'importScan','demo',{files:[],partial:false});
  assert.equal((await call(catalog,'query',{kind:'episode',show:handle})).total,2);
  const restarted = new Catalog(root); await call(restarted,'open');
  assert.equal((await call(restarted,'query',{kind:'show'})).items[0].handle,handle);
  const selected=(await call(restarted,'query',{kind:'episode',show:handle})).items[0];
  await call(restarted,'edit',{operation:'setWatched',handle:selected.handle,expectedRevision:restarted.library.manifest.revision,watched:true});
  const details=await call(restarted,'detail',{kind:'episode',handle:selected.handle});
  await call(restarted,'edit',{operation:'classifyFile',handle:details.versions[0].handle,expectedRevision:details.revision,fields:{kind:'episode',showTitle:'Harbour',order:'aired',season:1,numbers:[3]}});
  const corrected=await call(restarted,'detail',{kind:'episode',handle:selected.handle});assert.equal(corrected.number,3);assert.equal(corrected.watchState,'watched','correcting number preserves episode identity and watch state');
  console.log('PASS durable scan import, stable grouping, numeric ordering, public projections, partial/empty protection and restart');
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e => {console.error(e); process.exitCode=1;});
