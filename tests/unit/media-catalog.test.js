/* Scan -> immutable library -> bounded public pages.  Synthetic records only. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog;
const root = fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-catalog-'));
const call = (object, method, ...args) => new Promise((resolve,reject) => object[method](...args,(e,r) => e ? reject(e) : resolve(r)));
function ep(n) { return {id:'w:/Harbour/S01E'+n+'.mkv',path:'/Harbour/S01E'+n+'.mkv',file:'Harbour.S01E'+n+'.mkv',kind:'episode',title:'Harbour',modified:new Date(Date.UTC(2026,0,n)).toISOString(),ancestors:['Harbour','Season 1'],classification:{showTitle:'Harbour',season:1,numbers:[n],order:'aired',title:'Harbour',review:[]}}; }
(async function () {
 try {
  const catalog = new Catalog(root); await call(catalog,'open');
  await call(catalog,'importScan','demo',{files:[ep(10),ep(2)],partial:false});
  const shows = await call(catalog,'query',{kind:'show'}); assert.equal(shows.total,1);
  const handle = shows.items[0].handle;
  await call(catalog,'edit',{operation:'setFavourite',handle,expectedRevision:catalog.revision,favourite:true});
  assert.equal((await call(catalog,'query',{kind:'show',favourite:false})).total,0,'favorites leave the general show list');
  assert.equal((await call(catalog,'query',{kind:'show',favourite:true})).items[0].handle,handle,'favorites remain in the favorites list');
  assert.equal((await call(catalog,'query',{kind:'show'})).total,1,'complete catalogue still includes favorites for editing and matching');
  await call(catalog,'edit',{operation:'setFavourite',handle,expectedRevision:catalog.revision,favourite:false});
  assert.equal((await call(catalog,'query',{kind:'show',favourite:false})).items[0].handle,handle,'removing favorite restores the show');
  // Recently added episodes: the show says which episode is newest, by the file's own date.
  const fresh = await call(catalog,'query',{kind:'show',sort:'new'}); assert.equal(fresh.total,1); assert.equal(fresh.items[0].newEp,'S1E10','the newest file is S01E10'); assert(fresh.items[0].newAt > 0);
  assert.equal((await call(catalog,'query',{kind:'show',sort:'aired'})).total,0,'no TMDB air dates yet: not on Recently aired');
  // The poster's count and the season that came at once: S01E02 (Jan 2) and S01E10 (Jan 10) came days apart.
  assert.equal(fresh.items[0].eps,2,'two episodes'); assert.equal(fresh.items[0].seen,0,'none watched'); assert.equal(fresh.items[0].newCount,1,'only E10 came with the newest'); assert.equal(fresh.items[0].newSeason,null);
  await call(catalog,'edit',{operation:'setWatched',handle,expectedRevision:catalog.revision,watched:true,season:'1'});
  const marked=(await call(catalog,'query',{kind:'show'})).items[0]; assert.equal(marked.seen,2,'marking the season counts both'); assert(marked.seenAt>0,'when last watched');
  await call(catalog,'edit',{operation:'setWatched',handle,expectedRevision:catalog.revision,watched:false,season:'1'});
  assert.equal((await call(catalog,'query',{kind:'show'})).items[0].seen,0,'and back');
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
  await call(restarted,'edit',{operation:'setWatched',handle:selected.handle,expectedRevision:restarted.revision,watched:true});
  const details=await call(restarted,'detail',{kind:'episode',handle:selected.handle});
  await call(restarted,'edit',{operation:'classifyFile',handle:details.versions[0].handle,expectedRevision:details.revision,fields:{kind:'episode',showTitle:'Harbour',order:'aired',season:1,numbers:[3]}});
  const corrected=await call(restarted,'detail',{kind:'episode',handle:selected.handle});assert.equal(corrected.number,3);assert.equal(corrected.watchState,'watched','correcting number preserves episode identity and watch state');
  // A whole season added at once (all within 12 hours): Season 2, 3 episodes.
  const s2=function(n){const e=ep(n);e.id='w:/Harbour/S02E'+n+'.mkv';e.path='/Harbour/S02E'+n+'.mkv';e.file='Harbour.S02E'+n+'.mkv';e.modified=new Date(Date.UTC(2026,5,1,n)).toISOString();e.classification=Object.assign({},e.classification,{season:2});return e;};
  await call(restarted,'importScan','demo',{files:[ep(2),ep(3),s2(1),s2(2),s2(3)],partial:false});
  const whole=(await call(restarted,'query',{kind:'show',sort:'new'})).items[0]; assert.equal(whole.newSeason,2,'season 2 came at once'); assert.equal(whole.newCount,3);
  console.log('PASS durable scan import, stable grouping, numeric ordering, public projections, partial/empty protection and restart');
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e => {console.error(e); process.exitCode=1;});
