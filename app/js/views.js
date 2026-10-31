/* Live, Fullscreen and Guide views.
   Speed rules used throughout:
   - Focus changes repaint at most two rows; the preview starts only after the
     remote has rested on a channel (450ms), so scrolling never spins up streams.
   - Zapping in fullscreen updates the OSD instantly but commits the stream after
     300ms, so CH+ CH+ CH+ opens one stream, not three.
   - Guide data is requested only for rows on screen. */
var Views = (function () {
  'use strict';
  var $ = U.$, L = Library;
  var stage = $('stage'), video = $('video');
  var tab = 'live', zone = 'channels', full = false, liveZone = 'channels';
  var groupsVL, chansVL, ovVL, curGroup = null, playing = null, lastPlayed = null;
  var osdT = 0, zapBuf = '', zapT = 0, tabSel = 0, tabs = [];
  var mode = 'live';            // fullscreen mode: live | catchup | vod
  var cu = null;                // catch-up: { c, p, off }
  var vod = null;               // { meta, onExit }
  var pick = null;              // multi-select: Set of chanKeys, or null
  var overlay = false, ovGroup = null;
  var backT = 0, sleepAt = 0, sleepWarned = false, playStart = 0, recentDone = false;

  var TAB_LABELS = { live: 'Channels', guide: 'Guide', movies: 'Movies', shows: 'Shows', search: 'Search', editor: 'Edit on phone', settings: 'Settings' };
  // The guide is home: the app opens on it and Back from any other screen comes back to it.
  function home() { return Store.settings.startTab === 'live' ? 'live' : 'guide'; }
  var fullFrom = 'guide';
  // Simple line icons for the side menu (inline SVG, no image files to load).
  var ICONS = {
    guide: '<path d="M3 5h18M3 12h18M3 19h18M9 3v18"/>',
    live: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    shows: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    editor: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  // Movies and Shows appear only when this playlist actually has them (checked in the background).
  function buildTabs() {
    tabs = home() === 'live' ? ['live', 'guide'] : ['guide', 'live'];
    var pl = Store.playlist, v = pl.vod || {};
    if (pl.type === 'xtream' && v.movies) tabs.push('movies');
    if (pl.type === 'xtream' && v.series) tabs.push('shows');
    tabs.push('search', 'editor', 'settings');
    var nav = document.querySelector('.tabs');
    nav.innerHTML = '';
    tabs.forEach(function (t) {
      var s = U.el('div', 'tab' + (t === tab ? ' on' : '')); s.setAttribute('data-tab', t);
      s.innerHTML = '<svg viewBox="0 0 24 24" class="ico">' + ICONS[t] + '</svg>';
      s.appendChild(U.el('span', 'lbl', TAB_LABELS[t]));
      s.addEventListener('click', function () { closeNav(); if (full) exitFull(); UI.close(); if (t === 'editor') WebEdit.showJoin(); else switchTab(t); });
      s.addEventListener('mousemove', function () { if (UI.pointer && !document.body.classList.contains('nav-open') && !full) openNavFromPointer(); });
      nav.appendChild(s);
    });
    if (tabs.indexOf(tab) < 0 && ready()) switchTab(home());
  }
  function ready() { return !!chansVL; }
  // Pointer near the menu: expand it so the labels show; it closes when the pointer leaves.
  var navPointerT = 0;
  function openNavFromPointer() {
    document.body.classList.add('nav-open', 'nav-peek');
    clearTimeout(navPointerT);
  }
  document.getElementById('sidenav').addEventListener('mouseleave', function () {
    if (!document.body.classList.contains('nav-peek')) return;
    navPointerT = setTimeout(function () { document.body.classList.remove('nav-open', 'nav-peek'); }, 250);
  });

  /* ---------- rows ---------- */
  function renderGroup(row, g) {
    if (!row._n) {
      row._n = U.el('span', 'name'); row._t = U.el('span', 'tag');
      var box = U.el('div', 'txt'); box.appendChild(row._n);
      row.appendChild(box); row.appendChild(row._t);
    }
    row._n.textContent = g.name;
    row._t.textContent = g.hidden ? 'hidden' : g.blocked ? 'locked' : (g.count != null ? String(g.count) : '');
    row.classList.toggle('hid', !!g.hidden);
  }

  // Logo choice (Settings > Appearance): the playlist's logo or the guide's, falling back to the other,
  // and the logo library (logos.js) for channels with neither, or for every channel it knows.
  function ownLogo(c) { var g = Epg.icon(Epg.epgId(c)); return Store.settings.logoPref === 'guide' ? (g || c.logo) : (c.logo || g); }
  function logoOf(c) {
    var lib = Logos.mode();
    if (lib === 'all') return Logos.url(c) || ownLogo(c);
    return ownLogo(c) || (lib === 'fill' ? Logos.url(c) : '');
  }
  // A logo that fails to load: try the helper, then the library's logo, then hide it.
  function logoFailed(img, c) {
    if (Net.retryImage(img)) return;
    var alt = c && Logos.mode() !== 'off' ? Logos.url(c) : '';
    if (alt && img._alt !== alt && img.src !== alt) { img._alt = alt; img.src = alt; return; }
    img.style.visibility = 'hidden';
  }

  function renderChan(row, c) {
    if (!row._n) {
      row._num = U.el('span', 'num'); row._img = U.el('img', 'logo');
      row._img.decoding = 'async';
      row._img.onerror = function () { logoFailed(this, row._c); };
      var box = U.el('div', 'txt');
      row._n = U.el('span', 'name'); row._s = U.el('span', 'sub'); row._p = U.el('div', 'pbar'); row._pi = U.el('i');
      row._p.appendChild(row._pi);
      box.appendChild(row._n); box.appendChild(row._s); box.appendChild(row._p);
      row._t = U.el('span', 'tag'); row._q = U.el('span', 'qtag');
      row.appendChild(row._num); row.appendChild(row._img); row.appendChild(box); row.appendChild(row._q); row.appendChild(row._t);
    }
    var showNum = Store.settings.showNumbers;
    row._num.textContent = showNum ? c.num : '';
    row._num.style.display = showNum ? '' : 'none';
    row._c = c;
    var lg = logoOf(c);
    if (row._logo !== lg) {
      row._logo = lg;
      row._img.style.visibility = lg ? 'visible' : 'hidden';
      if (lg) row._img.src = lg; else row._img.removeAttribute('src');
    }
    var locked = !Parental.blockedOk(c);
    row._n.textContent = L.name(c);
    var nn = locked ? null : Epg.nowNext(c);
    if (locked) { row._s.textContent = 'Locked'; row._p.style.display = 'none'; }
    else if (nn && nn.now) {
      row._s.textContent = nn.now.t;
      row._pi.style.width = Math.round(100 * (Date.now() - nn.now.s) / (nn.now.e - nn.now.s)) + '%';
      row._p.style.display = nn.now.up || nn.now.ended ? 'none' : '';
    } else { row._s.textContent = nn ? '' : ' '; row._p.style.display = 'none'; }
    var qt = L.versionTag(c);
    if (row._qt !== qt) { row._qt = qt; row._q.textContent = qt; row._q.style.display = qt ? '' : 'none'; }
    var tags = [];
    if (L.isFav(c.k)) tags.push('★');
    if (c.arch && Store.settings.showCatchupMark !== false) tags.push('↺');
    if (L.isBlocked(c)) tags.push('lock');
    if (L.isNew(c)) tags.push('NEW');
    row._t.textContent = tags.join(' ');
    row.classList.toggle('playing', !!(playing && playing.k === c.k));
    row.classList.toggle('hid', !!Store.edits.hiddenChannels[c.k]);
    row.classList.toggle('picked', !!(pick && pick.has(c.k)));
    row.classList.toggle('moving', moving === c.k);
  }

  /* ---------- live view ---------- */
  function init() {
    groupsVL = new VList($('groupList'), { render: renderGroup, onSel: onGroupSel, empty: 'No groups', visible: 11,
      onHover: function () { if (zone !== 'groups') setZone('groups'); }, onClick: function () { UI.press('ok'); } });
    chansVL = new VList($('chanList'), { render: renderChan, onSel: onChanSel, empty: 'No channels in this group.  Hold OK on any channel and choose "Copy to group" to add some.', visible: 11,
      onHover: function () { if (zone !== 'channels') setZone('channels'); }, onClick: function () { UI.press('ok'); } });
    ovVL = new VList($('ovList'), { render: renderChan, empty: 'No channels', visible: 11, onClick: function () { UI.press('ok'); } });
    ovVL.setActive(true);
    Player.bind(video);
    Player.on('state', onPlayerState);
    Player.on('stats', onStats);
    Player.on('notice', function (m) { if (m) U.toast(m, m.length > 40 ? 6000 : 0); });
    Player.on('trouble', function () { downSoon(); });
    // Magic Remote in fullscreen: moving the pointer shows the info panel and its button legend,
    // clicking the picture shows or hides it.
    stage.addEventListener('click', function () { if (!full) { if (playing && mode === 'live') goFull(); return; } var o = $('osd'); if (o.classList.contains('hidden')) osd(true); else o.classList.add('hidden'); });
    document.addEventListener('mousemove', U.debounce(function () { if (full && UI.pointer && !overlay) osd(true); }, 120));
    // Subtitles on automatically when a stream brings them (Settings > Playback).
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('addtrack', function (e) {
      var t = e.track;
      // With a language chosen (Settings > Playback), only a track in that language.
      var want = Store.settings.subsLang || '';
      if (Store.settings.autoSubs && t && (t.kind === 'subtitles' || t.kind === 'captions') && (!want || U.lang(t.language || t.label) === want))
        setTimeout(function () { if (subtitleTracks().every(function (x) { return x.mode !== 'showing'; })) t.mode = 'showing'; }, 0);
    });
    Epg.onUpdate(function (k) {
      if (!k) { chansVL.refresh(); if (overlay) ovVL.refresh(); if (tab === 'guide') Guide.draw(); updateInfo(); return; }
      var hit = function (c) { return c && Epg.keyOf(c) === k; };
      chansVL.refreshWhere(hit);
      if (overlay) ovVL.refreshWhere(hit);
      var cur = chansVL.current();
      if (cur && hit(cur)) updateInfo();
      if (playing && hit(playing) && mode === 'live') osd(false);
      if (tab === 'guide') Guide.rowUpdated(k);
    });
    setInterval(function () { if (tab === 'live' && !full) chansVL.refresh(); }, 60000);
    setInterval(heartbeat, 5000);
    setInterval(function () {
      if (!full) return;
      if (mode !== 'live' && !$('osd').classList.contains('hidden')) osd(false);
      if (mode === 'catchup' && cu) cuTick();
    }, 1000);
    applyLook();
  }

  function applyLook() {
    var acc = Store.settings.accent || '#5b8cff', on = U.onColor(acc), root = document.documentElement.style;
    root.setProperty('--accent', acc);
    root.setProperty('--on-accent', on.fg);
    root.setProperty('--on-accent-dim', on.dim);
    // Accent used as text on the dark background: lift very dark accents so they stay readable.
    root.setProperty('--accent-text', U.luminance(acc) < 0.12 ? U.mix(acc, '#ffffff', 0.45) : acc);
    document.body.classList.toggle('dimpast', !!Store.settings.dimPast);
    document.body.classList.toggle('guide1', Store.settings.guideLines === 1);
    var s = Store.settings, b = document.body.classList;
    document.body.className.split(/\s+/).forEach(function (c) { if (/^theme-/.test(c)) b.remove(c); });
    ['ts-s', 'ts-l', 'ov-l', 'ov-h', 'now-color', 'now-off'].forEach(function (c) { b.remove(c); });
    if (s.theme && s.theme !== 'dark') b.add('theme-' + s.theme);
    b.toggle('focus-ring', s.focusStyle === 'ring' || s.theme === 'contrast');
    if (s.textSize === 's' || s.textSize === 'l') b.add('ts-' + s.textSize);
    if (s.overlay === 'l' || s.overlay === 'h') b.add('ov-' + s.overlay);
    if (s.nowStyle === 'color' || s.nowStyle === 'off') b.add('now-' + s.nowStyle);
    b.toggle('noguidenames', s.guideNames === false);
    b.toggle('twolinenames', !!s.twoLineNames);
    if (window.Guide && Guide.draw) try { Guide.draw(); } catch (e) {}
    UI.clock();
  }

  // Watch time, recents, reminders and the sleep timer share one slow timer.
  function heartbeat() {
    var now = Date.now();
    if (playing && mode === 'live' && Player.playing) {
      L.addWatch(playing.k, 5);
      if (!recentDone && now - playStart > 8000) { recentDone = true; L.touchRecent(playing.k); }
    }
    // Reminders are for someone using the TV: they wait while TiviBro is in the background (the TV's
    // own alert covers that, see remind.js), while a menu is open, and when nobody has touched the
    // remote for a while with nothing playing (the TV's screensaver is likely up).  The next press
    // brings the question, with Watch from the start if it began meanwhile.
    var idle = now - UI.lastInput > IDLE && !(playing && Player.playing);
    if (!document.hidden && !UI.modalOpen && !idle) dueReminder(now);
    if (sleepAt) {
      if (now >= sleepAt) { sleepAt = 0; if (full) exitFull(); Player.stop(); playing = null; stage.classList.add('off'); U.toast('Sleep timer: playback stopped'); }
      else if (sleepAt - now < 60000 && !sleepWarned) { sleepWarned = true; U.toast('Sleep timer: stopping in 1 minute'); }
    }
  }

  var IDLE = 10 * 60000;
  function dueReminder(now) {
    var rem = Store.edits.reminders, before = (+Store.settings.remindBefore || 0) * 60000;
    for (var i = 0; i < rem.length; i++) {
      var r = rem[i];
      if (r.s - before > now) continue;
      rem.splice(i, 1); Store.saveEdits();
      var c = L.find(r.k), p = { s: r.s, e: r.e, t: r.t };
      if (!c) return;
      var late = r.s < now - 120000;
      // Over while TiviBro was away: offer it from catch-up, otherwise let it go.
      if (r.e <= now) {
        if (c.arch && r.s > now - c.arch * 86400e3) UI.menu('You missed it:  ' + r.t, [
          { label: 'Watch it from the start', sub: 'catch-up on ' + L.name(c) + ', aired ' + U.hhmm(r.s), action: function () { playCatchup(c, p, 0); } },
          { label: 'Dismiss' }
        ]);
        return;
      }
      var watchIt = function () { startChannel(c, false, function () { if (!full) goFull(); else osd(true); }); };
      if (Store.settings.remindAction === 'switch' && !late) { U.toast('Reminder: switching to ' + L.name(c) + ' for ' + r.t, 4000); watchIt(); return; }
      UI.menu((late ? 'Started at ' + U.hhmm(r.s) : 'Starting ' + (r.s > now ? 'at ' + U.hhmm(r.s) : 'now')) + ':  ' + r.t, [
        { label: 'Watch ' + L.name(c), sub: late ? 'live' : '', action: watchIt },
        late && c.arch && { label: 'Watch from the start', sub: 'catch-up', action: function () { playCatchup(c, p, 0); } },
        { label: 'Dismiss' }
      ]);
      var closeAfter = (+Store.settings.remindTimeout || 20) * 1000;
      setTimeout(function () { if (UI.modalOpen && document.getElementById('modalTitle').textContent.indexOf(r.t) >= 0) UI.close(); }, closeAfter);
      return;
    }
  }
  /* Watch pressed on the TV's reminder alert (TiviBro opened or brought forward with launch params). */
  function openReminder(q) {
    var now = Date.now(), rem = Store.edits.reminders;
    var i = rem.findIndex(function (r) { return r.k === q.k && r.s === +q.s; });
    var r = i >= 0 ? rem.splice(i, 1)[0] : null;
    if (r) Store.saveEdits();
    var c = L.find(q.k);
    if (!c) { U.toast('That channel is not in this playlist any more'); return; }
    Log.info('views', 'Opened from a reminder: ' + (r ? r.t : q.k));
    var p = r ? { s: r.s, e: r.e, t: r.t } : null;
    if (UI.modalOpen) UI.close();
    if (p && p.e <= now && c.arch) return playCatchup(c, p, 0);
    if (p && p.s < now - 120000 && c.arch) {
      startChannel(c, false, goFull);
      UI.menu('Started at ' + U.hhmm(p.s) + ':  ' + p.t, [{ label: 'Keep watching live' }, { label: 'Watch from the start', sub: 'catch-up', action: function () { playCatchup(c, p, 0); } }]);
      return;
    }
    startChannel(c, false, goFull);
  }

  function reload(keepGroup) {
    buildTabs();
    var gs = L.groups();
    var gid = keepGroup && curGroup ? curGroup : (Store.edits.lastGroup || L.ALL);
    if (!gs.some(function (g) { return g.id === gid; })) gid = firstFilled(gs);
    var gi = Math.max(0, gs.findIndex(function (g) { return g.id === gid; }));
    groupsVL.setItems(gs, gi);
    showGroup(gs[gi] ? gs[gi].id : L.ALL, keepGroup);
  }
  // First group that actually has channels (an empty Favorites should never be the landing group).
  function firstFilled(gs) {
    gs = gs || L.groups();
    for (var i = 0; i < gs.length; i++) if (!gs[i].hidden && L.channels(gs[i].id).length) return gs[i].id;
    return gs[0] ? gs[0].id : L.ALL;
  }
  function showGroup(gid, keepSel) {
    var prev = chansVL.current();
    curGroup = gid;
    var list = L.channels(gid);
    var sel = 0;
    var want = keepSel && prev ? prev.k : (playing ? playing.k : null);
    if (want) { var i = list.findIndex(function (c) { return c.k === want; }); if (i >= 0) sel = i; }
    chansVL.setItems(list, sel);
    $('chanTitle').textContent = L.groupName(gid) + '  ' + list.length;
    updateInfo();
  }
  function groupLocked(g) { return g && g.blocked && !Parental.blockedOk({ k: '', g: g.id }); }
  var groupDeb = U.debounce(function (g) {
    if (!g || g.id === curGroup) return;
    if (groupLocked(g)) { curGroup = g.id; chansVL.setItems([], 0); $('chanTitle').textContent = g.name + '  locked'; return; }
    showGroup(g.id); Store.edits.lastGroup = g.id; Store.saveEdits();
  }, 220);
  function onGroupSel(i, g) { groupDeb(g); }

  var previewDeb = U.debounce(function () {
    var c = chansVL.current();
    if (!c || full || tab !== 'live' || zone !== 'channels' || pick) return;
    if (!Parental.blockedOk(c)) return;
    if (Store.settings.previewPlay && (!playing || playing.k !== c.k || mode !== 'live')) startChannel(c, true);
  }, 450);
  // While an arrow is held the info panel waits until the remote rests, so the list keeps up.
  var infoT = 0;
  function onChanSel() {
    clearTimeout(infoT);
    if (UI.repeating) infoT = setTimeout(updateInfo, 120); else updateInfo();
    previewDeb();
  }

  function updateInfo() {
    var c = chansVL && chansVL.current();
    var now = $('infoNow'), next = $('infoNext');
    now.innerHTML = ''; next.textContent = '';
    if (!c) return;
    if (!Parental.blockedOk(c)) { now.appendChild(U.el('div', '', L.name(c))); now.appendChild(U.el('small', '', 'Locked.  Press OK and enter the PIN.')); return; }
    var nn = Epg.nowNext(c);
    now.appendChild(U.el('div', '', nn && nn.now ? nn.now.t : L.name(c)));
    if (nn && nn.now) {
      var pg = Epg.pubSource(c);
      now.appendChild(U.el('small', '', (nn.now.up ? 'Starts ' + Events.when(nn.now.e) : nn.now.ended ? 'Ended ' + Events.when(nn.now.s) : U.hhmm(nn.now.s) + ' to ' + U.hhmm(nn.now.e)) + '   ' + L.name(c) + (c.arch ? '   catch-up ' + c.arch + ' days' : '') + (pg ? '   public guide, ' + pg.name : '')));
      var nd = Epg.desc(c, nn.now); if (nd) now.appendChild(U.el('p', '', nd));
    } else now.appendChild(U.el('small', '', nn ? 'No guide information' : 'Loading guide'));
    if (nn && nn.next) next.textContent = 'Next  ' + U.hhmm(nn.next.s) + '  ' + nn.next.t;
  }

  function placePreview() {
    var r = $(tab === 'guide' ? 'guidePreview' : 'previewSlot').getBoundingClientRect();
    stage.style.left = r.left + 'px'; stage.style.top = r.top + 'px';
    stage.style.width = r.width + 'px'; stage.style.height = r.height + 'px';
  }

  // Every way of starting a live channel goes through here, so the PIN check can't be skipped.
  function startChannel(c, preview, then) {
    Parental.gate('channels', c, function () {
      if (!foSwitching) fo = null;            // picking a channel yourself ends a backup chain
      if (playing && playing.k !== c.k) lastPlayed = playing;
      playing = c; mode = 'live'; cu = null; vod = null;
      playStart = Date.now(); recentDone = false;
      Store.edits.last = c.k; Store.saveEdits();
      stage.classList.remove('off');
      if (Store.settings.blackSwitch) stage.classList.add('blank');
      Player.play(c, { preview: preview, keepTrying: foSwitching === 'back' });
      chansVL.refreshWhere(function (x) { return x && (x.k === c.k || (lastPlayed && x.k === lastPlayed.k)); });
      if (then) then();
    });
  }

  function setZone(z) {
    zone = z;
    liveZone = z;
    groupsVL.setActive(z === 'groups');
    chansVL.setActive(z === 'channels');
    hintsFor();
  }
  function hintsFor() {
    if (tab !== 'live') return;
    if (pick) UI.hints([['', 'OK  select or unselect'], ['red', 'Actions (' + pick.size + ' selected)'], ['', 'Back  done']]);
    else {
      var h = [['', zone === 'groups' ? 'OK  open group' : 'OK  watch fullscreen', 'ok'], ['', 'Hold OK  options', 'hold'], ['', zone === 'groups' ? 'Back or ◀  menu bar' : 'Back or ◀  groups', 'back']];
      var vlz = zone === 'groups' ? groupsVL : chansVL;
      if (vlz && vlz.items.length > vlz.visible) h.push(['', 'CH +/−  page', 'chup']);
      ['red', 'green', 'yellow', 'blue'].forEach(function (b) {
        var act = Keymap.get('list', b);
        if (act && act !== 'none') h.push([b, Keymap.ACTIONS[act]]);
      });
      UI.hints(h);
    }
  }

  var guideSeen = false;
  function switchTab(t) {
    if (tabs.indexOf(t) < 0) t = 'live';
    if (t === 'settings' && tab !== 'settings') return Parental.gate('settings', null, function () { doSwitch(t); });
    doSwitch(t);
  }
  function doSwitch(t) {
    tab = t;
    Keymap.setContext(t === 'live' ? 'list' : 'other');
    document.querySelectorAll('.tab').forEach(function (el, i) {
      var on = el.getAttribute('data-tab') === t;
      el.classList.toggle('on', on);
      el.classList.remove('focus');
      if (on) tabSel = i;
    });
    if (t !== 'guide') Guide.leave();
    ['Live', 'Guide', 'Settings', 'Vod', 'Search'].forEach(function (x) {
      var want = t === 'movies' || t === 'shows' ? 'Vod' : t.charAt(0).toUpperCase() + t.slice(1);
      var v = $('view' + x);
      if (v) v.classList.toggle('hidden', x !== want);
    });
    if (t === 'live' || t === 'guide') {
      // Both keep the picture going: Channels shows it beside the list, the guide in its corner.
      if (playing && mode === 'live') stage.classList.remove('off'); else stage.classList.add('off');
      if (t === 'live') { placePreview(); UI.setHandler(liveKeys); setZone(liveZone); }
      else {
        // First visit after start-up: straight into the grid, on the last channel watched (like
        // TiviMate), so OK previews at once.  Later visits from the menu land on the groups.
        var startKey = playing && mode === 'live' ? playing.k : !guideSeen ? (Store.edits.last || '-') : null;
        guideSeen = true;
        Guide.open(curGroup, startKey); placePreview();
      }
    } else {
      // Other screens get the whole CPU: no preview decoding behind them.
      stage.classList.add('off');
      if (!full) { Player.stop(); playing = null; }
      if (t === 'settings') Settings.open();
      else if (t === 'movies' || t === 'shows') Vod.open(t === 'shows' ? 'series' : 'movie');
      else if (t === 'search') Search.open();
    }
  }

  /* Side menu.  Left from the first column of any screen opens it (labels showing); Up and
     Down choose a screen, OK or Right opens it (or returns to the current one), Back goes home.
     onBack restores the screen's own keys. */
  var navOnBack = null;
  function closeNav() { document.body.classList.remove('nav-open', 'nav-peek'); document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('focus'); }); }
  /* armExit: opened with Back from the home screen's top level.  Then "Press Back again to exit" shows
     at once, and the next Back on the menu bar closes TiviBro (two presses, like TiviMate). */
  function tabBar(onBack, armExit) {
    navOnBack = onBack;
    if (armExit && tab === home() && Store.settings.exitTwice !== false) { backT = Date.now(); U.toast('Press Back again to exit', 2500); }
    tabSel = Math.max(0, tabs.indexOf(tab));
    var tabEls = function () { return document.querySelectorAll('.tab'); };
    var paint = function () { tabEls().forEach(function (t, i) { t.classList.toggle('focus', i === tabSel); }); };
    var hintsEl = $('hints'), before = hintsEl.innerHTML;
    var done = function () { closeNav(); hintsEl.innerHTML = before; };
    document.body.classList.remove('nav-peek');
    document.body.classList.add('nav-open');
    paint();
    UI.hints([['', '▲ ▼  choose a screen'], ['', 'OK or ▶  open it', 'ok'], ['', 'Back  ' + (tab !== home() ? TAB_LABELS[home()] : 'exit TiviBro'), 'back']]);
    UI.setHandler(function (a) {
      if (a === 'up') { tabSel = Math.max(0, tabSel - 1); paint(); }
      else if (a === 'down') { tabSel = Math.min(tabs.length - 1, tabSel + 1); paint(); }
      else if (a === 'ok' || a === 'right') {
        // Edit on phone is a shortcut, not a screen: it shows the editor's QR code over the screen you are on.
        if (tabs[tabSel] === 'editor') { if (a === 'ok') { done(); onBack(); WebEdit.showJoin(); } }
        else { done(); if (tabs[tabSel] === tab) onBack(); else switchTab(tabs[tabSel]); }
      }
      else if (a === 'back') {
        if (tab !== home()) { done(); switchTab(home()); }
        else if (Store.settings.exitTwice !== false && Date.now() - backT > 2500) { backT = Date.now(); U.toast('Press Back again to exit', 2500); }
        else { done(); exitNow(); }
      }
      return true;
    });
  }

  // Back to the top of the home screen arms the exit: one more Back closes TiviBro.
  function armExit() { if (tab === home() && Store.settings.exitTwice !== false) { backT = Date.now(); U.toast('Press Back again to exit', 2500); } }
  function exitArmed() { return tab === home() && Date.now() - backT < 2500; }
  function exitApp(confirmFirst) {
    if ((confirmFirst || Store.settings.exitTwice) && Date.now() - backT > 2500) { backT = Date.now(); U.toast('Press Back again to exit', 2500); return; }
    exitNow();
  }
  /* Close TiviBro.  window.close() is how a webOS web app quits; if the TV ignores it, hand Back to the
     system (PalmSystem.platformBack), which leaves the app. */
  function exitNow() {
    Log.info('views', 'Exit from the remote');
    try { stopAll(); } catch (e) {}
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      try { if (window.webOS && webOS.platformBack) webOS.platformBack(); else if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (e) {}
    }, 300);
  }

  // Buttons that follow the remote map in the channel list.  Arrows, OK and Back stay fixed.
  function listMapped(a) {
    var b = a === 'hold' ? 'long:ok' : a;
    if (b.indexOf('long:') !== 0 && Keymap.fixed('list', b)) return null;
    if (b.indexOf('num') === 0) return null;
    return Keymap.get('list', b);
  }
  function openNav() { tabBar(function () { UI.setHandler(liveKeys); setZone(liveZone); }); }
  function liveKeys(a) {
    if (pick) return pickKeys(a);
    if (moving) return moveKeys(a);
    if (a.indexOf('num') === 0) return zapDigit(a.slice(3)), true;
    var mapped = listMapped(a);
    if (mapped) { runAction(mapped, 'list'); return true; }
    if (zone === 'groups') {
      if (a === 'up') groupsVL.move(-1);
      else if (a === 'down') groupsVL.move(1);
      else if (a === 'left') openNav();
      else if (a === 'chup') groupsVL.page(-1);
      else if (a === 'chdown') groupsVL.page(1);
      else if (a === 'right' || a === 'ok') {
        groupDeb.cancel();
        var g = groupsVL.current();
        if (!g) return true;
        var go = function () { showGroup(g.id); Store.edits.lastGroup = g.id; Store.saveEdits(); setZone('channels'); };
        if (groupLocked(g)) Parental.gate('channels', { k: '', g: g.id }, go);
        else { if (g.id !== curGroup) showGroup(g.id); setZone('channels'); }
      }
      else if (a === 'back') { if (exitArmed()) exitApp(true); else tabBar(function () { UI.setHandler(liveKeys); setZone(liveZone); }, true); }
      return true;
    }
    if (a === 'up') chansVL.move(-1, true);
    else if (a === 'down') chansVL.move(1, true);
    else if (a === 'chup') chansVL.page(-1);
    else if (a === 'chdown') chansVL.page(1);
    else if (a === 'left') setZone('groups');
    else if (a === 'ok') {
      previewDeb.cancel();
      var c = chansVL.current();
      if (!c) return true;
      if (!playing || playing.k !== c.k || mode !== 'live') startChannel(c, false, goFull);
      else goFull();
    }
    else if (a === 'back') { setZone('groups'); armExit(); }
    return true;
  }

  /* ---------- remappable actions ---------- */
  function ctxChannel(ctx) { return ctx === 'player' ? playing : (zone === 'channels' ? chansVL.current() : null); }
  function openGroup(gid) {
    if (full) { if (mode !== 'live') return; overlay = true; ovGroup = gid; $('overlay').classList.remove('hidden'); $('osd').classList.add('hidden'); fillOverlay(playing && playing.k); return; }
    var gs = L.groups(), i = gs.findIndex(function (g) { return g.id === gid; });
    if (i < 0) { U.toast(gid === L.RECENT ? 'No recent channels yet' : 'That group is empty'); return; }
    groupsVL.select(i); showGroup(gid); setZone('channels');
  }
  function leaveTo(t) { if (full) exitFull(); switchTab(t); }
  function runAction(act, ctx) {
    var c = ctxChannel(ctx);
    switch (act) {
      case 'none': return;
      case 'list': if (full) openOverlay(); return;
      case 'panel': if (full) openPanel(); return;
      case 'osd': if (full) osd(true); return;
      case 'menu': if (ctx === 'player') playerMenu(); else if (zone === 'groups') groupMenu(groupsVL.current()); else chanMenu(c, curGroup); return;
      case 'chnext': if (full) zap(1); else chansVL.move(1); return;
      case 'chprev': if (full) zap(-1); else chansVL.move(-1); return;
      case 'last': if (!lastPlayed) { U.toast('No previous channel yet'); return; } if (full) lastChannel(); else startChannel(lastPlayed, false, goFull); return;
      case 'rewind':
        if (playing && playing.arch && full && Store.settings.rewindLeft !== false) rewindLive();
        else if (full) lastChannel();
        return;
      case 'restart': if (c && c.arch) watchFromStart(c); else U.toast('No catch-up on this channel'); return;
      case 'playpause': playPause(); return;
      case 'guide': leaveTo('guide'); return;
      case 'search': leaveTo('search'); return;
      case 'settings': leaveTo('settings'); return;
      case 'editor': WebEdit.showJoin(); return;
      case 'movies': if (tabs.indexOf('movies') >= 0) leaveTo('movies'); return;
      case 'shows': if (tabs.indexOf('shows') >= 0) leaveTo('shows'); return;
      case 'live': if (full) exitFull(); else switchTab('live'); return;
      case 'exit': if (full) exitFull(); return;
      case 'fav': if (c) { var on = L.toggleFav(c.k); U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); if (full) osd(true); } return;
      case 'favorites': openGroup(L.FAV); return;
      case 'recents': openGroup(L.RECENT); return;
      case 'picture': cyclePicture(); return;
      case 'audio': audioMenu(); return;
      case 'sleep': sleepMenu(); return;
      case 'reconnect': Player.retryNow(); return;
    }
  }
  // Play resumes, Pause pauses, a combined button toggles: Play on a playing stream never pauses it.
  function playPause() {
    var k = UI.playKey;
    if (k === 'play') Player.setPaused(false); else if (k === 'pause') Player.setPaused(true); else Player.togglePause();
    if (full) osd(true);
  }
  var DM = { contain: 'Normal', fill: 'Stretch', cover: 'Zoom' };
  function cyclePicture() {
    var k = Object.keys(DM), i = k.indexOf(Store.settings.display);
    var c = mode === 'live' ? playing : null, cur = Player.displayFor(c), nk = k[(k.indexOf(cur) + 1) % k.length];
    if (c) { Store.edits.display = Store.edits.display || {}; Store.edits.display[c.k] = nk; Store.saveEdits(); } else { Store.settings.display = nk; Store.saveSettings(); }
    Player.applyDisplay();
    U.toast('Picture: ' + DM[nk] + (c ? ' for this channel' : ''));
  }
  function audioMenu() {
    var tracks = Player.audioTracks();
    if (tracks.length < 2) { U.toast('This stream has one audio track'); return; }
    UI.menu('Audio track', tracks.map(function (t) { return { label: t.label, sub: t.on ? 'playing' : '', action: function () { Player.setAudio(t.id); } }; }));
  }
  function sleepMenu() {
    UI.menu('Sleep timer', [15, 30, 45, 60, 90, 120].map(function (m) {
      return { label: m + ' minutes', action: function () { sleepAt = Date.now() + m * 60000; sleepWarned = false; U.toast('Playback stops at ' + U.hhmm(sleepAt)); } };
    }).concat([{ label: 'Off', action: function () { sleepAt = 0; U.toast('Sleep timer off'); } }]));
  }

  /* ---------- multi-select ---------- */
  function startPick(first) {
    pick = new Set(first ? [first] : []);
    chansVL.refresh(); hintsFor();
  }
  /* ---------- moving a channel inside its group ----------
     Up and down carry the channel, Channel +/− a page at a time, OK or Back puts it down.
     Works in your groups and in the provider's (Settings keep "Your order" for that group). */
  var moving = null;
  function startMove(c) {
    if (!c || !L.canReorder(curGroup)) return;
    moving = c.k;
    chansVL.refresh();
    UI.hints([['', '▲ ▼  move    CH +/−  a page'], ['', 'OK or Back  done']]);
    U.toast('Moving ' + L.name(c) + '.  ▲ ▼ to move, OK when done.', 4000);
  }
  function endMove() { moving = null; chansVL.refresh(); hintsFor(); U.toast('Channel order saved'); }
  function moveKeys(a) {
    var step = a === 'up' ? -1 : a === 'down' ? 1 : a === 'chup' ? -(chansVL.visible - 1) : a === 'chdown' ? chansVL.visible - 1 : 0;
    if (step) {
      if (L.moveInGroup(curGroup, moving, step)) {
        var list = L.channels(curGroup), i = list.findIndex(function (x) { return x.k === moving; });
        chansVL.setItems(list, Math.max(0, i));
      }
    }
    else if (a === 'ok' || a === 'back' || a === 'hold') endMove();
    return true;
  }
  function pickKeys(a) {
    if (a === 'up') chansVL.move(-1, true);
    else if (a === 'down') chansVL.move(1, true);
    else if (a === 'chup') chansVL.page(-1);
    else if (a === 'chdown') chansVL.page(1);
    else if (a === 'ok') {
      var c = chansVL.current();
      if (c) { if (pick.has(c.k)) pick.delete(c.k); else pick.add(c.k); chansVL.refreshWhere(function (x) { return x === c; }); hintsFor(); }
    }
    else if (a === 'red' || a === 'hold') {
      var keys = Array.from(pick);
      UI.menu(pick.size + ' selected', [
        keys.length && { label: 'Copy to group…', action: function () { endPick(); copyMenu(keys, keys.length + ' channels'); } },
        keys.length && { label: 'Add to Favorites', action: function () { var n = L.copyTo(L.FAV, keys); U.toast(n + ' added to Favorites'); endPick(); } },
        keys.length && { label: 'Hide selected', action: function () { keys.forEach(function (k) { L.hideChannel(k, true); }); U.toast('Hidden.  Restore them in Settings.'); endPick(); } },
        { label: 'Select all in group', action: function () { chansVL.items.forEach(function (c) { pick.add(c.k); }); chansVL.refresh(); hintsFor(); } },
        { label: 'Clear selection', action: function () { pick.clear(); chansVL.refresh(); hintsFor(); } },
        { label: 'Done', action: endPick }
      ]);
    }
    else if (a === 'back') endPick();
    return true;
  }
  function endPick() { pick = null; refreshLists(true); hintsFor(); }

  /* ---------- fullscreen ---------- */
  // A lone press acts at once; presses in quick succession (surfing, holding the button) wait until
  // the remote rests, so a burst opens one stream instead of many.  Busy answers from providers
  // that allow one connection are retried by the player if surfing still trips them.
  function burstCommit(fn, wait) {
    var last = 0, deb = U.debounce(fn, wait);
    return function () {
      var now = Date.now(), lone = now - last > 700;
      last = now;
      if (lone) { deb.cancel(); fn(); } else deb();
    };
  }
  var zapIdx = -1, zapCommit = burstCommit(function () {
    var list = L.channels(curGroup), c = list[zapIdx];
    if (c && (!playing || playing.k !== c.k || mode !== 'live')) startChannel(c, false);
  }, 300);

  function goFull() {
    if (!full) fullFrom = tab === 'live' ? 'live' : 'guide';
    full = true;
    document.body.classList.add('full');
    stage.classList.remove('preview', 'off'); stage.classList.add('full');
    Player.upgrade(false);
    zapIdx = L.channels(curGroup).findIndex(function (c) { return playing && c.k === playing.k; });
    UI.setHandler(fullKeys);
    Keymap.setContext('player');
    osd(true);
  }
  function exitFull() {
    closePanel();
    full = false; overlay = false;
    Keymap.setContext(tab === 'live' ? 'list' : 'other');
    $('overlay').classList.add('hidden');
    document.body.classList.remove('full');
    stage.classList.remove('full'); stage.classList.add('preview');
    $('osd').classList.add('hidden');
    if (mode === 'vod') {
      var v = vod;
      vodSeekCommit();
      Vod.stopped();
      vod = null; mode = 'live'; Player.stop(); playing = null; stage.classList.add('off');
      if (v && v.onExit) v.onExit();
      return;
    }
    if (mode === 'catchup' && playing) { mode = 'live'; cu = null; Player.play(playing, { preview: true }); }
    Player.upgrade(true);
    // Back from fullscreen returns to where you came from, with the picture still playing there.
    if (fullFrom === 'guide') { if (tab !== 'guide') doSwitch('guide'); else { Guide.resume(playing && playing.k); placePreview(); } return; }
    if (tab !== 'live') doSwitch('live');
    placePreview();
    UI.setHandler(liveKeys);
    if (playing) {
      var i = L.channels(curGroup).findIndex(function (c) { return c.k === playing.k; });
      if (i >= 0) chansVL.select(i);
    }
    setZone('channels');
    updateInfo();
  }

  function fmtDur(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(x); }

  function osd(show, ch) {
    if (!full) return;
    var o = $('osd');
    if (mode === 'vod' && vod) {
      var m = vod.meta;
      $('osdNum').textContent = ''; $('osdName').textContent = m.title; $('osdGroup').textContent = m.sub || '';
      var d = Player.duration, pos = vs.pending != null ? vs.pending : Player.position, jump = vs.pending != null ? vs.pending - Player.position : 0;
      $('osdNow').textContent = fmtDur(pos) + ' / ' + (d ? fmtDur(d) : '--:--') + (vs.pending != null ? '   (' + (jump < 0 ? '−' : '+') + fmtDur(Math.abs(jump)) + ')' : Player.paused ? '   paused' : '') + (d ? '   ends ' + U.hhmm(Date.now() + (d - pos) * 1000) : '');
      $('osdBar').style.width = d ? Math.round(100 * pos / d) + '%' : '0';
      $('osdNext').textContent = [Player.media, 'Keep pressing ◀ ▶ to jump further'].filter(Boolean).join('    ');
    } else if (mode === 'catchup' && cu) {
      var c0 = cu.c, dur = (cu.p.e - cu.p.s) / 1000, at = cu.pending != null ? cu.pending : cu.off + Player.position;
      $('osdNum').textContent = Store.settings.showNumbers ? c0.num : ''; $('osdName').textContent = L.name(c0); $('osdGroup').textContent = 'Catch-up';
      $('osdNow').textContent = U.hhmm(cu.p.s + at * 1000) + '   ' + cu.p.t + '   (' + fmtDur(at) + ' / ' + fmtDur(dur) + ')';
      $('osdBar').style.width = Math.round(100 * U.clamp(at / dur, 0, 1)) + '%';
      $('osdNext').textContent = 'Left and right skip ' + Store.settings.skip + 's    Yellow or Back returns to live';
    } else {
      var c = ch || playing;
      if (!c) return;
      $('osdNum').textContent = Store.settings.showNumbers ? c.num : '';
      $('osdName').textContent = L.name(c);
      var st = Player.stats, media = '';
      if (Store.settings.osdMedia !== false && c === playing && video.videoHeight) media = '   ·   ' + (Player.mediaInfo ? Caps.label(Object.assign({}, Player.mediaInfo, { height: video.videoHeight })) : video.videoHeight + 'p') + (st && st.engine ? '  ' + st.engine : '') + (c.arch ? '   ·   ↺ catch-up' : '');
      $('osdGroup').textContent = L.groupName(c.g) + (L.isFav(c.k) ? '   ★' : '') + media;
      var nn = Epg.nowNext(c);
      if (nn && nn.now) {
        $('osdNow').textContent = (nn.now.up || nn.now.ended ? '' : U.hhmm(nn.now.s) + ' to ' + U.hhmm(nn.now.e) + '   ') + nn.now.t;
        $('osdBar').style.width = nn.now.up || nn.now.ended ? '0' : Math.round(100 * (Date.now() - nn.now.s) / (nn.now.e - nn.now.s)) + '%';
      } else { $('osdNow').textContent = nn ? 'No guide information' : ''; $('osdBar').style.width = '0'; }
      $('osdNext').textContent = nn && nn.next ? 'Next  ' + U.hhmm(nn.next.s) + '  ' + nn.next.t : '';
    }
    osdLegend();
    if (show) {
      o.classList.remove('hidden');
      clearTimeout(osdT);
      osdT = setTimeout(function () { o.classList.add('hidden'); }, (+Store.settings.osdTimeout || 5) * 1000);
    }
  }

  /* What every button does right now, at the bottom of the info panel.  Follows the remote map,
     and each chip can be clicked with the Magic Remote pointer. */
  function osdLegend() {
    var el = $('osdKeys'), items = [];
    function chip(key, label, color) { items.push([key, label, color]); }
    if (mode === 'vod') { chip('ok', 'Pause'); chip('left', '◀ ▶  Skip ' + Store.settings.skip + 's'); chip('up', '▲ ▼  Skip 10 min'); chip('red', 'Options', 'red'); chip('back', 'Back  Stop'); }
    else if (mode === 'catchup') { chip('ok', 'Pause'); chip('left', '◀ ▶  Skip ' + Store.settings.skip + 's'); chip('up', '▲ ▼  Skip 5 min'); chip('yellow', 'Back to live', 'yellow'); chip('red', 'Options', 'red'); }
    else {
      var g = function (b) { var a = Keymap.get('player', b); return a && a !== 'none' ? Keymap.SHORT[a] || Keymap.ACTIONS[a] : ''; };
      if (g('ok')) chip('ok', 'OK  ' + g('ok'));
      if (g('up') === 'Previous channel' && g('down') === 'Next channel') chip('down', '▲ ▼  Change channel');
      else { if (g('up')) chip('up', '▲  ' + g('up')); if (g('down')) chip('down', '▼  ' + g('down')); }
      if (g('left')) chip('left', '◀  ' + (Keymap.get('player', 'left') === 'rewind' && !(playing && playing.arch) ? 'Last channel' : g('left')));
      if (g('right')) chip('right', '▶  ' + g('right'));
      ['red', 'green', 'yellow', 'blue'].forEach(function (b) { if (g(b)) chip(b, g(b), b); });
      chip('back', 'Back  ' + (fullFrom === 'live' ? 'Channels' : 'Guide'));
    }
    var sig = JSON.stringify(items);
    if (el._sig === sig) return;
    el._sig = sig; el.innerHTML = '';
    items.forEach(function (x) {
      var s = U.el('span', 'clickable'); s.setAttribute('data-key', x[0]);
      if (x[2]) s.appendChild(U.el('b', 'k-' + x[2]));
      s.appendChild(document.createTextNode(x[1]));
      el.appendChild(s);
    });
  }

  // Feedback while switching: the full info panel, or just the number and name (Settings).
  function zapShow(c) {
    if (Store.settings.osdOnZap !== false) return osd(true, c);
    var z = $('zapNum'); z.textContent = (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c); z.classList.remove('hidden');
    clearTimeout(zapShow.t); zapShow.t = setTimeout(function () { z.classList.add('hidden'); }, 1500);
  }
  function zap(d) {
    var list = L.channels(curGroup);
    if (!list.length) return;
    if (zapIdx < 0) zapIdx = 0;
    zapIdx = (zapIdx + d + list.length) % list.length;
    zapShow(list[zapIdx]);
    Epg.request(list[zapIdx]);
    zapCommit();
  }
  // Pressing Last repeatedly flips between two channels on screen; only the one you stop on starts.
  var lastTarget = null, lastCommit = burstCommit(function () {
    var c = lastTarget; lastTarget = null;
    if (!c || (playing && playing.k === c.k && mode === 'live')) return;
    startChannel(c, false, function () { zapIdx = L.channels(curGroup).findIndex(function (x) { return x.k === playing.k; }); osd(true); });
  }, 350);
  function lastChannel() {
    if (!lastPlayed && !lastTarget) return;
    lastTarget = lastTarget ? (lastTarget.k === (playing && playing.k) ? lastPlayed : playing) : lastPlayed;
    if (!lastTarget) return;
    zapShow(lastTarget);
    lastCommit();
  }

  /* Seeking in movies and shows.  Presses add up on screen and the player jumps once you stop
     (one seek instead of five), and pressing the same way again and again goes further each
     time, so a long jump doesn't take thirty presses. */
  var vs = { pending: null, t: 0, n: 0, dir: 0, last: 0 };
  function seekAccel(dir) {
    var now = Date.now();
    vs.n = vs.dir === dir && now - vs.last < 900 ? vs.n + 1 : 0;
    vs.dir = dir; vs.last = now;
    return vs.n < 3 ? 1 : vs.n < 6 ? 2 : vs.n < 10 ? 4 : 8;
  }
  function vodSeek(delta, accel) {
    if (accel) delta *= seekAccel(delta > 0 ? 1 : -1);
    var d = Player.duration, base = vs.pending != null ? vs.pending : Player.position, t = base + delta;
    t = d ? U.clamp(t, 0, Math.max(0, d - 3)) : Math.max(0, t);
    vs.pending = t;
    clearTimeout(vs.t); vs.t = setTimeout(vodSeekCommit, 650);
    osd(true);
  }
  function vodSeekCommit() { clearTimeout(vs.t); if (vs.pending == null) return; var t = vs.pending; vs.pending = null; Player.seekTo(t); osd(true); }
  function vodSeekCancel() { clearTimeout(vs.t); vs.pending = null; vs.n = 0; osd(true); }
  // Magic Remote: click anywhere on the progress bar to jump there.
  $('osdBar').parentNode.addEventListener('click', function (e) {
    e.stopPropagation();
    var r = this.getBoundingClientRect(), f = U.clamp((e.clientX - r.left) / r.width, 0, 1);
    if (mode === 'vod' && Player.duration) { vs.pending = f * Player.duration; vodSeekCommit(); }
    else if (mode === 'catchup' && cu) { var dur = (cu.p.e - cu.p.s) / 1000, base = cu.pending != null ? cu.pending : cu.off + Player.position; cuSeek(f * dur - base); }
  });

  function fullKeys(a) {
    if (overlay) return overlayKeys(a);
    // The error message says "Press OK to try again", so OK does exactly that.
    if (a === 'ok' && !verr.classList.contains('hidden')) { Player.retryNow(); U.toast('Trying again'); return true; }
    var hidden = $('osd').classList.contains('hidden');
    if (mode === 'vod') {
      if (a === 'back') { if (vs.pending != null) { vodSeekCancel(); return true; } if (!hidden) { $('osd').classList.add('hidden'); return true; } exitFull(); }
      else if (a === 'left') vodSeek(-Store.settings.skip, true);
      else if (a === 'right') vodSeek(+Store.settings.skip, true);
      else if (a === 'down' || a === 'chdown') vodSeek(-600);
      else if (a === 'rew') vodSeek(-(+Store.settings.ffStep || 120), true);
      else if (a === 'ff') vodSeek(+Store.settings.ffStep || 120, true);
      else if (a === 'up' || a === 'chup') vodSeek(600);
      else if (a === 'ok') { Player.togglePause(); osd(true); }
      else if (a === 'playpause') playPause();
      else if (a === 'red' || a === 'hold') playerMenu();
      else if (a === 'info') osd(true);
      return true;
    }
    if (mode === 'catchup') {
      if (a === 'back') { if (!hidden) { $('osd').classList.add('hidden'); return true; } backToLive(); }
      else if (a === 'left') cuSeek(-Store.settings.skip * seekAccel(-1));
      else if (a === 'right') cuSeek(+Store.settings.skip * seekAccel(1));
      else if (a === 'down' || a === 'chdown') cuSeek(-300);
      else if (a === 'rew') cuSeek(-(+Store.settings.ffStep || 120) * seekAccel(-1));
      else if (a === 'ff') cuSeek((+Store.settings.ffStep || 120) * seekAccel(1));
      else if (a === 'up' || a === 'chup') cuSeek(300);
      else if (a === 'ok') { Player.togglePause(); osd(true); }
      else if (a === 'playpause') playPause();
      else if (a === 'red' || a === 'hold') playerMenu();
      else if (a === 'yellow') backToLive();
      else if (a === 'info') osd(true);
      return true;
    }
    if (a === 'back') { if (!hidden) { $('osd').classList.add('hidden'); return true; } exitFull(); return true; }
    if (a.indexOf('num') === 0) { zapDigit(a.slice(3)); return true; }
    var act = Keymap.get('player', a === 'hold' ? 'long:ok' : a);
    if (act) runAction(act, 'player');
    return true;
  }

  /* ---------- channel list over the video ---------- */
  function openOverlay() {
    overlay = true;
    ovGroup = curGroup;
    $('overlay').classList.remove('hidden');
    $('osd').classList.add('hidden');
    fillOverlay(playing && playing.k);
  }
  function fillOverlay(selKey) {
    var list = L.channels(ovGroup);
    var i = selKey ? list.findIndex(function (c) { return c.k === selKey; }) : 0;
    $('ovTitle').textContent = '◀  ' + L.groupName(ovGroup) + '  ▶';
    ovVL.setItems(list, Math.max(0, i));
  }
  function overlayKeys(a) {
    if (a === 'up') ovVL.move(-1, true);
    else if (a === 'down') ovVL.move(1, true);
    else if (a === 'chup') ovVL.page(-1);
    else if (a === 'chdown') ovVL.page(1);
    else if (a === 'left' || a === 'right') {
      var gs = L.groups().filter(function (g) { return !groupLocked(g); });
      if (!gs.length) return true;
      var gi = gs.findIndex(function (g) { return g.id === ovGroup; });
      gi = (gi + (a === 'left' ? -1 : 1) + gs.length) % gs.length;
      ovGroup = gs[gi].id; fillOverlay(null);
    }
    else if (a === 'ok') {
      // Like TiviMate: OK switches to the channel and keeps the list up so you can keep
      // surfing; OK on the channel that is already playing closes the list.
      var c = ovVL.current();
      if (!c) return true;
      var idx = ovVL.sel;
      if (playing && playing.k === c.k && mode === 'live') { closeOverlay(); osd(true); return true; }
      startChannel(c, false, function () {
        curGroup = ovGroup; zapIdx = idx;
        ovVL.refresh();
      });
    }
    else if (a === 'red' || a === 'hold' || a === 'info') chanMenu(ovVL.current(), ovGroup);
    else if (a === 'back') closeOverlay();
    else if (a === 'playpause') playPause();
    return true;
  }
  function closeOverlay() { overlay = false; $('overlay').classList.add('hidden'); }

  /* ---------- catch-up ---------- */
  function playCatchup(c, p, offSec) {
    if (!c.arch) { U.toast('This channel has no catch-up'); return; }
    if (p.s < Date.now() - c.arch * 86400e3) { U.toast('That programme is older than the archive'); return; }
    Parental.gate('channels', c, function () {
      if (playing && playing.k !== c.k) lastPlayed = playing;
      playing = c; mode = 'catchup';
      cu = { c: c, p: p, off: Math.max(0, offSec || 0), first: true, pending: null };
      stage.classList.remove('off');
      Player.play(c, { live: false, timeshift: true, urlFn: function () {
        if (!cu) return '';
        if (!cu.first) cu.off += Player.position;     // a reconnect continues from where playback reached
        cu.first = false;
        return Source.catchupUrl(c, p.s + cu.off * 1000, Math.max(p.e, p.s + cu.off * 1000 + 60000));
      } });
      if (!full) goFull(); else osd(true);
    });
  }
  var cuCommit = U.debounce(function () {
    if (!cu || cu.pending == null) return;
    var c = cu.c, p = cu.p, off = cu.pending;
    cu.pending = null;
    playCatchup(c, p, off);
  }, 600);
  function cuSeek(delta) {
    if (!cu) return;
    var dur = (cu.p.e - cu.p.s) / 1000;
    var base = cu.pending != null ? cu.pending : cu.off + Player.position;
    var target = base + delta;
    if (cu.p.s + target * 1000 > Date.now() - 15000) { backToLive(); return; }   // past "now" means live
    cu.pending = U.clamp(target, 0, Math.max(0, dur - 5));
    osd(true);
    cuCommit();
  }
  function cuTick() {
    var dur = (cu.p.e - cu.p.s) / 1000, at = cu.off + Player.position;
    if (cu.pending == null && at >= dur - 1) {
      // Roll into the next programme while it is still in the past, otherwise back to live.
      var list = Epg.request(cu.c) || [], nx = null;
      for (var i = 0; i < list.length; i++) if (list[i].s >= cu.p.e - 1000) { nx = list[i]; break; }
      if (nx && nx.s < Date.now() - 60000) playCatchup(cu.c, nx, 0); else backToLive();
    }
  }
  function backToLive() {
    var c = cu ? cu.c : playing;
    cu = null; mode = 'live';
    if (c) startChannel(c, !full, function () { osd(true); });
  }
  function rewindLive() {
    var nn = Epg.nowNext(playing);
    var p = nn && nn.now ? nn.now : { s: Date.now() - 3600e3, e: Date.now() + 3600e3, t: L.name(playing) };
    var off = Math.max(0, (Date.now() - p.s) / 1000 - Store.settings.skip);
    playCatchup(playing, p, off);
  }
  function watchFromStart(c) {
    var nn = Epg.nowNext(c);
    if (!nn || !nn.now) { U.toast('No guide information to start from'); return; }
    playCatchup(c, nn.now, 0);
  }
  function catchupList(c) {
    var list = (Epg.request(c) || []).filter(function (p) { return p.e < Date.now() && p.s > Date.now() - c.arch * 86400e3; }).reverse();
    if (!list.length) { U.toast(Epg.xml ? 'No past programmes in the guide' : 'Open the Guide and go left to browse older programmes'); return; }
    UI.menu('Catch-up: ' + L.name(c), list.slice(0, 40).map(function (p) {
      return { label: p.t || 'Programme', sub: new Date(p.s).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + U.hhmm(p.s), action: function () { playCatchup(c, p, 0); } };
    }));
  }

  /* ---------- VOD playback (called by Vod) ---------- */
  function playVod(meta, url, startAt, onExit) {
    vodSeekCancel();
    vod = { meta: meta, onExit: onExit };
    mode = 'vod'; cu = null; playing = null;
    stage.classList.remove('off');
    Player.play({ k: 'vod:' + meta.id, n: meta.title, num: '' }, { url: url, live: false, startAt: startAt || 0, meta: meta });
    goFull();
  }

  function zapDigit(d) {
    zapBuf = (zapBuf + d).slice(-5);
    var z = $('zapNum'); z.textContent = zapBuf; z.classList.remove('hidden');
    clearTimeout(zapT);
    // Switch the moment the number can't get any longer; otherwise wait for another digit.
    var done = !L.numberCanGrow(zapBuf);
    zapT = setTimeout(function () {
      if (done) setTimeout(function () { z.classList.add('hidden'); }, 700); else z.classList.add('hidden');
      var n = +zapBuf; zapBuf = '';
      var all = L.data.channels, c = null;
      for (var i = 0; i < all.length; i++) if (all[i].num === n && !Store.edits.hiddenChannels[all[i].k]) { c = all[i]; break; }
      if (!c) { U.toast('No channel ' + n); return; }
      startChannel(c, false, function () {
        if (!L.channels(curGroup).some(function (x) { return x.k === c.k; })) { curGroup = L.ALL; showGroup(L.ALL); }
        if (!full) goFull(); else { zapIdx = L.channels(curGroup).findIndex(function (x) { return x.k === c.k; }); osd(true); }
      });
    }, done ? 0 : 1400);
  }

  /* ---------- backup versions ----------
     A live channel that has run out of retries switches to another version of the same channel
     (Library.versions: other qualities, groups and hidden copies), each tried once.  Settings >
     Playback > When a channel stops working: switch, ask, or keep retrying. */
  var fo = null, foSwitching = false, foFailed = {};
  // The player reports from inside its own retry code: act once it has finished with this channel.
  function downSoon() { var c = playing; setTimeout(function () { if (playing === c) channelDown(); }, 0); }
  function channelDown() {
    var how = Store.settings.backups || 'auto', c = playing, now = Date.now();
    if (how === 'off' || mode !== 'live' || !c || document.body.classList.contains('mv')) return;
    foFailed[c.k] = now;
    if (!fo) fo = { from: c, tried: {} };
    fo.tried[c.k] = 1;
    var next = L.versions(fo.from).concat([fo.from]).filter(function (x) { return !fo.tried[x.k] && !(now - (foFailed[x.k] || 0) < 10 * 60e3); });
    if (!next.length) {
      // Every version failed: most likely the provider itself is down.  Go back to the channel you
      // chose and keep retrying it, so the picture returns by itself when the provider does.
      if (fo.exhausted || Object.keys(fo.tried).length < 2) return;
      fo.exhausted = true;
      Log.warn('player', 'No version of ' + fo.from.n + ' is working; back to it, retrying');
      U.toast('No version of ' + L.name(fo.from) + ' is working right now.  Still trying.', 6000);
      if (c.k !== fo.from.k) {
        var lp0 = lastPlayed;
        foSwitching = 'back';
        try { startChannel(fo.from, !full, function () { if (full) osd(true); else placePreview(); }); }
        finally { foSwitching = false; }
        lastPlayed = lp0;
      }
      return;
    }
    if (how === 'ask' && !UI.modalOpen) {
      UI.menu(L.name(c) + ' stopped working', next.slice(0, 5).map(function (x) {
        return { label: 'Switch to ' + L.name(x), sub: versionSub(x), action: function () { switchVersion(x, c); } };
      }).concat([{ label: 'Keep trying ' + L.name(c), action: function () {} }]));
      return;
    }
    if (how === 'auto') switchVersion(next[0], c);
  }
  function versionSub(x) {
    var q = L.qualityLabel(x);
    return [q, L.groupName(x.g), Store.edits.hiddenChannels[x.k] ? 'hidden' : ''].filter(Boolean).join('  ·  ');
  }
  function switchVersion(x, from) {
    if (!fo) fo = { from: from, tried: {} };
    fo.tried[x.k] = 1;
    var lp = lastPlayed, q = L.qualityLabel(x);
    Log.info('player', L.name(from) + ' stopped working; switching to ' + x.n);
    U.toast(L.name(from) + ' isn\'t working.  Switched to ' + L.name(x) + (q ? ' (' + q + ')' : ''), 6000);
    foSwitching = true;
    try { startChannel(x, !full, function () { if (full) osd(true); else placePreview(); }); }
    finally { foSwitching = false; }
    lastPlayed = lp;                          // "last channel" stays the one you chose before
  }
  function versionsSummary(c) {
    var v = L.versions(c), q = v.map(function (x) { return L.qualityLabel(x) || 'copy'; });
    return q.filter(function (x, i) { return q.indexOf(x) === i; }).join(', ');
  }
  function versionsMenu(c) {
    var v = L.versions(c);
    UI.menu('Other versions of ' + L.name(c), v.map(function (x) {
      return { label: L.name(x), sub: versionSub(x), action: function () { startChannel(x, false, function () { if (!full) goFull(); else osd(true); }); } };
    }));
  }

  /* ---------- player feedback ---------- */
  var spin = $('spinner'), spinText = $('spinnerText'), verr = $('vidError');
  function onPlayerState(s, msg) {
    if (s === 'playing' || s === 'error' || s === 'idle') stage.classList.remove('blank');
    spin.classList.toggle('hidden', !(s === 'loading' || s === 'buffering'));
    spinText.textContent = s === 'loading' ? 'Tuning' : (msg || 'Buffering');
    spinPlain = s === 'buffering' && (!msg || msg === 'Buffering');
    verr.classList.toggle('hidden', s !== 'error');
    if (s === 'error') verr.textContent = msg;
    if (s === 'ended' && mode === 'vod') Vod.ended();
    if (s === 'error' && mode === 'live') downSoon();
    // Playing again: a later failure is a new incident (recent failures are still skipped for 10 min).
    if (s === 'playing' && fo && playing) { foFailed[playing.k] = 0; fo.tried = {}; fo.exhausted = false; }
  }
  var meter = $('meter'), mFill = $('meterFill'), mText = $('meterText'), goodSince = 0, spinPlain = false;
  function onStats(x) {
    // A plain refill shows how far along it is, so a long one doesn't look stuck.
    if (spinPlain && x.state === 'buffering' && x.target) spinText.textContent = 'Buffering  ' + Math.min(99, Math.round(100 * x.ahead / x.target)) + '%';
    var m = Store.settings.meter;
    if (m === 'off' || (!full && m !== 'always')) { meter.classList.add('hidden'); return; }
    var ratio = x.target ? x.ahead / Math.max(x.target * 2, 4) : 0;
    var low = x.ahead < x.target, crit = x.ahead < 0.6;
    if (m === 'auto') {
      if (low || x.state === 'buffering') goodSince = 0; else if (!goodSince) goodSince = Date.now();
      var show = !goodSince || Date.now() - goodSince < 3000;
      meter.classList.toggle('hidden', !show || x.state === 'idle');
    } else meter.classList.toggle('hidden', x.state === 'idle');
    mFill.style.width = Math.round(U.clamp(ratio, 0, 1) * 100) + '%';
    meter.classList.toggle('low', low && !crit);
    meter.classList.toggle('crit', crit);
    mText.textContent = x.ahead.toFixed(1) + 's   ' + [x.res, x.engine, x.info].filter(Boolean).join('  ');
  }

  /* ---------- menus ---------- */
  function copyMenu(keys, label) {
    var items = L.customGroups().map(function (g) {
      return { label: g.name, sub: g.items.length + ' channels', action: function () {
        var n = L.copyTo(g.id, keys);
        U.toast(n ? 'Copied ' + (n === 1 ? label : n + ' channels') + ' to ' + g.name : 'Already in ' + g.name);
        refreshLists(true);
      } };
    });
    items.push({ label: 'New group…', action: function () {
      UI.prompt('Name the new group', '', function (name) {
        if (!name.trim()) return;
        var g = L.createGroup(name);
        var n = L.copyTo(g.id, keys);
        U.toast('Created ' + g.name + ' with ' + n + (n === 1 ? ' channel' : ' channels'));
        refreshLists(true);
      });
    } });
    UI.menu('Copy to group', items);
  }

  function chanItems(c, gid) {
    var hidden = !!Store.edits.hiddenChannels[c.k];
    var renamed = !!Store.edits.renames[c.k];
    var inCustom = L.isCustom(gid);
    var fav = L.isFav(c.k);
    var blocked = !!Store.edits.blockedChannels[c.k];
    return [
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: function () { var on = L.toggleFav(c.k); U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); } },
      { label: 'Copy to group…', action: function () { copyMenu([c.k], L.name(c)); } },
      !full && tab === 'live' && { label: 'Select multiple…', sub: 'copy, favorite or hide several', action: function () { startPick(c.k); } },
      L.versions(c).length && { label: 'Other versions…', sub: versionsSummary(c), action: function () { versionsMenu(c); } },
      c.arch && { label: 'Watch from start', action: function () { watchFromStart(c); } },
      c.arch && { label: 'Catch-up…', sub: c.arch + ' days', action: function () { catchupList(c); } },
      inCustom && gid !== L.FAV && { label: 'Remove from ' + L.groupName(gid), action: function () { L.removeFrom(gid, c.k); refreshLists(true); } },
      !full && tab === 'live' && gid === curGroup && L.canReorder(gid) && { label: 'Move…', sub: 'change its place in ' + L.groupName(gid), action: function () { startMove(c); } },
      { label: 'Rename…', sub: renamed ? 'renamed' : '', action: function () {
        UI.prompt('Rename channel', L.name(c), function (v) { L.renameChannel(c.k, v); refreshLists(true); }, 'Original: ' + c.n);
      } },
      renamed && { label: 'Restore original name', action: function () { L.renameChannel(c.k, ''); refreshLists(true); } },
      { label: 'Assign guide…', sub: Store.edits.epgMap[c.k] ? 'assigned' : Epg.pubSource(c) ? 'from the public guide (' + Epg.pubSource(c).name + ')' : Epg.hasData(c) ? '' : 'no guide yet', action: function () { Settings.assignGuide(c); } },
      Parental.enabled() && { label: blocked ? 'Unblock channel' : 'Block channel', sub: 'needs the PIN to watch', action: function () {
        var go = function () { L.block('channel', c.k, !blocked); U.toast(blocked ? 'Unblocked' : 'Blocked'); refreshLists(true); stopIfBlocked(); };
        if (blocked) Parental.gate('channels', c, go); else go();
      } },
      hidden ? { label: 'Show channel', action: function () { L.hideChannel(c.k, false); U.toast('Channel restored'); refreshLists(true); } }
             : { label: 'Hide channel', sub: 'restore from Settings', action: function () { L.hideChannel(c.k, true); U.toast('Hidden.  Restore it in Settings, Groups and hidden items.'); refreshLists(true); } }
    ];
  }

  function chanMenu(c, gid) {
    if (!c) return;
    UI.menu(L.name(c), [{ label: 'Watch', action: function () { startChannel(c, false, function () { if (!full) goFull(); else osd(true); }); } }].concat(chanItems(c, gid)));
  }

  /* ---------- quick panel (OK in fullscreen, like TiviMate) ----------
     Top: channel and what's on.  Row 1: quick actions.  Row 2: recent channels.
     ◀ ▶ move along a row, ▲ ▼ switch rows, OK picks, Back closes.  Clickable with the pointer. */
  var qp = null;                  // { row, col, rows: [[items]], timer }
  // Quick menu buttons.  Each can be switched off in Settings > Remote control > Quick menu buttons.
  var QP_BUTTONS = [['list', 'Channel list'], ['start', 'Watch from start'], ['fav', 'Favorite'], ['guide', 'TV guide'], ['versions', 'Other versions'], ['audio', 'Audio track'],
    ['subs', 'Subtitles'], ['quality', 'Video quality'], ['picture', 'Picture size'], ['sleep', 'Sleep timer'],
    ['info', 'Stream info'], ['reconnect', 'Reconnect']];
  // Line icons for the quick actions, drawn like the side menu's (24 x 24, stroked).
  var QP_ICONS = {
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    start: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
    fav: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    faved: '<path class="fill" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    guide: '<path d="M3 5h18M3 12h18M3 19h18M9 3v18"/>',
    versions: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M19 9v8a2 2 0 0 1-2 2H8"/><path d="M21 11v6"/>',
    audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    subs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h2M11 11h6"/>',
    quality: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6M11 9v6M7 12h4M14 9h2a3 3 0 0 1 0 6h-2z"/>',
    picture: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9H6v2M16 9h2v2M8 15H6v-2M16 15h2v-2"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    reconnect: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'
  };
  function qpActions() {
    var c = playing, a = [], nn = c && Epg.nowNext(c), now = Date.now(), off = Store.settings.qpHidden || {};
    function add(id, it) { if (!off[id]) { it.id = id; a.push(it); } }
    add('list', { label: 'Channel list', icon: 'list', run: function () { closePanel(); openOverlay(); } });
    if (c && c.arch && nn && nn.now && nn.now.s <= now) add('start', { label: 'From start', icon: 'start', v: 'catch-up', run: function () { closePanel(); watchFromStart(c); } });
    if (c) add('fav', { label: L.isFav(c.k) ? 'Favorite' : 'Add favorite', icon: L.isFav(c.k) ? 'faved' : 'fav', run: function () { var on = L.toggleFav(c.k); U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); renderPanel(); } });
    add('guide', { label: 'TV guide', icon: 'guide', run: function () { closePanel(); leaveTo('guide'); } });
    if (c && L.versions(c).length) add('versions', { label: 'Other versions', icon: 'versions', v: versionsSummary(c), run: function () { closePanel(); versionsMenu(c); } });
    var tracks = Player.audioTracks();
    if (tracks.length > 1) add('audio', { label: 'Audio', icon: 'audio', v: (tracks.filter(function (t) { return t.on; })[0] || {}).label || '', run: function () { closePanel(); audioMenu(); } });
    var subs = subtitleTracks();
    if (subs.length) add('subs', { label: 'Subtitles', icon: 'subs', v: (subs.filter(function (t) { return t.mode === 'showing'; })[0] || {}).label || 'off', run: function () { closePanel(); subtitleMenu(); } });
    if (Player.qualities().length > 1) add('quality', { label: 'Quality', icon: 'quality', v: qualityLabel(), run: function () { closePanel(); qualityMenu(); } });
    add('picture', { label: 'Picture', icon: 'picture', v: DM[Player.displayFor(c)] || 'Normal', run: function () { closePanel(); pictureMenu(); } });
    add('sleep', { label: 'Sleep timer', icon: 'sleep', v: sleepAt ? U.hhmm(sleepAt) : 'off', run: function () { closePanel(); sleepMenu(); } });
    add('info', { label: 'Stream info', icon: 'info', run: function () { closePanel(); streamInfo(); } });
    add('reconnect', { label: 'Reconnect', icon: 'reconnect', run: function () { closePanel(); Player.retryNow(); U.toast('Reconnecting'); } });
    if (!a.length) a.push({ id: 'list', label: 'Channel list', icon: 'list', run: function () { closePanel(); openOverlay(); } });
    return a;
  }
  function qualityLabel() { if (Player.qualityAuto()) return 'Auto'; var q = Player.qualities().filter(function (x) { return x.on; })[0]; return q ? q.label.split(' ')[0] : 'Auto'; }
  function qualityMenu() {
    var q = Player.qualities();
    UI.menu('Video quality', [{ label: 'Automatic', sub: Player.qualityAuto() ? 'on' : 'adapts to your connection', action: function () { Player.setQuality(-1); } }]
      .concat(q.map(function (x) { return { label: x.label, sub: x.on ? 'on' : '', action: function () { Player.setQuality(x.id); } }; })));
  }
  // Picture size for this channel only, or for every channel (TiviMate's "Apply to all channels").
  function pictureMenu() {
    var c = playing, own = c && Store.edits.display && Store.edits.display[c.k];
    var items = Object.keys(DM).map(function (k) {
      return { label: DM[k], sub: k === Player.displayFor(c) ? 'on' : '', action: function () {
        if (c) { Store.edits.display = Store.edits.display || {}; Store.edits.display[c.k] = k; Store.saveEdits(); }
        else { Store.settings.display = k; Store.saveSettings(); }
        Player.applyDisplay();
      } };
    });
    items.push({ label: 'Use this size for all channels', sub: 'currently ' + (DM[Store.settings.display] || 'Normal'), action: function () {
      Store.settings.display = Player.displayFor(c); Store.saveSettings(); Store.edits.display = {}; Store.saveEdits(); Player.applyDisplay(); U.toast('Picture size set for all channels');
    } });
    if (own) items.push({ label: 'Forget this channel\'s size', action: function () { delete Store.edits.display[c.k]; Store.saveEdits(); Player.applyDisplay(); } });
    UI.menu('Picture size' + (c ? ':  ' + L.name(c) : ''), items);
  }
  function speedMenu() {
    UI.menu('Playback speed', [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (r) { return { label: r === 1 ? 'Normal' : r + '×', sub: Math.abs(Player.rate - r) < 0.01 ? 'on' : '', action: function () { Player.setRate(r); } }; }));
  }
  function qpRecents() {
    return L.channels(L.RECENT).filter(function (x) { return Parental.blockedOk(x); }).slice(0, 7).map(function (x) {
      return { ch: x, run: function () { closePanel(); if (!playing || playing.k !== x.k) startChannel(x, false, function () { osd(true); }); } };
    });
  }
  function openPanel() {
    if (mode !== 'live' || !playing) { Player.togglePause(); osd(true); return; }
    $('osd').classList.add('hidden');
    qp = { row: 0, col: 0, rows: [qpActions(), qpRecents()] };
    renderPanel();
    $('qpanel').classList.remove('hidden');
    UI.setHandler(panelKeys);
    armPanel();
  }
  function armPanel() { if (!qp) return; clearTimeout(qp.timer); qp.timer = setTimeout(closePanel, 12000); }
  function closePanel() {
    if (!qp) return;
    clearTimeout(qp.timer); qp = null;
    $('qpanel').classList.add('hidden');
    if (full) UI.setHandler(fullKeys);
  }
  function renderPanel() {
    if (!qp) return;
    var el = $('qpanel'), c = playing, nn = c && Epg.nowNext(c), now = Date.now();
    qp.rows[0] = qpActions();
    el.innerHTML = '';
    var head = U.el('div', 'qp-head');
    head.appendChild(U.el('span', 'n', (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c)));
    head.appendChild(U.el('span', 't', nn && nn.now ? (nn.now.up || nn.now.ended ? '' : U.hhmm(nn.now.s) + ' – ' + U.hhmm(nn.now.e) + '   ') + nn.now.t : L.groupName(c.g)));
    el.appendChild(head);
    var bar = U.el('div', 'qp-bar'), fill = U.el('i');
    fill.style.width = nn && nn.now ? Math.round(100 * (now - nn.now.s) / (nn.now.e - nn.now.s)) + '%' : '0';
    bar.appendChild(fill); el.appendChild(bar);
    el.appendChild(U.el('div', 'qp-row-title', 'Quick actions'));
    var r0 = U.el('div', 'qp-actions');
    qp.rows[0].forEach(function (it, i) {
      var b = U.el('div', 'qp-act' + (qp.row === 0 && qp.col === i ? ' focus' : ''));
      var ic = U.el('span', 'i'); ic.innerHTML = '<svg viewBox="0 0 24 24" class="qico">' + (QP_ICONS[it.icon] || '') + '</svg>'; b.appendChild(ic);
      b.appendChild(U.el('span', '', it.label));
      if (it.v) b.appendChild(U.el('span', 'v', it.v));
      hook(b, 0, i);
      r0.appendChild(b);
    });
    el.appendChild(r0);
    if (qp.rows[1].length) {
      el.appendChild(U.el('div', 'qp-row-title', 'Recent channels'));
      var r1 = U.el('div', 'qp-recent');
      qp.rows[1].forEach(function (it, i) {
        var x = it.ch, b = U.el('div', 'qp-ch' + (qp.row === 1 && qp.col === i ? ' focus' : '') + (x.k === c.k ? ' on' : ''));
        var lg = logoOf(x); if (lg) { var im = U.el('img'); im.src = lg; im._c = x; im.onerror = function () { logoFailed(this, this._c); }; b.appendChild(im); }
        b.appendChild(U.el('span', 'nm', L.name(x)));
        var n2 = Epg.nowNext(x); b.appendChild(U.el('span', 'pg', n2 && n2.now ? n2.now.t : L.groupName(x.g)));
        hook(b, 1, i);
        r1.appendChild(b);
      });
      el.appendChild(r1);
    }
    el.appendChild(U.el('div', 'qp-row-title', '◀ ▶  move      ▲ ▼  switch row      OK  choose      Back  close'));
    focusPanel();
  }
  function hook(b, row, col) {
    b.addEventListener('mousemove', function () { if (UI.pointer && qp && (qp.row !== row || qp.col !== col)) { qp.row = row; qp.col = col; focusPanel(); armPanel(); } });
    b.addEventListener('click', function () { if (!qp) return; qp.row = row; qp.col = col; panelKeys('ok'); });
  }
  function panelKeys(a) {
    if (!qp) return true;
    armPanel();
    var rowItems = qp.rows[qp.row];
    if (a === 'left') qp.col = Math.max(0, qp.col - 1);
    else if (a === 'right') qp.col = Math.min(rowItems.length - 1, qp.col + 1);
    else if (a === 'down' && qp.rows[1].length && qp.row === 0) { qp.row = 1; qp.col = Math.min(qp.col, qp.rows[1].length - 1); }
    else if (a === 'up' && qp.row === 1) { qp.row = 0; qp.col = Math.min(qp.col, qp.rows[0].length - 1); }
    else if (a === 'ok') { var it = rowItems[qp.col]; if (it) it.run(); return true; }
    else if (a === 'back' || a === 'info') { closePanel(); return true; }
    else if (a === 'chup' || a === 'chdown') { closePanel(); fullKeys(a); return true; }
    focusPanel();
    return true;
  }
  // Moving along the panel only moves the highlight; the panel is built once per opening.
  function focusPanel() {
    var el = $('qpanel'), rs = [el.querySelectorAll('.qp-act'), el.querySelectorAll('.qp-ch')];
    for (var r = 0; r < 2; r++) for (var i = 0; i < rs[r].length; i++) rs[r][i].classList.toggle('focus', qp.row === r && qp.col === i);
    // More buttons than fit across: the row slides to keep the highlighted one in view.
    var f = rs[qp.row][qp.col], box = f && f.parentNode;
    if (box && box.scrollWidth > box.clientWidth) {
      var l = f.offsetLeft - box.offsetLeft, w = f.offsetWidth;
      if (l - box.scrollLeft < 0) box.scrollLeft = Math.max(0, l - 40);
      else if (l + w - box.scrollLeft > box.clientWidth) box.scrollLeft = l + w - box.clientWidth + 40;
    }
  }
  function subtitleTracks() {
    var t = video && video.textTracks, out = [];
    for (var i = 0; t && i < t.length; i++) if (t[i].kind === 'subtitles' || t[i].kind === 'captions') out.push(t[i]);
    return out;
  }
  function subtitleMenu() {
    var tr = subtitleTracks();
    UI.menu('Subtitles', [{ label: 'Off', sub: tr.every(function (t) { return t.mode !== 'showing'; }) ? 'on' : '', action: function () { tr.forEach(function (t) { t.mode = 'disabled'; }); } }]
      .concat(tr.map(function (t, i) { return { label: t.label || t.language || 'Track ' + (i + 1), sub: t.mode === 'showing' ? 'on' : '', action: function () { tr.forEach(function (x) { x.mode = x === t ? 'showing' : 'disabled'; }); } }; })));
  }
  function streamInfo() {
    var s = Player.stats || {};
    UI.menu('Stream info', [
      { label: 'Channel', sub: playing ? L.name(playing) : '' },
      { label: 'Player', sub: s.engine || '' },
      { label: 'Picture', sub: video && video.videoWidth ? video.videoWidth + ' × ' + video.videoHeight : '' },
      { label: 'Buffered ahead', sub: s.ahead != null ? s.ahead.toFixed(1) + ' s' : '' },
      { label: 'Details', sub: s.info || '' },
      { label: 'Catch-up', sub: playing && playing.arch ? playing.arch + ' days' : 'not available' },
      { label: 'Close' }
    ]);
  }

  function playerMenu() {
    var items = [];
    if (mode === 'live' && playing) items = items.concat(chanItems(playing, curGroup));
    if (mode === 'catchup') items.push({ label: 'Back to live', action: backToLive });
    if (mode === 'vod' && vod) items.push({ label: 'Restart from beginning', action: function () { Player.seek(-1e7); } });
    var tracks = Player.audioTracks();
    if (tracks.length > 1) items.push({ label: 'Audio track', sub: (tracks.filter(function (t) { return t.on; })[0] || {}).label, action: audioMenu });
    items.push({ label: 'Picture size', sub: DM[Player.displayFor(mode === 'live' ? playing : null)], action: pictureMenu });
    if (Player.qualities().length > 1) items.push({ label: 'Video quality', sub: qualityLabel(), action: qualityMenu });
    if (mode === 'vod' || mode === 'catchup') items.push({ label: 'Playback speed', sub: Player.rate === 1 ? 'Normal' : Player.rate + '×', action: speedMenu });
    if (subtitleTracks().length) items.push({ label: 'Subtitles', action: subtitleMenu });
    items.push({ label: 'Sleep timer', sub: sleepAt ? 'stops at ' + U.hhmm(sleepAt) : 'off', action: sleepMenu });
    items.push({ label: 'Reconnect stream', action: function () { Player.retryNow(); } });
    UI.menu(mode === 'vod' && vod ? vod.meta.title : playing ? L.name(playing) : 'Player', items);
  }

  function groupMenu(g) {
    if (!g) return;
    var custom = L.isCustom(g.id), virtual = L.isVirtual(g.id);
    var hidden = !!Store.edits.hiddenGroups[g.id], blocked = !!Store.edits.blockedGroups[g.id];
    UI.menu(g.name, [
      !virtual && { label: 'Copy all channels to group…', action: function () { copyMenu(L.channels(g.id).map(function (c) { return c.k; }), g.name); } },
      { label: 'New group…', action: function () {
        UI.prompt('Name the new group', '', function (n) { if (n.trim()) { L.createGroup(n); refreshLists(true); U.toast('Group created.  Hold OK on any channel to copy it in.'); } });
      } },
      custom && { label: 'Rename group…', action: function () { UI.prompt('Rename group', g.name, function (n) { L.renameGroup(g.id, n); refreshLists(true); }); } },
      !virtual && { label: 'Move up', action: function () { L.moveGroup(g.id, -1); refreshLists(true); groupsVL.move(-1); } },
      !virtual && { label: 'Move down', action: function () { L.moveGroup(g.id, 1); refreshLists(true); groupsVL.move(1); } },
      L.hasOwnOrder(g.id) && { label: 'Back to the provider\'s channel order', sub: 'undo the channels you moved here', action: function () { L.resetOrder(g.id); refreshLists(true); U.toast('Provider order restored'); } },
      g.id === L.EVENTS && { label: 'Turn off Events by time', sub: 'back on in Settings, the playlist, Event channels', action: function () {
        var p = Store.playlist; p.events = Object.assign({}, p.events, { group: false }); Store.upsertPlaylist(p); refreshLists(); U.toast('Events by time is off');
      } },
      g.id === L.RECENT && { label: 'Clear recent channels', action: function () { Store.edits.recent = []; Store.saveEdits(); L.dirty(); refreshLists(); } },
      !virtual && Parental.enabled() && { label: blocked ? 'Unblock group' : 'Block group', action: function () {
        var go = function () { L.block('group', g.id, !blocked); refreshLists(true); stopIfBlocked(); };
        if (blocked) Parental.gate('channels', { k: '', g: g.id }, go); else go();
      } },
      !virtual && (hidden ? { label: 'Show group', action: function () { L.hideGroup(g.id, false); U.toast('Group restored'); refreshLists(true); } }
                          : { label: 'Hide group', sub: 'restore from Settings', action: function () { L.hideGroup(g.id, true); U.toast('Hidden.  Restore it in Settings, Groups and hidden items.'); refreshLists(); } }),
      custom && { label: 'Delete group', action: function () { UI.confirm('Delete ' + g.name + '?', 'Delete', function () { L.deleteGroup(g.id); refreshLists(); }); } },
      { label: 'Edit on a phone or computer…', sub: 'scan a QR code: rename, hide and sort with a real keyboard', action: function () { WebEdit.showJoin(); } }
    ]);
  }

  function refreshLists(keepSel) {
    L.dirty();
    var gs = L.groups();
    if (!gs.some(function (x) { return x.id === curGroup; })) curGroup = gs[0] ? gs[0].id : L.ALL;
    var gsel = Math.max(0, gs.findIndex(function (x) { return x.id === curGroup; }));
    groupsVL.setItems(gs, gsel);
    var oldSel = chansVL.sel;
    var list = L.channels(curGroup);
    chansVL.setItems(list, Math.min(oldSel, list.length - 1));
    $('chanTitle').textContent = L.groupName(curGroup) + '  ' + list.length;
    if (tab === 'guide' && !UI.modalOpen && !full) Guide.refresh();
    updateInfo();
  }

  function resume() {
    var k = Store.edits.last, c = k && L.find(k);
    if (c && Store.settings.resumeLast && Parental.blockedOk(c)) {
      var i = L.channels(curGroup).findIndex(function (x) { return x.k === k; });
      if (i >= 0) chansVL.select(i);
      startChannel(c, false, goFull);
    }
  }

  // Blocking what is playing (the preview, say) stops it, so OK can't take it fullscreen without the PIN.
  function stopIfBlocked() { if (playing && mode === 'live' && !Parental.blockedOk(playing)) stopAll(); }
  function stopAll() { if (full) { full = false; document.body.classList.remove('full'); stage.classList.remove('full'); stage.classList.add('preview'); } Player.stop(); playing = null; mode = 'live'; cu = null; vod = null; stage.classList.add('off'); }

  return {
    init: init, reload: reload, switchTab: switchTab, setZone: setZone, resume: resume, refreshLists: refreshLists,
    chanMenu: chanMenu, startChannel: startChannel, goFull: goFull, playCatchup: playCatchup, playVod: playVod,
    QP_BUTTONS: QP_BUTTONS, openReminder: openReminder, exitApp: exitApp, armExit: armExit, exitArmed: exitArmed, logoOf: logoOf, ownLogo: ownLogo, logoFailed: logoFailed, tabBar: tabBar, firstFilled: firstFilled, groupMenu: groupMenu, catchupList: catchupList, home: home, get mode() { return mode; }, applyLook: applyLook, buildTabs: buildTabs, placePreview: placePreview, stopAll: stopAll,
    get group() { return curGroup; }, set group(g) { curGroup = g; },
    get full() { return full; }, get tab() { return tab; }, get zone() { return zone; }, get playing() { return playing; },
    restoreKeys: function () { UI.setHandler(full ? fullKeys : liveKeys); },
    // Read-only state for the speed tests (tests/soak/speed.js).
    __sel: function () { return chansVL ? chansVL.sel : 0; }, __gsel: function () { return groupsVL ? groupsVL.sel : 0; }
  };
})();

