/* Guide source failure versus a usable public fallback, using only local servers.
   Start MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js and npm run serve.
   GUIDE_IN_APP=1 also exercises the in-app worker instead of helper storage. */
'use strict';
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'guide-fallback-'));
process.env.TIVIBRO_KV_DIR=path.join(testData,'kv');
process.env.TIVIBRO_GUIDE_DIR=path.join(testData,'guide');
const proxy=require('../../service/proxy'),R=require('../../scripts/demo/record');
const APP=process.env.APP||'http://127.0.0.1:8078/index.html';
const MOCK=process.env.MOCK||'http://127.0.0.1:8088';
let providerFails=true,publicFails=false,empty=false,publicReads=0,fails=0;
const ok=(n,c)=>{console.log((c?'PASS ':'FAIL ')+n);if(!c)fails++;};
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+s.address().port)));
const upstream=http.createServer((q,s)=>{
  if(/^\/xmltv.php/.test(q.url)&&providerFails){s.writeHead(404);return s.end('missing provider guide');}
  if(/^\/pubepg\//.test(q.url)){
    publicReads++;
    if(publicFails){s.writeHead(404);return s.end('missing public guide');}
    if(empty){s.writeHead(200,{'Content-Type':'application/xml'});return s.end('<?xml version="1.0"?><tv></tv>');}
  }
  const target=new URL(q.url,MOCK);
  const req=http.get(target,r=>{s.writeHead(r.statusCode,r.headers);r.pipe(s);});
  req.on('error',()=>{s.writeHead(502);s.end();});
});
(async()=>{
  const base=await listen(upstream),relay=proxy.create({}),rb=await listen(relay.server),b=await chromium.launch();
  const errors=[];
  async function open(id,pub=true){
    const page=await b.newPage();page.on('pageerror',e=>errors.push(e.message));
    const pl=Object.assign({},R.SETTINGS.playlists[0],{id,server:base,epgRefresh:-1,pubEpg:{on:pub,cc:['US']}});
    await page.addInitScript(R.init({time:Date.now(),settings:{active:id,playlists:[pl],pubEpgBase:base+'/pubepg/',guideInApp:!!process.env.GUIDE_IN_APP}})[0]);
    await page.addInitScript(port=>{
      localStorage.setItem('tivibro.devRelay',String(port));
      window.__guideProgress=[];window.__guideToasts=[];
      document.addEventListener('DOMContentLoaded',()=>{});
    },relay.server.address().port);
    // Scripts are loaded in order; collect the complete startup sequence before App starts.
    await page.route(/\/js\/app(\.[0-9a-f]{10})?\.js$/,async route=>{   // plain, or hashed in the packaged build (test-build.sh)
      const r=await route.fetch();const text=await r.text();
      await route.fulfill({response:r,body:'Epg.onProgress(function(p){window.__guideProgress.push(p);}); var oldToast=U.toast; U.toast=function(m){window.__guideToasts.push(m); return oldToast.apply(U,arguments);};\n'+text});
    });
    await page.goto(APP);
    await page.waitForFunction(()=>window.Library&&Library.count()&&Epg.progress.phase&&!Epg.loading&&!Epg.progress.active,null,{timeout:60000});
    return page;
  }
  async function state(p){return p.evaluate(()=>({p:Epg.progress,chip:document.getElementById('epgProg').textContent,history:window.__guideProgress,toasts:window.__guideToasts}));}
  try{
    let page=await open('fresh'),s=await state(page);
    ok('provider failure first says it is checking public guides',s.history.some(p=>p.phase==='fallback'&&/Provider guide unavailable; checking public guides/.test(p.message)));
    ok('fresh public listings report a usable fallback',s.p.phase==='done'&&s.p.message==='Provider guide unavailable; using public guides.'&&s.p.channels>0);
    ok('the TV chip shows the fallback message',s.chip===s.p.message);
    ok('the original HTTP failure remains in diagnostics',/404/.test(s.p.error)&&s.p.report.some(r=>!r.ok&&/404/.test(r.error)));
    ok('no misleading source-failed toast while fallback is being checked',!s.toasts.some(t=>/Guide source failed/.test(t)));
    const reads=publicReads;await page.reload();
    await page.waitForFunction(()=>window.Library&&Library.count()&&Epg.progress.message&&Epg.progress.phase==='done'&&!Epg.loading,null,{timeout:60000});
    s=await state(page);ok('saved public listings also report fallback without a download',s.p.message==='Provider guide unavailable; using public guides.'&&publicReads===reads);
    // Check the editor uses the same status message and preserves the source failure.
    const status=await page.evaluate(()=>WebEdit.start()),password=await page.evaluate(()=>WebEdit.password()),editor=await b.newPage();
    await editor.goto('http://127.0.0.1:'+status.port+'/');await editor.fill('#pw',password);await editor.click('#loginBtn');
    const rendered=await editor.evaluate(p=>{var message='',old=toast;toast=function(s){message=s;};lastProgress={active:false,phase:'done'};onProgress(p);toast=old;drawProgress(p);return {text:document.getElementById('gProg').textContent,toast:message};},s.p);
    ok('the web editor shows the same fallback and source failure',rendered.text.includes(s.p.message)&&rendered.text.includes('404')&&rendered.toast===s.p.message);
    await editor.close();await page.evaluate(()=>WebEdit.stop());await page.close();
    publicFails=true;page=await open('both-fail');s=await state(page);
    ok('both sources failing remains an error without claiming fallback',s.p.phase==='error'&&/no matching listings/.test(s.p.message)&&!/using public guides/.test(s.p.message));await page.close();
    publicFails=false;empty=true;page=await open('no-matches');s=await state(page);
    ok('successful public downloads without matches are not called usable',s.p.phase==='error'&&/no matching listings/.test(s.p.message));await page.close();
    empty=false;page=await open('disabled',false);s=await state(page);
    ok('public guides disabled keeps the ordinary provider error',s.p.phase==='error'&&/404/.test(s.p.error)&&!s.p.message&&s.toasts.some(t=>/Guide source failed/.test(t)));await page.close();
    providerFails=false;page=await open('healthy');s=await state(page);
    ok('a healthy provider keeps the ordinary success message',s.p.phase==='done'&&!s.p.message);await page.close();
    ok('no uncaught browser errors',errors.length===0);
  }finally{await b.close();await Promise.all([upstream,relay.server].map(s=>new Promise(r=>s.close(r))));fs.rmSync(testData,{recursive:true,force:true});}
  if(fails)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
