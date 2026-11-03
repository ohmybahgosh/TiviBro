/* Background TV metadata against the real immutable catalogue.  Synthetic sources only. */
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const Catalog=require('../../service/media-catalog').Catalog;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tivibro-series-auto-'));
const call=(c,method,q)=>new Promise((resolve,reject)=>c[method](q,(e,r)=>e?reject(e):resolve(r)));
function file(title,n){return {id:'demo:/'+title+'/S01E'+n+'.mkv',file:title+'.S01E'+n+'.mkv',title,kind:'episode',ancestors:[title,'Season 1'],classification:{showTitle:title,season:1,numbers:[n],order:'aired',review:[]}};}
(async()=>{
  try{
    const c=new Catalog(root);await new Promise((resolve,reject)=>c.open(e=>e?reject(e):resolve()));
    const files=[file('Harbour',1),file('Copper',1),file('Unknown',1)];
    await new Promise((resolve,reject)=>c.importScan('demo',{files,partial:false},e=>e?reject(e):resolve()));
    let token='mock-token',language='en',cancel=false,failSeason=false,failOne='';
    const lookups=[],notices=[];
    const ctx={Promise,Date,setTimeout:(f)=>setTimeout(f,0),clearTimeout,
      MediaStore:{tmdbToken:()=>token,preferences:()=>({language})},
      U:{toast:s=>notices.push(s)},Log:{warn(){}},Media:{refreshShows(){},request:(route,q)=>{
        if(route.indexOf('library/')===0)return call(c,route.slice(8),q);
        assert.equal(route,'metadata');lookups.push({...q});
        if(cancel){token='';return Promise.resolve({metadata:{id:'tmdb:tv:1'}});}
        if(q.title==='Unknown')return Promise.resolve({matches:[{id:'tmdb:tv:8'},{id:'tmdb:tv:9'}]});
        const id=q.id||'tmdb:tv:'+(q.title==='Harbour'?1:2);
        if(failSeason&&q.season!=null)return Promise.resolve({error:'metadata',message:'TMDB unavailable'});
        if(failOne&&q.season!=null&&id===failOne)return Promise.resolve({error:'metadata',message:'Season details were unavailable'});
        return Promise.resolve({metadata:q.season!=null?{id:id+':season:'+q.season,title:'Season one',episodes:[{id:id+':season:1:episode:1',season:1,number:1,title:'Pilot '+language,plot:'Episode summary',still:'https://image.tmdb.org/test.jpg'}]}:{id,provider:'TMDB',requestedLanguage:language,title:'Matched '+(q.title||id),poster:'https://image.tmdb.org/poster.jpg'}});
      }}};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/js/media-series.js','utf8'),ctx);
    const job=ctx.MediaSeries.fetchDetails(false);
    assert((await ctx.MediaSeries.fetchDetails(false)).skipped,'concurrent job is skipped');
    ctx.MediaSeries.leave(); // Browsing elsewhere must not cancel background metadata.
    const result=await job;assert.equal(result.updated,2);assert.equal(result.missed,1);assert(!result.error,result.error);
    const shows=(await call(c,'query',{kind:'show'})).items;
    const harbour=shows.find(x=>x.title==='Harbour');
    assert.equal(harbour.metadata.id,'tmdb:tv:1');assert(harbour.metadata.poster);
    const episodes=await call(c,'query',{kind:'episode',show:harbour.handle});
    const detail=await call(c,'detail',{kind:'episode',handle:episodes.items[0].handle});
    assert.equal(detail.metadata.title,'Pilot en');assert(detail.metadata.plot&&detail.metadata.still);
    assert(lookups.every(q=>q.credential==='mock-token'&&q.language==='en'));
    const count=lookups.length;await ctx.MediaSeries.fetchDetails(false);assert.equal(lookups.length,count,'completed matches and recent misses are not repeated');
    assert.equal((await call(c,'query',{kind:'show',metadataPending:true,language:'en'})).total,0);
    language='nl';const translated=await ctx.MediaSeries.fetchDetails(false);assert.equal(translated.updated,2);
    assert(lookups.slice(count).filter(q=>q.id&&q.season==null).length===2,'existing selected IDs are reused');
    assert.equal((await call(c,'detail',{kind:'episode',handle:detail.handle})).metadata.title,'Pilot nl');
    await new Promise(resolve=>setTimeout(resolve,3));
    const beforeForce=lookups.length;await ctx.MediaSeries.fetchDetails(true);
    assert(lookups.slice(beforeForce).some(q=>q.title==='Unknown'),'explicit fetch retries ambiguous matches');
    await new Promise((resolve,reject)=>c.importScan('demo',{files:files.map(x=>({...x})),partial:false},e=>e?reject(e):resolve()));
    assert.equal((await call(c,'query',{kind:'show',metadataPending:true,language:'nl'})).total,2,'new scans refresh owned episodes while misses keep their cooldown');
    cancel=true;const aborted=await ctx.MediaSeries.fetchDetails(false);assert(aborted.error&&/token/.test(aborted.error));
    assert.equal((await call(c,'detail',{kind:'show',handle:harbour.handle})).metadata.id,'tmdb:tv:1','token removal prevents late metadata writes');
    cancel=false;token='mock-token';failSeason=true;const failed=await ctx.MediaSeries.fetchDetails(false);assert(failed.error);
    assert((await call(c,'query',{kind:'show',metadataPending:true,language:'nl'})).total>0,'failed season stays pending for retry');
    // One show failing is set aside (checked, missed) and the run goes on with the others.
    failSeason=false;failOne='tmdb:tv:1';await new Promise(resolve=>setTimeout(resolve,3));
    const one=await ctx.MediaSeries.fetchDetails(true);
    assert(!one.error,one.error);assert(one.missed>=1&&one.updated>=1,'the other show still gets its details: '+JSON.stringify(one));
    console.log('PASS automatic show matches, owned episode enrichment, bounded pending queries, saved IDs, language refresh, miss cooldown, explicit retry and cancellation');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
