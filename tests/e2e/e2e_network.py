import asyncio
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
res=[]
def check(n,ok,x=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  '+str(x) if x!='' else ''))
SET="localStorage.setItem('tivibro.settings',JSON.stringify({playlists:[{id:'p1',name:'Main',type:'xtream',server:'http://127.0.0.1:8077',user:'u',pass:'p',m3u:'',epgSources:[{url:'http://127.0.0.1:8077/guide2.xml',offset:0}],providerEpg:'short'}],active:'p1',resumeLast:false,previewPlay:false}))"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        # 1. no relay, provider without CORS: must fail clearly, not hang
        pg=await b.new_page(viewport={'width':1920,'height':1080}); ev=pg.evaluate
        await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(300)
        await ev("()=>{localStorage.clear();indexedDB.deleteDatabase('tivibro');"+SET+"}")
        await pg.reload(); await pg.wait_for_timeout(9000)
        msg=await ev("()=>document.getElementById('toast').textContent")
        check('without helper: clear error shown', 'network helper is not running' in msg, msg)
        check('without helper: falls back to setup screen', await ev("()=>!document.getElementById('viewSetup').classList.contains('hidden')"))
        await pg.close()
        # 2. relay on, Workers broken: guide still loads via main-thread parser, playback via non-worker demux
        pg=await b.new_page(viewport={'width':1920,'height':1080}); ev=pg.evaluate
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: print('   console', m.type, m.text[:160]) if m.type in ('error','warning') and 'player' in m.text else None)
        await pg.add_init_script("window.Worker=function(){throw new Error('no workers')};")
        await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(300)
        await ev("()=>{localStorage.clear();indexedDB.deleteDatabase('tivibro');localStorage.setItem('tivibro.devRelay','47811');"+SET+"}")
        await pg.reload(); await pg.wait_for_timeout(5000)
        check('relay active', await ev("()=>Net.active && Net.port===47811"))
        check('guide loads without workers', await ev("()=>Epg.xml && Epg.hasData(Library.find('x1'))"), await ev("()=>JSON.stringify(Epg.status)"))
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(200)
        await ev("()=>Views.startChannel(Library.find('x2'),false,Views.goFull)"); await pg.wait_for_timeout(4000)
        check('playback without workers', await ev("()=>document.getElementById('video').currentTime>0"), await ev("()=>document.getElementById('vidError').textContent+' | '+document.getElementById('spinnerText').textContent+' | '+document.getElementById('meterSecs').textContent+' '+document.getElementById('meterText').textContent+' rs='+document.getElementById('video').readyState+' t='+document.getElementById('video').currentTime+' ranges='+(function(b){var o=[];for(var i=0;i<b.length;i++)o.push(b.start(i).toFixed(2)+'-'+b.end(i).toFixed(2));return o.join(',')})(document.getElementById('video').buffered)+' paused='+document.getElementById('video').paused"))
        check('relayed URL used for stream', 'x/http/127.0.0.1:8077/live' in (await ev("()=>performance.getEntriesByType('resource').map(r=>r.name).join(' ')")))
        check('no page errors', not errs, errs[:3])
        await b.close()
    print('%d/%d passed'%(sum(res),len(res)))
asyncio.run(main())
