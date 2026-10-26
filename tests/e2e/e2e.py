import asyncio, random, sys
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
URL='http://localhost:8078/index.html'
results=[]
def check(name, ok, extra=''):
    results.append((name, ok)); print(('PASS ' if ok else 'FAIL ')+name+(('  '+str(extra)) if extra!='' else ''))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required','--no-sandbox'])
        pg=await b.new_page(viewport={'width':1920,'height':1080})
        errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE: '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        ev=pg.evaluate
        async def key(k,n=1,w=180):
            for _ in range(n): await pg.keyboard.press(k); await pg.wait_for_timeout(w)
        async def code(c,w=250):
            await ev("c=>{document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:c,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{keyCode:c,bubbles:true}))}", c); await pg.wait_for_timeout(w)
        async def holdcode(c,ms=800):
            await ev("c=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:c,bubbles:true}))", c); await pg.wait_for_timeout(ms)
            await ev("c=>document.dispatchEvent(new KeyboardEvent('keyup',{keyCode:c,bubbles:true}))", c); await pg.wait_for_timeout(300)
        async def hold():
            await pg.keyboard.down('Enter'); await pg.wait_for_timeout(750); await pg.keyboard.up('Enter'); await pg.wait_for_timeout(300)
        async def shot(n): await pg.screenshot(path=SHOTS+'/v3_%s.png'%n)

        # ---- A. first run setup
        await pg.goto(URL)
        await ev("()=>{localStorage.clear();localStorage.setItem('tivibro.devRelay','47811');indexedDB.deleteDatabase('tivibro')}")
        await pg.reload(); await pg.wait_for_timeout(800)
        check('setup screen on first run', await ev("()=>!document.getElementById('viewSetup').classList.contains('hidden')"))
        # jump to Connect with empty fields -> validation
        async def focus_to(label):
            for _ in range(15):
                f=await ev("()=>{var e=document.querySelector('.setup .focus');return e?e.textContent:''}")
                if f.startswith(label): return
                await key('ArrowDown',w=60)
        await focus_to('Connect'); await key('Enter',w=400)
        check('setup validates empty fields', 'Enter the server' in await ev("()=>document.querySelector('.setup .msg').textContent"))
        await key('ArrowUp',10)
        await key('ArrowDown',2); await key('Enter'); await pg.keyboard.type('http://127.0.0.1:8077'); await key('Enter')
        await pg.keyboard.type('u'); await key('Enter'); await pg.keyboard.type('p'); await key('Enter')
        await focus_to('Connect'); await key('Enter',w=3000)
        check('connected and channel list shown', await ev("()=>document.getElementById('viewSetup').classList.contains('hidden') && Library.count()===2000"), await ev("()=>Library.count()"))
        await shot('a_live')

        # ---- B. playback + zapping
        await key('ArrowDown',2); await key('Enter',w=2500)
        check('OK goes fullscreen', await ev("()=>document.body.classList.contains('full')"))
        n0=await ev("()=>Views.playing && Views.playing.k")
        await key('PageUp',w=900)
        n1=await ev("()=>Views.playing && Views.playing.k")
        check('CH+ zaps to next channel', n0=='x3' and n1=='x4', (n0,n1))
        await pg.wait_for_timeout(1500)
        check('video plays after zap', await ev("()=>document.getElementById('video').currentTime>0"))

        # ---- C. remote remap
        await ev("()=>{Keymap.set('player','red','fav');Keymap.set('player','long:yellow','guide')}")
        before=await ev("()=>Library.isFav('x4')")
        await code(403)
        check('remapped Red toggles favorite in player', (await ev("()=>Library.isFav('x4')")) != before)
        await holdcode(405)
        check('long-press Yellow mapped to guide', await ev("()=>Views.tab")=='guide')
        await code(461,400)   # back -> live
        await ev("()=>Keymap.reset()")
        # learned key
        await ev("()=>{Keymap.learn(777);Keymap.set('list','k777','settings')}")
        await ev("()=>Views.switchTab('live')"); await pg.wait_for_timeout(300)
        await code(777,500)
        check('learned button opens settings', await ev("()=>Views.tab")=='settings')
        await ev("()=>{delete Store.settings.keyAliases['777'];Keymap.reset()}")
        # short OK must not be delayed when long not mapped (lists): measure
        await ev("()=>Views.switchTab('live')"); await pg.wait_for_timeout(300)

        # ---- D. name editor
        await ev("()=>{Views.switchTab('settings')}"); await pg.wait_for_timeout(300)
        await key('ArrowDown',2); await key('ArrowRight'); await key('Enter',w=300)   # Playlists -> first playlist page
        await shot('d_playlist')
        # find name editor row
        idx=await ev("()=>[...document.querySelectorAll('.opt')].findIndex(e=>e.textContent.indexOf('Channel name editor')===0)")
        cur=await ev("()=>[...document.querySelectorAll('.opt')].findIndex(e=>e.classList.contains('focus'))")
        for _ in range(idx-cur): await key('ArrowDown',w=60)
        await key('Enter',w=300); await shot('d_names')
        check('name editor page opens', 'Default rules, preloaded' in await ev("()=>document.getElementById('setBody').textContent"))
        check('defaults preloaded and on', await ev("()=>{var n=Store.playlist.names;return n.enabled&&n.rules.country&&n.rules.quality&&!n.rules.feeds}"))
        check('names cleaned in list', await ev("()=>Library.name(Library.find('x1'))")=='CNN', await ev("()=>Library.name(Library.find('x1'))"))
        await ev("()=>{var n=Store.playlist.names;Object.keys(n.rules).forEach(k=>n.rules[k]=false);Store.upsertPlaylist(Store.playlist);Names.invalidate();Library.dirty()}")
        check('rules off shows raw names', await ev("()=>Library.name(Library.find('x1'))")=='|US| CNN FHD')
        await ev("()=>{var n=Store.playlist.names;n.prefixes=['|US| '];n.suffixes=[' FHD'];Store.upsertPlaylist(Store.playlist);Names.invalidate()}")
        check('own prefix/suffix lists apply', await ev("()=>Library.name(Library.find('x1'))")=='CNN')
        await ev("()=>{var n=Store.playlist.names;n.rules=Names.defaults().rules;n.prefixes=[];n.suffixes=[];Store.upsertPlaylist(Store.playlist);Names.invalidate()}")
        # use the UI to add a prefix: walk down until the focused row is "Add a prefix"
        await ev("()=>Settings.open()")
        for _ in range(40):
            t=await ev("()=>{var f=document.querySelector('.opt.focus');return f?f.textContent:''}")
            if t.startswith('Add a prefix'): break
            if not t: await key('ArrowRight',w=80)
            else: await key('ArrowDown',w=60)
        await key('Enter',w=300)
        print('   modal', await ev("()=>document.getElementById('modalTitle').textContent"), await ev("()=>document.activeElement.tagName"))
        await pg.keyboard.type('NFL | '); await key('Enter',w=400)
        check('prefix added through UI', await ev("()=>JSON.stringify(Store.playlist.names.prefixes)")=='["NFL | "]', await ev("()=>JSON.stringify(Store.playlist.names.prefixes)"))
        check('UI prefix applies', await ev("()=>Names.clean('NFL | RedZone')")=='RedZone')
        await shot('d_names2')

        # ---- E. guide sources, priority, name match, assignment
        await ev("""()=>{var p=Store.playlist;p.epgSources=[{url:'http://127.0.0.1:8077/guide2.xml',offset:0}];p.providerEpg='xmltv';Store.upsertPlaylist(p);return Epg.refresh(Library,true)}""")
        await pg.wait_for_timeout(2500)
        st=await ev("()=>JSON.stringify(Epg.status)")
        check('two guide sources loaded', await ev("()=>Epg.status.sources.length===2 && Epg.status.sources.every(s=>s.ok)"), st[:200])
        t1=await ev("()=>{var n=Epg.nowNext(Library.find('x1'));return n&&n.now&&n.now.t}")
        t6=await ev("()=>{var n=Epg.nowNext(Library.find('x6'));return n&&n.now&&n.now.t}")
        check('priority: first source wins', (t1 or '').startswith('G2') and (t6 or '').startswith('X'), (t1,t6))
        check('name matching links channel without guide id', await ev("()=>Epg.hasData(Library.find('x7'))"), await ev("()=>Epg.epgId(Library.find('x7'))"))
        await ev("()=>Epg.assign(Library.find('x8'),'c3')"); await pg.wait_for_timeout(300)
        t8=await ev("()=>{var n=Epg.nowNext(Library.find('x8'));return n&&n.now&&n.now.t}")
        check('manual guide assignment', (t8 or '').startswith('G2 c3'), t8)
        await ev("()=>{var p=Store.playlist;p.epgSources[0].offset=60;Store.upsertPlaylist(p);return Epg.refresh(Library,true)}"); await pg.wait_for_timeout(2500)
        sh=await ev("()=>{var a=(Epg.request(Library.find('x1'))||[])[0];return a&&a.s}")
        await ev("()=>{var p=Store.playlist;p.epgSources[0].offset=0;Store.upsertPlaylist(p);return Epg.refresh(Library,true)}"); await pg.wait_for_timeout(2500)
        sh0=await ev("()=>{var a=(Epg.request(Library.find('x1'))||[])[0];return a&&a.s}")
        check('per-source time offset', sh and sh0 and sh-sh0==3600000, (sh,sh0))
        await ev("()=>Views.switchTab('guide')"); await pg.wait_for_timeout(800); await shot('e_guide')

        # ---- F. refresh schedule persisted
        await ev("()=>{var p=Store.playlist;p.plRefresh=-1;p.epgRefresh=24;Store.upsertPlaylist(p)}")
        await pg.wait_for_timeout(500)
        await pg.reload(); await pg.wait_for_timeout(3000)
        check('settings persist across restart', await ev("()=>Store.playlist.plRefresh===-1&&Store.playlist.epgRefresh===24&&Store.playlist.names.prefixes[0]==='NFL | '"))
        check('guide restored from cache', await ev("()=>Epg.xml && Epg.hasData(Library.find('x1'))"))

        # ---- G. monkey test
        keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','PageUp','PageDown','g','m','y','b','i','1','2']
        codes=[403,404,405,406,415,19,413,412,417,457,461]
        random.seed(7)
        for tabname in ['live','guide','movies','shows','search','settings','live']:
            await ev("t=>{UI.close();Views.switchTab(t)}", tabname); await pg.wait_for_timeout(400)
            for i in range(170):
                r=random.random()
                if r<0.75: await pg.keyboard.press(random.choice(keys))
                elif r<0.95: await code(random.choice(codes),0)
                else:
                    await pg.keyboard.down('Enter'); await pg.wait_for_timeout(650); await pg.keyboard.up('Enter')
                await pg.wait_for_timeout(random.choice([0,10,40,120]))
        await pg.wait_for_timeout(1500)
        bad=[e for e in errs if 'Key handler error' in e or 'PAGEERROR' in e]
        check('monkey test: no errors in ~1200 random presses', not bad, bad[:5])
        check('no console errors overall', not errs, errs[:5])
        await shot('g_after')
        await b.close()
    f=[r for r in results if not r[1]]
    print('\n%d passed, %d failed'%(len(results)-len(f), len(f)))
asyncio.run(main())
