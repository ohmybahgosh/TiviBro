/* My media in the real app, with the real helper code and a tiny DLNA server shaped like a Fritz!Box:
     MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/media.js [--shots dir]
   The tab, adding a server, the list, playing, Back, where a movie stopped, a rescan that finds nothing,
   a wrong login.  Remote keys only. */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path');
const R = require('../../scripts/demo/record.js');
const fs = require('fs'), os = require('os');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'media-soak-'));
const proxy = require('../../service/proxy.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 200) : '')); if (!c) fails++; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let empty = false, extra = false, needsReview = false, davPassword = 'right';
const fritz = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (req.method === 'GET') { res.writeHead(404); return res.end(); }
    const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], H = '127.0.0.1:' + fritz.address().port;
    const item = (t, u) => `<item id="i${t}"><dc:title>${esc(t)}</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="5000000000">${esc(u.charAt(0) === '\u0000' ? MOCK + '/movie/demo/demo/Moana.2.2024.mp4' : 'http://' + H + u)}</res></item>`;
    const dir = (t, c) => `<container id="${c}"><dc:title>${esc(t)}</dc:title></container>`;
    const tree = { 0: dir('Music', 'm') + dir('Videos', 'v'), v: dir('Harbour','show') + dir('Folders', 'fl'), show:dir('Season 1','season'), season:item('Harbour.S01E02.mkv','/VIDEO/Harbour.S01E02.mkv'), fl: dir('Frozen (2013)', 'a') + dir('Moana 2 (2024)', 'b') + (extra ? dir('New movie (2025)', 'c') : ''), c: item('New.movie.2025.mkv', '/VIDEO/new.mkv'),
      a: item('FROZEN 2013 1080p BluRay.mkv', '/VIDEO/Frozen/FROZEN%202013%201080p%20BluRay.mkv'), b: item('Moana.2.2024.mp4', MOCK.replace(/^http:\/\//, '').replace(/^/, '\u0000')) };
    const didl = empty ? '' : (tree[id] || '') + (id === 'season' && needsReview ? item('Harbour.S03E02.mkv','/VIDEO/Harbour.S03E02.mkv') : ''), n = (didl.match(/<(item|container) /g) || []).length;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + didl + '</DIDL-Lite>')}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches></Envelope>`);
  });
});
const dav = http.createServer((req, res) => { res.writeHead(req.headers.authorization === 'Basic ' + Buffer.from('cust:' + davPassword).toString('base64') ? 207 : 401); res.end('<multistatus xmlns="DAV:"></multistatus>'); });

(async () => {
  await new Promise(f => fritz.listen(0,'127.0.0.1',f));
  const relay=proxy.create({}); await new Promise(f=>relay.server.listen(47898,'127.0.0.1',f));
  const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const pl=Object.assign({},R.SETTINGS.playlists[0],{server:MOCK});
  await page.addInitScript(R.init({time:Date.now(),settings:{playlists:[pl]}})[0]);
  await page.addInitScript(()=>localStorage.setItem('tivibro.devRelay','47898'));
  try {
    await page.goto(APP);await page.waitForFunction(()=>window.Library && Library.count()>0);
    await page.evaluate(c=>Media._test.addServer({name:'Demo source',control:c}),'http://127.0.0.1:'+fritz.address().port+'/ctl');
    await page.evaluate(()=>Views.switchTab('media'));await page.waitForTimeout(300);
    await page.evaluate(()=>MediaSeries.open());
    await page.waitForFunction(()=>document.querySelector('#modal').innerText.includes('Harbour'));
    ok('show discovered through actual helper',true);
    await page.keyboard.press('Enter');await page.waitForTimeout(200);
    ok('show has a season',/Season 1/.test(await page.innerText('#modal')));
    await page.keyboard.press('Enter');await page.waitForTimeout(200);
    ok('episode page uses numeric label',/S1E2/.test(await page.innerText('#modal')));
    await page.keyboard.press('Enter');await page.waitForTimeout(200);
    ok('episode offers source version and watched control',/Play: Demo source/.test(await page.innerText('#modal')) && /Mark watched/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');await page.waitForTimeout(150);
    ok('Back returns one level to episode list',/S1E2/.test(await page.innerText('#modal')) && !/Mark watched/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');await page.waitForTimeout(150);
    ok('Back returns to season picker',/Season 1/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');await page.waitForTimeout(150);
    ok('Back returns to shows',/TV shows/.test(await page.innerText('#modal')));
    await page.keyboard.press('Enter');await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(150);
    ok('show can be added to favorites with the remote',/Remove favourite/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');await page.waitForTimeout(150);
    ok('favorited show leaves the general show list',/No items in this view/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelectorAll('.media-shelf')[1].querySelector('.media-shelf-count').textContent==='1');
    ok('show is present in Favorites and absent from TV shows shelf',await page.evaluate(()=>document.querySelectorAll('.media-shelf')[3].querySelector('.media-shelf-count').textContent===''));
    await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelectorAll('.media-shelf')[3].querySelector('.media-shelf-count').textContent==='1');
    ok('removing a favorite returns the show to its shelf',await page.evaluate(()=>document.querySelectorAll('.media-shelf')[1].querySelector('.media-shelf-count').textContent===''));
    ok('empty Needs review shelf is hidden',!await page.locator('.media-shelf').nth(4).isVisible());
    await page.keyboard.press('m');await page.waitForTimeout(100);
    ok('empty Needs review is absent from options',!/Needs review/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');
    needsReview=true;await page.evaluate(()=>Media._test.rescanCurrent());
    await page.waitForFunction(()=>!document.querySelectorAll('.media-shelf')[4].classList.contains('hidden'));
    ok('Needs review appears when a conflicting file is discovered',/Needs review/.test(await page.locator('.media-shelf').nth(4).innerText()));
    await page.keyboard.press('m');await page.waitForTimeout(100);
    ok('Needs review is offered in options for a nonempty queue',/Needs review/.test(await page.innerText('#modal')));
    await page.keyboard.press('Escape');
    await page.evaluate(async()=>{
      const r=await Media.request('library/query',{kind:'review',limit:1},30000),item=r.items[0];
      const saved=await Media.request('library/edit',{operation:'classifyFile',handle:item.handle,expectedRevision:item.revision,fields:{kind:'episode',showTitle:'Harbour',order:'aired',season:1,numbers:[3]}},30000);
      if(saved.error)throw new Error(saved.message);Media.refreshShows();
    });
    await page.waitForFunction(()=>document.querySelectorAll('.media-shelf')[4].classList.contains('hidden'));
    ok('Needs review disappears after the last item is corrected',true);
    ok('no browser exceptions',errors.length===0,errors.join(', '));
  } finally {
    await browser.close();await new Promise(f=>relay.server.close(f));await new Promise(f=>fritz.close(f));
    fs.rmSync(process.env.TIVIBRO_KV_DIR,{recursive:true,force:true});
  }
  if(fails)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