/* ---------- Guide (home screen) ----------
   Layout: preview window top left, programme details top right, grid below.
   Zones:
   - groups: side-menu icons plus a groups panel over the left of the grid.  ▲▼ change group
     (the grid follows), ▶ or OK goes into the grid, ◀ opens the side menu.  The guide opens here.
   - grid: the menu and groups hide for a clean full-width guide.  ◀ on what's on now opens
     the groups again; ◀ ▶ on other times move through the schedule; ⏪ ⏩ browse catch-up.
   OK on what's on now plays the channel in the window; OK again goes fullscreen.  Wherever you
   browse to afterwards, the Play button or a click on the window takes that channel fullscreen
   (webOS closes apps on a long Back press, so TiviMate's hold-Back can't be used, and plain
   Back always means "up one level" so it never surprises anyone). */
var Guide = (function () {
  'use strict';
  var $ = U.$, L = Library;
  var view = $('viewGuide'), body = $('guideBody'), timesEl = $('guideTimes'), detail = $('guideDetail'), ghead = $('guideGroup');
  var ROW = 100, VIS = 0, WIN = 2.5 * 3600e3, PXW = 0, CHW = 470, MINCELL = 220;      // narrowest a programme is drawn (px)
  var list = [], gid = null, loaded = null, sel = 0, top = 0, t0 = 0, focusT = 0, rows = [], zone = 'groups', groupsVL = null;

  function build() {
    VIS = Math.max(3, Math.floor(body.clientHeight / ROW) || 6);
    PXW = (body.clientWidth || 1808) - CHW;
    body.innerHTML = '';
    rows = [];
    for (var i = 0; i < VIS; i++) {
      var r = U.el('div', 'grow'), ch = U.el('div', 'gch'), pr = U.el('div', 'gprogs');
      ch.appendChild(U.el('span', 'num'));
      var img = U.el('img', 'logo'); img.decoding = 'async'; img.onerror = function () { Views.logoFailed(this, this._c); }; ch.appendChild(img);
      ch.appendChild(U.el('span', 'n'));
      var chips = U.el('span', 'gchips'), cuEl = U.el('span', 'cu'), qEl = U.el('span', 'qtag');
      chips.appendChild(cuEl); chips.appendChild(qEl); ch.appendChild(chips);
      r.appendChild(ch); r.appendChild(pr);
      r.style.transform = 'translateY(' + (i * ROW) + 'px)';
      r.setAttribute('data-slot', i);
      body.appendChild(r);
      rows.push({ el: r, ch: ch, pr: pr, img: img, k: null, slot: i, cells: [], cuEl: cuEl, qEl: qEl });
    }
    var nowLine = U.el('div', 'gnow'); nowLine.id = 'gnow'; body.appendChild(nowLine);
    groupsVL = new VList($('guideGroupList'), { render: renderGroupRow, onSel: onGroupSel, empty: 'No groups', visible: 7, rowH: ROW,
      onHover: function () { if (zone !== 'groups') setZone('groups'); }, onClick: function () { enterGrid(); } });
    pointerSetup();
    ghead.addEventListener('click', function () { if (mine()) setZone('groups'); });
    $('guidePreview').addEventListener('click', function () { if (mine()) watchPreview(); });
  }

  /* ---------- zones ---------- */
  function setZone(z) {
    zone = z;
    view.classList.toggle('groups-open', z === 'groups');
    document.body.classList.toggle('nav-hidden', z === 'grid');
    marquee();
    if (z === 'groups') {
      // The panel covers the channel column and no more than it has to of the programmes.
      var want = document.body.classList.contains('noguidenames') ? 260 : 470;
      $('guideGroupList').parentNode.style.width = Math.max(want, 420) + 'px';
      var gs = L.groups(), i = gs.findIndex(function (g) { return g.id === gid; });
      groupsVL.setItems(gs, Math.max(0, i));
      groupsVL.setActive(true);
    }
    Views.placePreview();
    for (var r = 0; r < rows.length; r++) drawRow(rows[r], top + r);
    drawDetail();
    hints();
  }
  function enterGrid() { if (loaded !== gid) load(gid, null); setZone('grid'); draw(); }
  function leave() { document.body.classList.remove('nav-hidden'); view.classList.remove('groups-open'); }

  function renderGroupRow(row, g) {
    if (!row._n) { var nm = U.el('span', 'name'); row._n = U.el('i'); nm.appendChild(row._n); row._t = U.el('span', 'tag'); var b = U.el('div', 'txt'); b.appendChild(nm); row.appendChild(b); row.appendChild(row._t); }
    row._n.textContent = g.name;
    var n = L.channels(g.id).length;
    row._t.textContent = g.blocked ? 'locked' : String(n);
    row.classList.toggle('hid', !n);
  }
  var groupDeb = U.debounce(function () { if (loaded !== gid) { load(gid, null); draw(); } }, 240);
  // A group name too long for the panel scrolls across while its row is focused.
  var mqT = 0, mqEl = null;
  function marquee() {
    clearTimeout(mqT);
    if (mqEl) { mqEl.style.transition = 'none'; mqEl.style.transform = ''; mqEl.classList.remove('mq'); mqEl = null; }
    if (zone !== 'groups') return;
    mqT = setTimeout(function () {
      var el = $('guideGroupList').querySelector('.row.sel .name i');
      if (!el) return;
      var over = el.scrollWidth - el.clientWidth;
      if (over <= 2) return;
      mqEl = el; el.classList.add('mq');
      var secs = Math.max(2, over / 80);
      (function go() {
        el.style.transition = 'transform ' + secs + 's linear'; el.style.transform = 'translateX(-' + over + 'px)';
        mqT = setTimeout(function () {
          el.style.transition = 'none'; el.style.transform = '';
          mqT = setTimeout(go, 1600);
        }, secs * 1000 + 1600);
      })();
    }, 900);
  }
  function onGroupSel(i, g) {
    marquee();
    if (!g || g.id === gid) return;
    gid = g.id; remember();
    ghead.textContent = L.groupName(gid);
    groupDeb();
  }
  function remember() { Views.group = gid; Store.edits.lastGroup = gid; Store.saveEdits(); }

  /* ---------- Magic Remote ---------- */
  function hit(e) {
    var r = e.target && e.target.closest ? e.target.closest('.grow') : null;
    if (!r) return null;
    var idx = top + (+r.getAttribute('data-slot'));
    var gp = e.target.closest('.gp');
    return { idx: idx, t: gp && gp.getAttribute('data-s') ? +gp.getAttribute('data-s') + 60e3 : null };
  }
  function pointTo(h) {
    if (!h || h.idx >= list.length) return;
    if (h.idx !== sel) selectIdx(h.idx);
    if (h.t && Math.abs(h.t - focusT) > 1000) { focusT = h.t; drawRow(rows[sel - top], sel); drawDetail(); }
  }
  function mine() { return Views.tab === 'guide' && !Views.full && !UI.modalOpen; }
  function pointerSetup() {
    body.addEventListener('mousemove', function (e) { if (UI.pointer && mine() && zone === 'grid') pointTo(hit(e)); });
    body.addEventListener('click', function (e) {
      if (!mine()) return;
      var h = hit(e); if (!h || h.idx >= list.length) return;
      if (zone !== 'grid') setZone('grid');
      pointTo(h); activate();
    });
  }

  function x(t) { return Math.round((t - t0) / WIN * PXW); }

  /* ---------- open / refresh ---------- */
  function load(groupId, key) {
    gid = groupId || L.ALL;
    list = L.channels(gid);
    if (!list.length && zone === 'grid') {
      var alt = Views.firstFilled();
      if (alt !== gid && L.channels(alt).length) { U.toast(L.groupName(gid) + ' is empty, showing ' + L.groupName(alt)); gid = alt; list = L.channels(gid); remember(); }
    }
    loaded = gid;
    var i = key ? list.findIndex(function (c) { return c.k === key; }) : -1;
    sel = i >= 0 ? i : 0;
    top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS));
    ghead.textContent = L.groupName(gid) + '   ' + list.length;
    body.classList.toggle('empty', !list.length);
    body.setAttribute('data-empty', 'No channels in ' + L.groupName(gid) + '.');
  }
  // From the menu: groups panel first.  With a channel playing: straight into the grid on it.
  function open(groupId, key) {
    if (!rows.length) build();
    var now = Date.now();
    t0 = now - (now % (30 * 60e3));
    focusT = now;
    zone = key ? 'grid' : 'groups';
    load(groupId, key);
    UI.setHandler(keys);
    setZone(zone);
    draw();
  }
  function resume(key) {
    if (!rows.length) return open(Views.group, key);
    UI.setHandler(keys);
    if (key) { var i = list.findIndex(function (c) { return c.k === key; }); if (i >= 0) { sel = i; top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS)); } }
    focusT = Date.now(); t0 = focusT - (focusT % (30 * 60e3));
    setZone('grid');
    draw();
  }
  function refresh() {
    if (!rows.length) return;
    var key = list[sel] && list[sel].k;
    load(gid, key);
    setZone(zone);
    draw();
  }

  /* ---------- drawing ---------- */
  function progAt(c, t) {
    var l = Epg.request(c) || [];
    for (var i = 0; i < l.length; i++) if (l[i].s <= t && l[i].e > t) return { p: l[i], i: i, l: l };
    return { p: null, i: -1, l: l };
  }
  function hasReminder(c, p) { return Store.edits.reminders.some(function (r) { return r.k === c.k && r.s === p.s; }); }
  function isPlaying(c) { var p = Views.playing; return !!(p && c && p.k === c.k && Views.mode === 'live'); }
  function previewing() { var p = Views.playing; return p && Views.mode === 'live' && !Views.full ? p : null; }

  function drawRow(r, idx) {
    if (!r) return;
    var c = list[idx];
    if (!c) { r.el.style.display = 'none'; r.k = null; return; }
    var focus = idx === sel && zone === 'grid';
    r.el.style.display = '';
    r.k = Epg.keyOf(c);
    r.el.classList.toggle('sel', focus);
    r.el.classList.toggle('playing', isPlaying(c));
    var lg = Views.logoOf(c), cuMark = c.arch && Store.settings.showCatchupMark !== false;
    var qt = L.versionTag(c);
    var head = (Store.settings.showNumbers ? c.num : '') + '|' + L.name(c) + '|' + (cuMark ? c.arch : '') + '|' + qt;
    if (r.head !== head) {
      r.head = head;
      r.ch.children[0].textContent = Store.settings.showNumbers ? c.num : '';
      r.ch.children[2].textContent = L.name(c);
      // Catch-up is just the mark here; the days are in the details above the guide.
      r.cuEl.textContent = cuMark ? '↺' : '';
      r.cuEl.style.display = cuMark ? '' : 'none';
      r.qEl.textContent = qt;
      r.qEl.style.display = qt ? '' : 'none';
    }
    r.img._c = c;
    if (r.img._src !== lg) { r.img._src = lg; r.img.style.visibility = lg ? 'visible' : 'hidden'; if (lg) r.img.src = lg; }
    var locked = !Parental.blockedOk(c);
    var l = locked ? [] : Epg.request(c), t1 = t0 + WIN, n = 0, nowT = Date.now();
    var segs = [];
    if (l) for (var i = 0; i < l.length; i++) {
      var p = l[i];
      if (p.e <= t0 || p.s >= t1) continue;
      segs.push({ p: p, a: Math.max(0, x(p.s)), b: Math.min(PXW, x(p.e)) });
    }
    // A programme with only minutes showing (one ending just after the guide's start, a short filler)
    // would be a sliver with its title cut to "J…": it borrows width from the next one, which has room.
    for (var q = 0; q < segs.length; q++) {
      var sg = segs[q], need = MINCELL - (sg.b - sg.a), nx2 = segs[q + 1];
      if (need <= 0) continue;
      if (nx2 && nx2.a <= sg.b + 1) { var give = Math.min(need, Math.max(0, nx2.b - nx2.a - MINCELL)); sg.b += give; nx2.a += give; }
      else sg.b = Math.min(PXW, sg.b + need);
    }
    segs.forEach(function (sg) {
      var p = sg.p, a = sg.a, w = Math.max(4, sg.b - sg.a);
      var past = p.e <= nowT, now = p.s <= nowT && p.e > nowT, from = Math.max(p.s, t0);
      // How much of what's on now has aired, shown inside its cell (by time, as the cell may be wider).
      cell(r, n++, 'gp' + (now ? ' now' : past ? ' past' : '') + (focus && p.s <= focusT && p.e > focusT ? ' focus' : ''), a, w,
        (past && cuMark ? '↺ ' : '') + (hasReminder(c, p) ? '◷ ' : '') + p.t, past && cuMark, p.up ? 'until ' + Events.when(p.e) : U.hhmm(p.s) + ' – ' + U.hhmm(p.e), now && w > 70 ? U.clamp(Math.round((w - 36) * (nowT - from) / Math.max(1, p.e - from)), 0, w - 36) : -1, p.s);
    });
    if (!n) cell(r, n++, 'gp none' + (focus ? ' focus' : ''), 0, PXW, locked ? 'Locked' : l ? 'No guide information' : 'Loading…', false, null, -1, '');
    for (var j = n; j < r.cells.length; j++) if (!r.cells[j].off) { r.cells[j].d.style.display = 'none'; r.cells[j].off = true; }
  }
  // Programme cells are kept per row and reused, so scrolling the guide creates no new elements.
  function cell(r, i, cls, left, w, title, cu, time, fill, start) {
    var c = r.cells[i];
    if (!c) {
      c = { d: U.el('div', 'gp'), f: U.el('i', 'gfill'), t: U.el('span', 'gt'), s: U.el('small', 'gs') };
      c.d.appendChild(c.f); c.d.appendChild(c.t); c.d.appendChild(c.s);
      r.pr.appendChild(c.d); r.cells[i] = c;
    }
    var d = c.d;
    if (c.off) { d.style.display = ''; c.off = false; }
    if (c.cls !== cls) { d.className = cls; c.cls = cls; }
    if (c.l !== left) { d.style.left = left + 'px'; c.l = left; }
    if (c.w !== w) { d.style.width = w + 'px'; c.w = w; }
    if (c.tt !== title) { c.t.textContent = title; c.tt = title; }
    if (c.cu !== cu) { c.t.className = cu ? 'gt gcu' : 'gt'; c.cu = cu; }
    if (c.ts !== time) { c.s.textContent = time || ''; c.s.style.display = time == null ? 'none' : ''; c.ts = time; }
    if (c.fw !== fill) { c.f.style.display = fill < 0 ? 'none' : ''; if (fill >= 0) c.f.style.width = fill + 'px'; c.fw = fill; }
    if (c.st !== start) { if (start === '') d.removeAttribute('data-s'); else d.setAttribute('data-s', start); c.st = start; }
  }

  function draw() {
    // Logos-only guide (Settings) gives the schedule the room the names used.
    var want = document.body.classList.contains('noguidenames') ? 260 : 470;
    if (want !== CHW || !PXW) { CHW = want; PXW = (body.clientWidth || 1808) - CHW; }
    for (var i = 0; i < rows.length; i++) drawRow(rows[i], top + i);
    if (timesKey !== t0 + '|' + CHW) {
      timesKey = t0 + '|' + CHW;
      timesEl.innerHTML = '';
      for (var t = t0; t < t0 + WIN; t += 30 * 60e3) {
        var s = U.el('span', '', U.hhmm(t)); s.style.left = (x(t) + 16) + 'px'; timesEl.appendChild(s);
      }
      var mk = U.el('span', 'gnowh'); mk.id = 'gnowh'; timesEl.appendChild(mk);
    }
    var nl = $('gnow'), nx = x(Date.now());
    if (nl) { nl.style.display = nx >= 0 && nx <= PXW ? '' : 'none'; nl.style.transform = 'translateX(' + (CHW + nx) + 'px)'; }
    var nh = $('gnowh'); if (nh) { nh.style.display = nx >= 0 && nx <= PXW ? '' : 'none'; nh.style.left = nx + 'px'; }
    drawDetail();
  }

  var timesKey = '';
  function mins(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }

  // What OK will do for the focused cell, in plain words.
  function okMeaning(c, h) {
    var now = Date.now();
    if (!c) return '';
    if (!h.p || (h.p.s <= now && h.p.e > now)) {
      if (isPlaying(c)) return 'OK  watch fullscreen';
      return Store.settings.guideOk === 'full' ? 'OK  watch fullscreen' : 'OK  play in the window, OK again for fullscreen';
    }
    if (h.p.e <= now) return c.arch ? 'OK  replay this programme' : 'Already aired.  This channel has no catch-up.';
    return hasReminder(c, h.p) ? 'OK  cancel the reminder' : 'OK  remind me when it starts';
  }

  function drawDetail() {
    detail.innerHTML = '';
    var c = zone === 'grid' || list.length ? list[sel] : null;
    var pv = previewing();
    if (!c) { detail.appendChild(U.el('b', '', L.groupName(gid))); detail.appendChild(U.el('div', 'gd-meta', list.length + ' channels.  ▶ or OK to browse them.')); nowLine(pv); return; }
    var h = progAt(c, focusT), now = Date.now();
    detail.appendChild(U.el('b', '', h.p ? h.p.t : L.name(c)));
    var meta = U.el('div', 'gd-meta');
    function part(t) { meta.appendChild(U.el('span', 'sep', '·')); meta.appendChild(document.createTextNode(t)); }
    if (h.p && (h.p.up || h.p.ended)) {
      // Event channels (events.js): the wait before an event, or the time after it
      meta.appendChild(U.el('span', 'gd-badge', h.p.up ? 'UPCOMING' : 'ENDED'));
      meta.appendChild(document.createTextNode(h.p.up ? 'Starts ' + Events.when(h.p.e) : 'Ended ' + Events.when(h.p.s)));
      if (h.p.up && h.p.e > now) part('in ' + (h.p.e - now > 48 * 3600e3 ? Math.round((h.p.e - now) / 86400e3) + ' days' : mins(h.p.e - now)));
    } else if (h.p) {
      var live = h.p.s <= now && h.p.e > now, past = h.p.e <= now;
      meta.appendChild(U.el('span', 'gd-badge' + (live ? ' live' : past && c.arch ? ' cu' : ''), live ? 'LIVE' : past ? (c.arch ? 'CATCH-UP' : 'AIRED') : 'UPCOMING'));
      meta.appendChild(document.createTextNode(new Date(h.p.s).toLocaleDateString(undefined, { weekday: 'short' }) + '  ' + U.hhmm(h.p.s) + ' – ' + U.hhmm(h.p.e)));
      part(mins(h.p.e - h.p.s));
      if (live) part(mins(h.p.e - now) + ' left');
      else if (!past) part('starts in ' + mins(h.p.s - now));
      var ps = Epg.pubSource(c);
      if (ps) part('public guide, ' + ps.name);
    } else meta.appendChild(document.createTextNode(Epg.request(c) ? 'No guide information for this time' : 'Loading guide…'));
    detail.appendChild(meta);
    var meta2 = U.el('div', 'gd-meta');
    var dq = L.versionTag(c);
    meta2.textContent = (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c) + (dq ? ' ' + dq : '') + '   ·   ' + L.groupName(c.g) + (c.arch ? '   ·   ↺ catch-up ' + c.arch + ' days' : '');
    detail.appendChild(meta2);
    if (h.p && h.p.s <= now && h.p.e > now && !h.p.up && !h.p.ended) {
      var bar = U.el('div', 'gd-prog'), fill = U.el('i'); fill.style.width = Math.round(100 * (now - h.p.s) / (h.p.e - h.p.s)) + '%'; bar.appendChild(fill); detail.appendChild(bar);
    }
    detail.appendChild(U.el('p', 'gd-desc', h.p ? Epg.desc(c, h.p) : ''));
    if (zone === 'grid') detail.appendChild(U.el('div', 'gd-ok', okMeaning(c, h)));
    nowLine(pv);
  }
  // What's in the window and how to get to it, whatever is highlighted.
  function nowLine(pv) {
    if (!pv) return;
    var d = U.el('div', 'gd-now');
    d.appendChild(document.createTextNode('In the window: ')); d.appendChild(U.el('b', '', L.name(pv)));
    d.appendChild(document.createTextNode('     Play ▶  watch it fullscreen'));
    detail.appendChild(d);
  }

  function hints() {
    if (Views.tab !== 'guide' || Views.full) return;
    var pv = previewing();
    if (zone === 'groups') {
      UI.hints([['', '▲ ▼  choose a group'], ['', 'OK or ▶  its channels', 'ok'], ['', '◀  menu', 'left'], ['', 'Hold OK  group options', 'hold'],
        pv ? ['', 'Play ▶  watch ' + L.name(pv), 'playpause'] : null, ['', 'Back  menu', 'back']].filter(Boolean));
      return;
    }
    UI.hints([['', '◀ on now  groups', 'yellow'], ['', 'Hold OK or Red  options', 'red'], ['green', 'Channels'], ['blue', 'Settings'],
      pv ? ['', 'Play ▶  watch ' + L.name(pv), 'playpause'] : null, ['', 'Back  groups', 'back']].filter(Boolean));
  }

  function selectIdx(i) {
    var n = list.length; if (!n) return false;
    var s = U.clamp(i, 0, n - 1);
    var old = sel; sel = s;
    var oldTop = top;
    if (sel < top + 1) top = sel - 1;
    if (sel > top + VIS - 2) top = sel - VIS + 2;
    top = U.clamp(top, 0, Math.max(0, n - VIS));
    var d = top - oldTop;
    if (d && Math.abs(d) < VIS) shift(d);
    else if (d) { draw(); return s !== old; }
    if (old >= top && old < top + VIS) drawRow(rows[old - top], old);
    drawRow(rows[sel - top], sel);
    detailSoon();
    return s !== old;
  }
  // Scrolling by a few rows: the rows that left the screen move to the other end and only they are
  // drawn again.  The rest just move (each row is its own layer, so moving costs no repaint).
  function shift(d) {
    var i;
    if (d > 0) for (i = 0; i < d; i++) rows.push(rows.shift());
    else for (i = 0; i < -d; i++) rows.unshift(rows.pop());
    for (i = 0; i < rows.length; i++) if (rows[i].slot !== i) {
      rows[i].slot = i; rows[i].el.style.transform = 'translateY(' + (i * ROW) + 'px)'; rows[i].el.setAttribute('data-slot', i);
    }
    if (d > 0) for (i = VIS - d; i < VIS; i++) drawRow(rows[i], top + i);
    else for (i = 0; i < -d; i++) drawRow(rows[i], top + i);
  }
  // While an arrow is held the details wait until the remote rests: the rows keep up instead.
  var detailT = 0;
  function detailSoon() {
    clearTimeout(detailT);
    if (UI.repeating) detailT = setTimeout(drawDetail, 120);
    else drawDetail();
  }
  function moveSel(d) { var s2 = sel + d; if (s2 < 0 || s2 >= list.length) return false; return selectIdx(s2); }

  // Through the schedule.  Programmes that already aired only on channels with catch-up.
  function moveTime(dir) {
    var c = list[sel]; if (!c) return false;
    var h = progAt(c, focusT), now = Date.now(), target;
    if (h.p) { var nb = h.l[h.i + dir]; target = nb ? nb.s + 60e3 : (dir > 0 ? h.p.e + 60e3 : h.p.s - 60e3); }
    else target = focusT + dir * 30 * 60e3;
    var cur = progAt(c, now).p;
    var earliest = c.arch ? now - c.arch * 86400e3 : (cur ? cur.s : now);
    if (target < earliest) { if (dir < 0 && !c.arch && h.p && h.p.e <= now) U.toast('This channel has no catch-up'); return false; }
    focusT = target;
    if (focusT >= t0 + WIN - 10 * 60e3) t0 += 30 * 60e3 * Math.ceil((focusT - (t0 + WIN - 10 * 60e3)) / (30 * 60e3) + 0.01);
    if (focusT < t0) t0 -= 30 * 60e3 * Math.ceil((t0 - focusT) / (30 * 60e3) + 0.01);
    draw();
    return true;
  }
  // Where the focus sits in time: 'now', 'future' or 'past'.
  function when() {
    var c = list[sel], now = Date.now(); if (!c) return 'now';
    var h = progAt(c, focusT);
    if (h.p) return h.p.s > now ? 'future' : h.p.e <= now ? 'past' : 'now';
    return focusT > now + 60e3 ? 'future' : focusT < now - 60e3 ? 'past' : 'now';
  }
  function jumpNow() { focusT = Date.now(); t0 = focusT - (focusT % (30 * 60e3)); draw(); }

  function toggleReminder(c, p) {
    var r = Store.edits.reminders, i = r.findIndex(function (x) { return x.k === c.k && x.s === p.s; });
    if (i >= 0) { r.splice(i, 1); U.toast('Reminder removed'); }
    else { r.push({ k: c.k, s: p.s, e: p.e, t: p.t }); U.toast('Reminder set for ' + U.hhmm(p.s)); }
    Store.saveEdits();
    draw();
  }

  function preview(c) { Views.startChannel(c, true, function () { Views.placePreview(); draw(); hints(); }); }
  function watch(c) {
    if (isPlaying(c)) return Views.goFull();
    if (Store.settings.guideOk === 'full') return Views.startChannel(c, false, Views.goFull);
    preview(c);
  }
  // The channel in the window, fullscreen, from anywhere in the guide.
  function watchPreview() { if (previewing()) { Views.goFull(); return true; } return false; }
  function activate() {
    var c = list[sel]; if (!c) return;
    var h = progAt(c, focusT), now = Date.now();
    if (!h.p || (h.p.s <= now && h.p.e > now)) return watch(c);
    if (h.p.e <= now) { if (c.arch) Views.playCatchup(c, h.p, 0); else U.toast('This channel has no catch-up'); return; }
    toggleReminder(c, h.p);
  }

  function menu() {
    var c = list[sel]; if (!c) return;
    var h = progAt(c, focusT), now = Date.now(), items = [];
    if (h.p && h.p.e <= now && c.arch) items.push({ label: 'Replay this programme', action: function () { Views.playCatchup(c, h.p, 0); } });
    items.push({ label: 'Watch fullscreen', action: function () { if (isPlaying(c)) Views.goFull(); else Views.startChannel(c, false, Views.goFull); } });
    if (!isPlaying(c)) items.push({ label: 'Play in the window', action: function () { preview(c); } });
    if (h.p && h.p.s <= now && h.p.e > now && c.arch) items.push({ label: 'Watch from the start', sub: 'catch-up', action: function () { Views.playCatchup(c, h.p, 0); } });
    if (c.arch) items.push({ label: 'Earlier programmes…', sub: 'catch-up ' + c.arch + ' days', action: function () { Views.catchupList(c); } });
    if (h.p && h.p.s > now) items.push({ label: hasReminder(c, h.p) ? 'Cancel reminder' : 'Remind me', action: function () { toggleReminder(c, h.p); } });
    if (h.p && h.p.t && !h.p.up && !h.p.ended) {
      var title = h.p.t;
      items.push({ label: 'Other showings…', sub: 'search the guide for "' + title + '"', action: function () { Views.switchTab('search'); Search.open(title); } });
      if (!Watch.has(title)) items.push({ label: 'Add to watchlist', sub: 'remind me whenever it is on', action: function () { Watch.add(title); } });
    }
    if (Math.abs(focusT - now) > 60e3) items.push({ label: 'Jump to now', action: jumpNow });
    if (previewing()) items.push({ label: 'Stop the window', sub: L.name(previewing()), action: function () { Views.stopAll(); draw(); hints(); } });
    items.push({ label: 'Channel options…', sub: 'favorite, copy to group, hide, rename', action: function () { Views.chanMenu(c, gid); } });
    UI.menu(h.p ? h.p.t : L.name(c), items);
  }

  // Number keys jump to that channel number (1, 2, 3 for 123).
  var numBuf = '', numT = 0;
  function numJump(d) {
    clearTimeout(numT); numBuf = (numBuf + d).slice(-5);
    var z = $('zapNum'); z.textContent = numBuf; z.classList.remove('hidden');
    numT = setTimeout(function () {
      z.classList.add('hidden');
      var n = +numBuf; numBuf = '';
      var i = list.findIndex(function (c) { return +c.num === n; });
      if (i < 0) {
        var c = L.channels(L.ALL).filter(function (x) { return +x.num === n; })[0];
        if (c) { load(c.g, c.k); setZone('grid'); draw(); return; }
        U.toast('No channel ' + n); return;
      }
      if (zone !== 'grid') setZone('grid');
      selectIdx(i);
    }, L.numberCanGrow(numBuf) ? 1200 : 0);
  }

  function backToMenu() { Views.tabBar(function () { UI.setHandler(keys); setZone('groups'); }, true); }
  function groupKeys(a) {
    if (a === 'up') groupsVL.move(-1);
    else if (a === 'down') groupsVL.move(1);
    else if (a === 'chup') groupsVL.page(-1);
    else if (a === 'chdown') groupsVL.page(1);
    else if (a === 'right' || a === 'ok') enterGrid();
    else if (a === 'left') backToMenu();
    else if (a === 'back') { if (Views.exitArmed()) Views.exitApp(true); else backToMenu(); }
    else if (a === 'hold' || a === 'red' || a === 'info') { var g = groupsVL.current(); if (g) Views.groupMenu(g); }
    else if (a === 'playpause') watchPreview();
    else if (a.indexOf('num') === 0) numJump(a.slice(3));
    return true;
  }
  function keys(a) {
    if (zone === 'groups') return groupKeys(a);
    if (a === 'up') moveSel(-1);
    else if (a === 'down') moveSel(1);
    else if (a === 'chup') selectIdx(sel - (VIS - 1));
    else if (a === 'chdown') selectIdx(sel + (VIS - 1));
    else if (a === 'left') { if (when() === 'now') setZone('groups'); else moveTime(-1); }
    else if (a === 'right') moveTime(1);
    else if (a === 'rew') moveTime(-1);
    else if (a === 'ff') moveTime(1);
    else if (a === 'ok') activate();
    else if (a === 'hold' || a === 'red' || a === 'info') menu();
    else if (a === 'yellow') setZone('groups');
    else if (a === 'green') Views.switchTab('live');
    else if (a === 'blue') Views.switchTab('settings');
    else if (a === 'playpause') { if (!watchPreview()) activate(); }
    else if (a === 'stop') { if (previewing()) { Views.stopAll(); draw(); hints(); } }
    else if (a === 'back') { if (when() !== 'now') jumpNow(); else { setZone('groups'); Views.armExit(); } }
    else if (a.indexOf('num') === 0) numJump(a.slice(3));
    return true;
  }

  function rowUpdated(k) {
    for (var i = 0; i < rows.length; i++) if (rows[i].k === k) { drawRow(rows[i], top + i); if (top + i === sel) drawDetail(); }
  }

  return { open: open, resume: resume, refresh: refresh, draw: draw, rowUpdated: rowUpdated, leave: leave,
    __sel: function () { return sel; }, __gsel: function () { return groupsVL ? groupsVL.sel : 0; } };
})();
