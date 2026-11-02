/* Helper stress corpus; no provider or TV is contacted.  Run with node --expose-gc. */
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Catalog=require('../../service/media-catalog').Catalog,C=require('../../service/media-classify');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-large-'));
const call=(o,m,...args)=>new Promise((resolve,reject)=>o[m](...args,(e,r)=>e?reject(e):resolve(r)));
(async()=>{try{
const c=new Catalog(root);await call(c,'open');if(global.gc)global.gc();const baseline=process.memoryUsage().heapUsed;let peak=baseline;const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},10);
let files=[];for(let i=0;i<50000;i++){const show='Show '+Math.floor(i/100),file=show+'.S01E'+(i%100+1)+'.mkv';files.push({id:'w:/'+file,file,kind:'episode',title:show,ancestors:[show,'Season 1'],classification:C.classify({basename:file,ancestors:[show,'Season 1']},{compact:true})});}
for(let i=0;i<5000;i++)files.push({id:'w:/Movie'+i+'.mkv',file:'Movie'+i+'.mkv',kind:'movie',title:'Movie '+i,ancestors:[],classification:{kind:'movie',title:'Movie '+i,review:[]}});
console.log(JSON.stringify({phase:'observations',heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));
const started=Date.now();await call(c,'importScan','demo',{files,partial:false,consume:true});files=null;if(global.gc)global.gc();
const pageStart=Date.now(),shows=await call(c,'query',{kind:'show',limit:60});const pageMs=Date.now()-pageStart;assert.equal(shows.total,500);assert.equal(shows.items.length,60);
const episodePage=await call(c,'query',{kind:'episode',show:shows.items[0].handle,limit:60});assert.equal(episodePage.total,100);assert.equal(episodePage.items.length,60);
const detail=await call(c,'detail',{kind:'episode',handle:episodePage.items[0].handle});let reads=0;const original=c.library.readPage;c.library.readPage=function(...args){reads++;return original.apply(this,args);};
const file=await call(c,'file',detail.versions[0].handle);assert(file);assert(reads<10,'file lookup must skip unrelated pages');assert(c.library.cacheBytes<=8388608);
clearInterval(sampler);if(global.gc)global.gc();
console.log(JSON.stringify({episodes:50000,movies:5000,shows:shows.total,importMs:Date.now()-started,cachedPageMs:pageMs,lookupPages:reads,heapIncreaseMiB:Math.round((process.memoryUsage().heapUsed-baseline)/1048576),peakHeapIncreaseMiB:Math.round((peak-baseline)/1048576),pageCacheBytes:c.library.cacheBytes}));
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
