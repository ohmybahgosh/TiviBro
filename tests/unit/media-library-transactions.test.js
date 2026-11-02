'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Library=require('../../service/media-library'),Catalog=require('../../service/media-catalog').Catalog,C=require('../../service/media-classify');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-transactions-'));
const call=(o,m,...args)=>new Promise((resolve,reject)=>o[m](...args,(e,r)=>e?reject(e):resolve(r)));
(async()=>{try{
const lib=new Library(root);await call(lib,'open');await call(lib,'append','episodes',[{id:'a',value:1}],0);await call(lib,'append','episodes',[{id:'b',value:2}],1);
const unchanged=lib.manifest.pages.episodes[1].name;
await call(lib,'patch',[{family:'episodes',id:'a',update:r=>{r.value=3;}}],2);assert.equal(lib.manifest.pages.episodes[1].name,unchanged,'unaffected page stays immutable and is reused');
const oldRevision=lib.manifest.revision,rename=fs.rename;let failed=false;
fs.rename=function(from,to,cb){if(!failed&&to===path.join(root,'manifest.json')){failed=true;return process.nextTick(()=>cb(Object.assign(new Error('full'),{code:'ENOSPC'})));}return rename.apply(this,arguments);};
try{await assert.rejects(call(lib,'patch',[{family:'episodes',id:'a',update:r=>{r.value=99;}}],oldRevision),{code:'ENOSPC'});}finally{fs.rename=rename;}
assert.equal(lib.manifest.revision,oldRevision);const recovered=new Library(root);await call(recovered,'open');assert.equal((await call(recovered,'query','episodes',{})).items[0].value,3,'failed manifest publication preserves committed data');
const lease=recovered.retain(recovered.manifest);const retained=recovered.manifest.pages.episodes[0].name;
await call(recovered,'patch',[{family:'episodes',id:'a',update:r=>{r.value=4;}}],recovered.manifest.revision);
await call(recovered,'patch',[{family:'episodes',id:'a',update:r=>{r.value=5;}}],recovered.manifest.revision);
fs.readdirSync(root).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).forEach(n=>fs.utimesSync(path.join(root,n),new Date(0),new Date(0)));
await call(recovered,'collect',0);assert(fs.existsSync(path.join(root,retained)),'active reader generation survives cleanup');lease();await call(recovered,'collect',0);assert(!fs.existsSync(path.join(root,retained)),'unreferenced old generation is collected');
const catRoot=path.join(root,'catalog');const c=new Catalog(catRoot);await call(c,'open');const name='Harbour.S01E01.mkv';await call(c,'importScan','demo',{files:[{id:'w:/one',file:name,kind:'episode',ancestors:[],classification:C.classify({basename:name})}]});
const shows=await call(c,'query',{kind:'show'}),q={operation:'setFavourite',handle:shows.items[0].handle,favourite:true,expectedRevision:shows.revision,idempotencyKey:'favourite_demo'};
const saved=await call(c,'edit',q),again=await call(c,'edit',q);assert(again.duplicate);assert.equal(again.revision,saved.revision);assert.equal(c.library.manifest.revision,saved.revision,'idempotent retry does not publish twice');
await assert.rejects(call(c,'edit',Object.assign({},q,{favourite:false})),{code:'CONFLICT'});
console.log('PASS page-local mutation, ENOSPC rollback, reader-safe garbage collection and durable command idempotence');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
