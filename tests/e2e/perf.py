import asyncio
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
SET="localStorage.setItem('tivibro.settings',JSON.stringify({playlists:[{id:'p1',name:'Main',type:'xtream',server:'http://127.0.0.1:8077',user:'u',pass:'p',m3u:'',epgSources:[],providerEpg:'short'}],active:'p1',resumeLast:false,previewPlay:false,buffer:'%s'}))"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        for prof in ['low','balanced','stable']:
            pg=await b.new_page(viewport={'width':1920,'height':1080}); ev=pg.evaluate
            await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(300)
            await ev("()=>{localStorage.clear();localStorage.setItem('tivibro.devRelay','47811');"+(SET%prof)+"}")
            await pg.reload(); await pg.wait_for_timeout(3000)
            times=[]
            for k in ['x2','x3','x4']:
                t=await ev("""k=>new Promise(r=>{var v=document.getElementById('video'),t0=performance.now();Views.startChannel(Library.find(k),false,Views.goFull);
                  var i=setInterval(()=>{if(v.currentTime>0&&!v.paused){clearInterval(i);r(Math.round(performance.now()-t0))}},20);setTimeout(()=>r(-1),15000)})""", k)
                times.append(t); await pg.wait_for_timeout(500)
            print(prof, 'tune ms:', times)
            await pg.close()
        await b.close()
asyncio.run(main())
