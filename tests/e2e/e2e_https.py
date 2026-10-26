import asyncio, json
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
res=[]
def check(n,ok,x=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  '+str(x)[:260] if x!='' else ''))

def settings(server, user='u', pw='p', fmt='ts'):
    s={'playlists':[{'id':'p1','name':'T','type':'xtream','server':server,'user':user,'pass':pw,'m3u':''}],'active':'p1','resumeLast':False,'previewPlay':False,'format':fmt}
    return "()=>{localStorage.clear();indexedDB.deleteDatabase('tivibro');localStorage.setItem('tivibro.devRelay','47811');localStorage.setItem('tivibro.settings',%s)}" % json.dumps(json.dumps(s))

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        async def fresh(js, wait=4500):
            pg=await b.new_page(viewport={'width':1920,'height':1080})
            errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(300)
            await pg.evaluate(js); await pg.reload(); await pg.wait_for_timeout(wait)
            pg.errs=errs
            return pg
        ev=lambda pg,js: pg.evaluate(js)

        # Address forms a provider hands out.  Expected: loads, and the saved server is the one that works.
        forms=[
          ('https with port, self-signed cert', 'https://127.0.0.1:8443', 'https://127.0.0.1:8443'),
          ('http with port', 'http://127.0.0.1:8077', 'http://127.0.0.1:8077'),
          ('bare host:port, server is http', '127.0.0.1:8077', 'http://127.0.0.1:8077'),
          ('bare host:port, server is https only', '127.0.0.1:8443', 'https://127.0.0.1:8443'),
          ('http typed but server is https only', 'http://127.0.0.1:8443', 'https://127.0.0.1:8443'),
          ('trailing slash and spaces', '  https://127.0.0.1:8443/  ', 'https://127.0.0.1:8443'),
          ('no port, like provider.example: bare host, https on 443', '127.0.0.1', 'https://127.0.0.1'),
          ('no port: https://host', 'https://127.0.0.1', 'https://127.0.0.1'),
          ('no port: http://host falls back to https', 'http://127.0.0.1', 'https://127.0.0.1'),
          ('pasted player_api link', 'https://127.0.0.1:8443/player_api.php?username=u&password=p', 'https://127.0.0.1:8443'),
        ]
        for name, typed, want in forms:
            pg=await fresh(settings(typed), 7000 if 'only' in name or 'typed' in name else 4500)
            n=await ev(pg,"()=>Library.count()")
            saved=await ev(pg,"()=>Store.playlist.server")
            check('loads: '+name, n==2000 and saved==want, (n, saved))
            await pg.close()

        # Credentials inside a pasted get.php link, username/password fields left empty
        pg=await fresh(settings('https://127.0.0.1:8443/get.php?username=u&password=p&type=m3u_plus&output=ts','',''), 5000)
        check('pasted get.php link with credentials', await ev(pg,"()=>Library.count()===2000 && Store.playlist.user==='u' && Store.playlist.server==='https://127.0.0.1:8443'"), await ev(pg,"()=>Store.playlist.server+' '+Store.playlist.user"))
        await pg.close()

        # Streams, catch-up and movies over self-signed HTTPS
        pg=await fresh(settings('127.0.0.1:8443'), 7000)
        await ev(pg,"()=>Views.startChannel(Library.find('x2'),false,Views.goFull)"); await pg.wait_for_timeout(4000)
        check('live channel plays over HTTPS (demuxer via helper)', await ev(pg,"()=>document.getElementById('video').currentTime>0"))
        u=await ev(pg,"()=>Source.streamUrl(Library.find('x2'),'ts')")
        check('stream address uses the detected https', u.startswith('https://127.0.0.1:8443/live/'), u)
        cu=await ev(pg,"()=>Source.catchupUrl(Library.find('x1'),Date.now()-3600e3,Date.now()-1800e3)")
        check('catch-up address uses https', cu.startswith('https://127.0.0.1:8443/timeshift/'), cu)
        await ev(pg,"()=>Views.switchTab('movies')"); await pg.wait_for_timeout(2500)
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(3500)
        src=await ev(pg,"()=>document.getElementById('video').currentSrc")
        check('movie on TV player goes through helper for HTTPS', '/x/https/127.0.0.1:8443/movie/' in src, src)
        check('movie plays over HTTPS', await ev(pg,"()=>document.getElementById('video').currentTime>0"))
        check('no page errors', not pg.errs, pg.errs[:3])
        await pg.close()

        # Diagnostics on a bare host that only answers https: shows what failed and what worked
        pg=await fresh(settings('127.0.0.1:8443'), 7000)
        await ev(pg,"()=>Diag.run(Store.normalize(Object.assign({},Store.settings.playlists[0],{server:'127.0.0.1:8443'})))")
        for _ in range(80):
            await pg.wait_for_timeout(250)
            if await ev(pg,"()=>document.querySelector('.diag-body').textContent.indexOf('Done.')>=0"): break
        await pg.keyboard.press('PageUp'); await pg.keyboard.press('PageUp')
        t=await ev(pg,"()=>document.querySelector('.diag-body').innerText")
        await pg.screenshot(path=SHOTS+'/v5_diag_https.png')
        check('diag explains no scheme given', 'no http or https given' in t, t[:400])
        check('diag shows the working address and the failed one', 'address that works: https://127.0.0.1:8443' in t and 'did not work: http://127.0.0.1:8443' in t)
        check('diag: no false "port missing" warning', 'No port given' not in t)
        await pg.close()

        # Neither scheme works: both attempts reported
        pg=await fresh(settings('127.0.0.1:1'), 6000)
        toast=await ev(pg,"()=>document.getElementById('toast').textContent")
        lg=await ev(pg,"()=>Log.lines().join('\\n')")
        check('both schemes tried and reported', 'Tried both http and https' in toast and 'tried:' in lg, toast)
        await pg.close()

        # Wrong password stops at the first scheme (no pointless second attempt)
        pg=await fresh(settings('https://127.0.0.1:8443','bad','x'), 5000)
        lg=await ev(pg,"()=>Log.lines().join('\\n')")
        check('wrong password: no scheme retry', 'Login rejected' in lg and 'trying http://' not in lg)
        await pg.close()
        await b.close()
    print('%d/%d passed'%(sum(res),len(res)))
asyncio.run(main())
