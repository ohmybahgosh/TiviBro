'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-migrate-'));process.env.TIVIBRO_KV_DIR=root;
const Kv=require('../../service/kv'),Catalog=require('../../service/media-catalog').Catalog,Migrate=require('../../service/media-migrate'),Reader=require('../../service/media-legacy-reader');
const call=(o,m,...args)=>new Promise((resolve,reject)=>o[m](...args,(e,r)=>e?reject(e):resolve(r)));
(async()=>{try{
const legacy=Kv.fileOf('media:lib');const records=Array.from({length:600},(_,i)=>({id:'demo|w:/Movie'+i+'.mkv',src:'demo',title:'电影 { "text" } '+i,file:'Movie'+i+'.mkv',path:'/Movie'+i+'.mkv',addedAt:123,metadata:{id:'tmdb:7',title:'Saved match'}}));fs.writeFileSync(legacy,JSON.stringify(records));
const reader=new Reader(legacy);let count=0,max=0;for(;;){const rows=await call(reader,'next');if(!rows)break;count+=rows.length;max=Math.max(max,rows.length);}reader.close();assert.equal(count,600);assert.equal(max,256);
const c=new Catalog(Kv.sub('media-v2'));await call(c,'open');let result=await new Promise((resolve,reject)=>Migrate.migrate(c,{},(e,r)=>e?reject(e):resolve(r)));assert.equal(result.count,600);
const page=await call(c,'query',{kind:'movie'});assert.equal(page.total,600);assert.equal(page.items[0].addedAt,123);assert.equal(page.items[0].metadata.id,'tmdb:movie:7');
assert.equal(JSON.parse(fs.readFileSync(path.join(c.library.root,'legacy-movies.snapshot.json'),'utf8')).length,600);
result=await new Promise((resolve,reject)=>Migrate.migrate(c,{},(e,r)=>e?reject(e):resolve(r)));assert(result.migrated);assert.equal((await call(c,'query',{kind:'movie'})).total,600,'idempotent migration');
console.log('PASS streamed Unicode/string-safe migration, bounded batches, typed metadata, snapshot recovery and idempotence');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
