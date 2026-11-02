'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Catalog=require('../../service/media-catalog').Catalog,C=require('../../service/media-classify');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-corrections-'));
const call=(o,m,...args)=>new Promise((resolve,reject)=>o[m](...args,(e,r)=>e?reject(e):resolve(r)));
function file(n){return {id:'w:/Episode'+n+'.mkv',file:'Episode '+n+'.mkv',ancestors:['Unsorted'],kind:'episode',classification:C.classify({basename:'Episode '+n+'.mkv',ancestors:['Unsorted']})};}
(async()=>{try{
const c=new Catalog(root);await call(c,'open');await call(c,'importScan','demo',{files:[file(1),file(2)]});
let page=await call(c,'query',{kind:'review'});assert.equal(page.total,2);
let preview=await call(c,'edit',{operation:'previewCorrection',expectedRevision:page.revision,handles:page.items.map(f=>f.handle),fields:{kind:'episode',showTitle:'Harbour',season:1,order:'aired'}});
assert.equal(preview.count,2);assert.equal((await call(c,'query',{kind:'show'})).total,0,'preview does not mutate');
const saved=await call(c,'edit',{operation:'commitPreview',expectedRevision:preview.revision,previewToken:preview.previewToken});
assert.equal((await call(c,'query',{kind:'show'})).total,1);
await call(c,'edit',{operation:'undoEdit',expectedRevision:saved.revision,undoHandle:saved.undoHandle});
assert.equal((await call(c,'query',{kind:'show'})).total,0);
page=await call(c,'query',{kind:'review'});
preview=await call(c,'edit',{operation:'previewCorrection',expectedRevision:page.revision,folderOf:page.items[0].handle,fields:{kind:'episode',showTitle:'Harbour',season:1,order:'aired'}});
await call(c,'edit',{operation:'commitPreview',expectedRevision:preview.revision,previewToken:preview.previewToken});
await call(c,'importScan','demo',{files:[file(1),file(2),file(3)]});
assert.equal((await call(c,'query',{kind:'episode'})).total,3,'folder rule applies to new files on rescan');
await assert.rejects(call(c,'edit',{operation:'commitPreview',expectedRevision:preview.revision,previewToken:preview.previewToken}),{code:'CONFLICT'});
console.log('PASS atomic correction preview/commit, field-scoped undo, persisted folder rules and stale-preview rejection');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
