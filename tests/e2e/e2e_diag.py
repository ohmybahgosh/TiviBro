import asyncio, json
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
res=[]
def check(n,ok,x=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  '+str(x)[:300] if x!='' else ''))

def settings(server, user, pw, relay=True, network='auto'):
    s={'playlists':[{'id':'p1','name':'T','type':'xtream','server':server,'user':user,'pass':pw,'m3u':''}],'active':'p1','resumeLast':False,'previewPlay':False,'network':network}
    js="localStorage.clear();indexedDB.deleteDatabase('tivibro');localStorage.setItem('tivibro.settings',%s);" % json.dumps(json.dumps(s))
    if relay: js+="localStorage.setItem('tivibro.devRelay','47811');"
    return "()=>{"+js+"}"

async def diag_lines(pg):
    await pg.evaluate("()=>Diag.run(Store.normalize(Object.assign({},Store.settings.playlists[0])))")
    for _ in range(60):
        await pg.wait_for_timeout(250)
        txt=await pg.evaluate("()=>[...document.querySelectorAll('.diag-body .dl')].map(e=>e.textContent).join('\\n')")
        if 'Done.' in txt: break
    # whole buffer, not just the visible window
    return await pg.evaluate("()=>{var o=[];document.querySelectorAll('.diag-body .dl').forEach(e=>o.push(e.textContent));return o.join('\\n')}")

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        async def fresh(js):
            pg=await b.new_page(viewport={'width':1920,'height':1080})
            await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(300)
            await pg.evaluate(js); await pg.reload(); await pg.wait_for_timeout(3500)
            return pg
        # Diag shows only the last screenful; read the full list from the module for assertions.
        async def full(pg):
            await pg.evaluate("()=>Diag.run(Store.normalize(Object.assign({},Store.settings.playlists[0])))")
            for _ in range(80):
                await pg.wait_for_timeout(250)
                done=await pg.evaluate("()=>document.querySelector('.diag-body').textContent.indexOf('Done.')>=0")
                if done: break
            await pg.keyboard.press('PageUp'); await pg.keyboard.press('PageUp'); await pg.keyboard.press('PageUp')
            top=await pg.evaluate("()=>document.querySelector('.diag-body').innerText")
            await pg.keyboard.press('PageDown'); await pg.keyboard.press('PageDown'); await pg.keyboard.press('PageDown')
            bot=await pg.evaluate("()=>document.querySelector('.diag-body').innerText")
            return top+'\n'+bot

        # 1. healthy
        pg=await fresh(settings('http://127.0.0.1:8077','goodu','secretpw'))
        t=await full(pg); await pg.screenshot(path=SHOTS+'/v4_diag_ok.png')
        check('healthy: helper step passes', '✓  Network helper' in t, t[:200])
        check('healthy: login accepted with account details', 'Login (player_api.php)' in t and 'accepted' in t and 'connections in use' in t)
        check('healthy: direct access reported blocked (no CORS)', 'blocked, as expected' in t)
        check('healthy: channel list counted', '2000 channels' in t)
        check('healthy: stream flows and is MPEG-TS', 'video is flowing' in t and 'MPEG-TS' in t, t[-600:])
        logtxt=await pg.evaluate("()=>Log.lines(true).join('\\n')")
        helper=await pg.evaluate("()=>fetch('http://127.0.0.1:47811/log').then(r=>r.text())")
        check('password never appears in app log', 'secretpw' not in logtxt)
        check('password never appears in helper log', 'secretpw' not in helper)
        check('diag screen does not show the password', 'secretpw' not in t)
        await pg.close()

        cases=[
          ('wrong password', settings('http://127.0.0.1:8077','bad','x'), 'Login rejected'),
          ('Cloudflare/HTML page', settings('http://127.0.0.1:8077','html','x'), 'web page instead of data'),
          ('empty answer', settings('http://127.0.0.1:8077','empty','x'), 'empty response'),
          ('unknown host', settings('http://nosuchhost.invalid:8080','u','p'), 'could not be found (DNS)'),
          ('refused port', settings('http://127.0.0.1:1','u','p'), 'refused the connection'),
          ('no port uses standard ports', settings('http://127.0.0.1','u','p'), 'no port given, so the standard one'),
        ]
        for name, js, expect in cases:
            pg=await fresh(js)
            t=await full(pg)
            check('diag explains: '+name, expect in t, t[-500:])
            if name=='wrong password':
                setup_visible=await pg.evaluate("()=>!document.getElementById('viewSetup').classList.contains('hidden')")
                check('failed login lands on setup with Network switch and Test button', setup_visible and 'Network' in await pg.evaluate("()=>document.getElementById('viewSetup').textContent") and 'Test connection' in await pg.evaluate("()=>document.getElementById('viewSetup').textContent"))
            await pg.close()

        # all connections in use + format warning
        pg=await fresh(settings('http://127.0.0.1:8077','full','x'))
        t=await full(pg)
        check('diag warns when all connections are in use', 'All connections are in use' in t)
        lg=await pg.evaluate("()=>Log.lines().join('\\n')")
        check('log warns that ts format is not allowed', 'does not list "ts"' in lg)
        await pg.close()

        # 3. no helper: setup screen can switch to Direct and test explains helper failure
        pg=await fresh(settings('http://127.0.0.1:8077','u','p', relay=False))
        st=await pg.evaluate("()=>document.getElementById('viewSetup').textContent")
        check('no helper: status shown on setup screen', 'Network helper: not running' in st, st[-200:])
        t=await full(pg)
        check('no helper: test names the reason', '✗  Network helper' in t and 'PalmServiceBridge' in t, t[:400])
        # switch to Direct from setup via the remote
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        for _ in range(12):
            f=await pg.evaluate("()=>{var e=document.querySelector('.setup .focus');return e?e.textContent:''}")
            if f.startswith('Network'): break
            await pg.keyboard.press('ArrowDown'); await pg.wait_for_timeout(80)
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(400)
        check('Network switched to Direct from the setup screen', await pg.evaluate("()=>Store.settings.network")=='direct')
        await pg.close()

        # 4. helper log viewer and app log viewer render
        pg=await fresh(settings('http://127.0.0.1:8077','u','p'))
        await pg.evaluate("()=>Diag.showHelperLog()"); await pg.wait_for_timeout(600)
        h=await pg.evaluate("()=>document.querySelector('.diag-body').innerText")
        check('helper log viewer shows requests', 'player_api.php' in h, h[:200])
        await pg.screenshot(path=SHOTS+'/v4_helperlog.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        await pg.evaluate("()=>Diag.showLog(true)"); await pg.wait_for_timeout(300)
        a=await pg.evaluate("()=>document.querySelector('.diag-body').innerText")
        check('app log viewer shows login details', 'Login answer: auth=1' in a or 'Loaded' in a, a[-300:])
        await pg.screenshot(path=SHOTS+'/v4_applog.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check('Back closes the viewer and returns control', await pg.evaluate("()=>!Diag.open"))
        await pg.close()
        await b.close()
    print('%d/%d passed'%(sum(res),len(res)))
asyncio.run(main())
