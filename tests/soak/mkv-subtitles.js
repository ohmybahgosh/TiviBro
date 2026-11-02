/* Embedded subtitle menus and overlay in the real app and authenticated helper.
   Synthetic MKV bytes exercise extraction without requiring a browser MKV decoder.
   Start the mock provider and npm run serve, then run this file with Playwright. */
'use strict';
const {chromium} = require('playwright');
const http = require('http');
const {buildMkv} = require('../lib/mkv-fixture');
const R = require('../../scripts/demo/record');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const fixtures = {};
for (const codec of ['UTF8', 'ASS', 'SSA', 'WEBVTT']) fixtures['/' + codec + '.mkv'] = Buffer.from(buildMkv({
  subtitleTrack:{number:7,lang:'dut',codec:'S_TEXT/' + codec}, cuesIndexesSubtitle:true,
  indexPadding:codec === 'UTF8' ? 1631554 : 0,
  cueText:/ASS|SSA/.test(codec) ? '0,0,Default,,0,0,0,,{\\i1}Hello, world!\\NNext line' : '<b>Hello, world!</b>\nNext line'
}));
const auth = 'Basic ' + Buffer.from('demo:demo').toString('base64');
let requests = 0, fails = 0;
const ok = (n,c,detail) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && detail ? ' '+JSON.stringify(detail) : '')); if (!c) fails++; };
const server = http.createServer((q,s) => {
  if (q.headers.authorization !== auth) { s.writeHead(401); return s.end(); }
  requests++;
  const b = fixtures[q.url]; if (!b) { s.writeHead(404); return s.end(); }
  const r = /bytes=(\d+)-(\d+)/.exec(q.headers.range || '');
  const start = r ? +r[1] : 0, end = r ? Math.min(+r[2], b.length-1) : b.length-1;
  s.writeHead(r ? 206 : 200, Object.assign({'Content-Length':end-start+1,'Content-Type':'video/x-matroska'},r ? {'Content-Range':`bytes ${start}-${end}/${b.length}`} : {}));
  s.end(b.subarray(start,end+1));
});
(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:1920,height:1080}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(R.init({time:R.primeTime()})[0]);
    await page.goto(APP);
    await page.waitForFunction(()=>window.Library && Library.count() && Net.port, null, {timeout:60000});
    await page.evaluate(() => {
      Store.settings.autoSubs = false;
      Views.playVod({id:'mock-subs',title:'Mock movie',item:{}}, 'http://127.0.0.1:8077/mock.mp4', 0, function(){});
      Player.stop();
      var v=document.getElementById('video');
      Object.defineProperty(v,'readyState',{value:4,configurable:true});
      Object.defineProperty(v,'currentTime',{value:1.5,writable:true,configurable:true});
      Object.defineProperty(v,'buffered',{value:{length:1,start:function(){return 0;},end:function(){return 120;}},configurable:true});
    });
    for (const codec of Object.keys(fixtures).map(x=>x.slice(1,-4))) {
      const url = 'http://127.0.0.1:' + server.address().port;
      await page.evaluate(async ({codec,url}) => {
        UI.close();
        var r=await fetch('http://127.0.0.1:'+Net.port+'/media/resolve',{method:'POST',headers:Net.ctlHeaders({'Content-Type':'application/json'}),body:JSON.stringify({source:{type:'webdav',address:url,user:'demo',pass:'demo'},path:'/'+codec+'.mkv'})});
        var j=await r.json(); if(j.error)throw new Error(j.error);
        window.__embeddedTest=MkvSubs.extract(j.url,document.getElementById('video'));
      },{codec,url});
      await page.waitForFunction(()=>{var t=document.getElementById('video').textTracks;if(t.length)t[0].mode='hidden';return t.length && t[0].cues && t[0].cues.length;},null,{timeout:15000});
      await page.evaluate(()=>Views.runAction('subs','player'));
      ok(codec + ' appears as Dutch in the subtitle menu', /Dutch/.test(await page.innerText('#modal')));
      const rows=page.locator('#modal .mi'), count=await rows.count();
      let index=-1;
      for(let i=0;i<count;i++)if(/^Dutch/.test(await rows.nth(i).innerText()))index=i;
      const current=await page.evaluate(()=>[].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x=>x.classList.contains('focus')));
      for(let i=0;i<Math.abs(index-current);i++){await page.keyboard.press(index>current?'ArrowDown':'ArrowUp');await page.waitForTimeout(100);}
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      await page.evaluate(()=>document.getElementById('video').dispatchEvent(new Event('timeupdate')));
      const rendered=await page.evaluate(()=>{var v=document.getElementById('video'),t=v.textTracks[0];return {text:document.querySelector('.mkv-captions').textContent,mode:t.mode,time:v.currentTime,cues:Array.prototype.map.call(t.cues||[],function(c){return {s:c.startTime,e:c.endTime,text:c.text};})};});
      ok(codec + ' selected with the remote renders plain text', rendered.text==='Hello, world!\nNext line',rendered);
      if(codec === 'UTF8') {
        const exclusive=await page.evaluate(()=>{
          var v=document.getElementById('video'),chosen=v.textTracks[0],extra=v.addTextTrack('subtitles','English','en');
          extra.mode='showing';v.dispatchEvent(new Event('timeupdate'));
          return chosen.mode==='showing' && extra.mode==='disabled' && document.querySelector('.mkv-captions').textContent==='Hello, world!\nNext line';
        });
        ok('another enabled language cannot stack over the selected Dutch subtitles',exclusive);
        const seeks=await page.evaluate(()=>{
          var v=document.getElementById('video'),chosen=v.textTracks[0],extra=v.textTracks[1],ok=true;
          [0,5,1.5].forEach(function(time){v.currentTime=time;extra.mode='showing';v.dispatchEvent(new Event('seeking'));v.dispatchEvent(new Event('seeked'));ok=ok&&chosen.mode==='showing'&&extra.mode==='disabled';});
          return ok && document.querySelector('.mkv-captions').textContent==='Hello, world!\nNext line';
        });
        ok('backward and forward seeks keep only the selected language enabled',seeks);
        await page.evaluate(()=>{Subs._test.shift(1);document.getElementById('video').dispatchEvent(new Event('timeupdate'));});
        ok('Timing also shifts the embedded subtitle overlay',await page.evaluate(()=>document.querySelector('.mkv-captions').textContent===''));
        await page.evaluate(()=>{Subs._test.shift(-1);});
      }
      await page.evaluate(()=>{document.getElementById('video').currentTime=5;document.getElementById('video').dispatchEvent(new Event('timeupdate'));});
      ok(codec + ' disappears at its end time',await page.evaluate(()=>document.querySelector('.mkv-captions').textContent===''));
      await page.evaluate(()=>{window.__embeddedTest.cancel();document.getElementById('video').currentTime=1.5;});
    }
    ok('authenticated playback and subtitle reads reached the server',requests>16);
    ok('no uncaught app errors',errors.length===0);
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
  if(fails)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
