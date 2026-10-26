import asyncio
from playwright.async_api import async_playwright
import os
CHROME=os.environ.get('TIVIBRO_CHROME') or None   # None = Playwright's bundled Chromium
SHOTS=os.environ.get('TIVIBRO_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots')); os.makedirs(SHOTS, exist_ok=True)
res=[]
def check(n,ok,x=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  '+str(x) if x!='' else ''))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1920,'height':1080})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'Failed to load' not in m.text else None)
        ev=pg.evaluate
        async def key(k,n=1,w=150):
            for _ in range(n): await pg.keyboard.press(k); await pg.wait_for_timeout(w)
        await pg.goto('http://localhost:8078/index.html'); await pg.wait_for_timeout(400)
        # v0.2-format settings to prove migration
        await ev("""()=>{localStorage.clear();localStorage.setItem('tivibro.devRelay','47811');indexedDB.deleteDatabase('tivibro');localStorage.setItem('tivibro.settings',JSON.stringify({playlists:[{id:'p1',name:'XC',type:'xtream',server:'http://127.0.0.1:8077',user:'u',pass:'p',m3u:'',epg:''}],active:'p1',names:{enabled:true,groups:true,packs:{country:true,quality:false,tags:true,superscript:true},prefixes:'NOW: ',suffixes:''},resumeLast:false,previewPlay:false}));localStorage.setItem('tivibro.edits.p1',JSON.stringify({custom:[{id:'c_fav',name:'Favorites',items:['x5']}]}))}""")
        await pg.reload(); await pg.wait_for_timeout(3000)
        check('migrated name settings into playlist', await ev("()=>{var n=Store.playlist.names;return n.rules.quality===false&&n.prefixes[0]==='NOW: '}"))
        check('old favorites kept', await ev("()=>Library.isFav('x5')"))
        # add M3U playlist through setup UI
        await ev("()=>App.setup('new')"); await pg.wait_for_timeout(300)
        await key('Enter',w=300)   # type field -> toggles to M3U
        await key('ArrowDown'); await key('Enter'); await pg.keyboard.type('Test M3U'); await key('Enter')
        await pg.keyboard.type('http://127.0.0.1:8077/list.m3u'); await key('Enter')
        for _ in range(12):
            f=await ev("()=>{var e=document.querySelector('.setup .focus');return e?e.textContent:''}")
            if f=='Connect': break
            await key('ArrowDown',w=60)
        await key('Enter',w=3000)
        check('M3U playlist added and active', await ev("()=>Store.playlist.type==='m3u'&&Library.count()===30"), await ev("()=>Store.playlist.type+' '+Library.count()"))
        check('M3U names cleaned with fresh defaults', await ev("()=>Library.name(Library.data.channels[0])")=='Chan 1', await ev("()=>Library.name(Library.data.channels[0])"))
        check('M3U group names cleaned', await ev("()=>Library.groups().some(g=>g.name==='Group 2')"))
        await pg.wait_for_timeout(2000)
        check('M3U playlist guide from url-tvg', await ev("()=>Epg.xml && Epg.hasData(Library.data.channels[0])"))
        check('M3U catch-up flag', await ev("()=>Library.data.channels[0].arch===2"))
        u=await ev("()=>{var c=Library.data.channels[0];return Source.catchupUrl(c,Date.now()-3600e3,Date.now()-1800e3)}")
        check('M3U catch-up URL (default/shift)', '?utc=' in u, u)
        check('edits are per playlist', await ev("()=>!Library.isFav('x5') && Store.edits.custom[0].items.length===0"))
        tabs=await ev("()=>[...document.querySelectorAll('.tab')].map(t=>t.textContent).join(',')")
        check('no Movies/Shows tabs for M3U', 'Movies' not in tabs, tabs)
        # switch back
        await ev("()=>App.switchPlaylist('p1')"); await pg.wait_for_timeout(2500)
        check('switched back to XC with its favorites', await ev("()=>Store.playlist.id==='p1'&&Library.count()===2000&&Library.isFav('x5')"))
        tabs=await ev("()=>[...document.querySelectorAll('.tab')].map(t=>t.textContent).join(',')")
        check('Movies/Shows tabs back for XC', 'Movies' in tabs, tabs)
        # edit XC playlist: change name via setup edit form keeps guide settings
        await ev("()=>{var p=Store.playlist;p.epgSources=[{url:'http://127.0.0.1:8077/guide2.xml',offset:30}];Store.upsertPlaylist(p)}")
        await ev("()=>App.setup('p1')"); await pg.wait_for_timeout(300)
        await key('ArrowDown'); await key('Enter'); await pg.keyboard.press('Control+a'); await pg.keyboard.type('Main'); await key('Enter')
        for _ in range(6):
            f=await ev("()=>{var e=document.querySelector('.setup .focus');return e?e.textContent:''}")
            if f=='Connect': break
            await key('ArrowDown',w=60)
        await key('Enter',w=3000)
        check('edit keeps guide sources', await ev("()=>Store.playlist.name==='Main'&&Store.playlist.epgSources[0].offset===30"), await ev("()=>Store.playlist.name"))
        pid=await ev("()=>Store.settings.playlists.filter(p=>p.type==='m3u')[0].id")
        await ev("pid=>Store.removePlaylist(pid)", pid)
        check('playlist deleted', await ev("()=>Store.settings.playlists.length===1"))
        check('no errors', not errs, errs[:4])
        await b.close()
    print('%d/%d passed'%(sum(res),len(res)))
asyncio.run(main())
