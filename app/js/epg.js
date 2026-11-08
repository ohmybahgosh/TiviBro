/* Program guide, built so the UI thread never parses anything large.

   Sources, per playlist (Settings > Guide > Guide sources):
   - The provider's guide, first: for Xtream either per-channel ("short", fast and light) or the
     full XMLTV file; for M3U the address inside the playlist.
   - Your XMLTV addresses, in priority order, each with its own time offset.  They fill the channels the
     provider's guide hasn't, and take over one it has only where their programmes agree with it
     (PubEpg.alike): a guide with more days but another channel's schedule doesn't win.
   XMLTV is streamed and parsed in a Web Worker, trimmed to a time window and to channels
   that exist in the playlist, then cached in IndexedDB.  Channels are linked to guide data
   by their guide id, by a manual assignment, or (optionally) by matching names.
   Xtream channels the XMLTV doesn't cover still get the per-channel guide.
   Channels still without a guide after all that are looked up in a free public guide (pubepg.js),
   in a second, separate pass, so your own guide is on screen first.

   Several playlists on (Library, Store): each playlist's own guide (its sources, its provider guide,
   its offsets and days) is loaded for its own channels, the first playlist's first, one after the
   other, into the same cache.  An id only another playlist's guide has is shared with every channel
   that names it.  An id two playlists' guides both have keeps the first playlist's programmes under
   the id itself; the other playlist's go under "<playlist id>|<guide id>" (alias), so each channel
   gets its own playlist's programmes.  idPl says which playlist's stored guide holds a key, for
   descriptions.  The per-channel provider
   guide asks the channel's own playlist.  The public fill-in is one pass over every channel still
   without a guide, with the first playlist's public guide settings. */
var Epg = (function () {
  'use strict';

  var cache = new Map();        // guide key -> { at, list:[{s,e,t,d}] }
  var listeners = [];
  var queue = [], inflight = 0, MAX = 3, TTL = 20 * 60 * 1000;
  var xmlMode = false, xmlReady = false, icons = {}, matched = {}, chList = [], status = { at: 0, sources: [] };
  // Public guide fill-in: channel key -> guide id ("epgpw:US/464745"), its guide channels, how it went.
  var pubMatched = {}, pubList = [], pubStatus = null, pubForce = false, pubGen = 0, PUB_ID = /^\w+:[A-Z]{2}\//;
  var loading = null;
  // Live progress of a full guide download, for the TV chip and the web editor.
  var progress = { active: false }, progListeners = [];
  function setProgress(p) {
    progress = p;
    // For the next start if TiviBro closes during a load (Log.unclean).
    Log.state('guide', p.active ? (p.phase === 'save' ? 'saving the guide' : 'loading the guide from ' + (p.host || 'a guide source') + (p.of > 1 ? ' (' + p.src + ' of ' + p.of + ')' : '') +
      (p.total ? ', ' + Math.min(99, Math.floor(100 * p.bytes / p.total)) + '%' : p.bytes ? ', ' + mb(p.bytes) : '')) : '');
    for (var i = 0; i < progListeners.length; i++) { try { progListeners[i](p); } catch (e) {} }
    chip(p);
  }
  function hostOf(u) { var m = /^(?:https?:\/\/)?(?:[^@/]*@)?([^/:?#]+)/i.exec(u || ''); return m ? m[1] : 'guide'; }
  function mb(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; }
  // Small corner chip on the TV while a big guide loads, so nothing looks frozen.
  function chip(p) {
    var el = document.getElementById('epgProg'); if (!el) return;
    if (!p.active) {
      var T = function (x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : x; };
      if (p.message) { el.textContent = T(p.message); el.className = 'epgprog' + (p.phase === 'error' ? ' bad' : p.phase === 'done' ? ' ok' : ''); }
      else if (p.phase === 'error') { el.textContent = T('Guide did not load: {x}', { x: p.error || 'error' }); el.className = 'epgprog bad'; }
      else if (p.phase === 'done') { el.textContent = T('Guide loaded'); el.className = 'epgprog ok'; }
      clearTimeout(chip.t); chip.t = setTimeout(function () { el.className = 'epgprog hidden'; }, 3500);
      return;
    }
    clearTimeout(chip.t);
    var pct = p.total ? Math.min(99, Math.floor(100 * p.bytes / p.total)) : -1;
    el.className = 'epgprog';
    var T2 = function (x) { return typeof I18n !== 'undefined' ? I18n.t(x) : x; };
    el.innerHTML = '<b>' + T2('Loading guide') + (p.of > 1 ? ' ' + p.src + '/' + p.of : '') + '</b> ' +
      (p.phase === 'save' ? T2('saving…') : pct >= 0 ? pct + '%' : mb(p.bytes || 0)) +
      '<i style="width:' + (pct >= 0 ? pct : 100) + '%"' + (pct < 0 ? ' class="indet"' : '') + '></i>';
  }

  /* What the guide says about a programme, as a few letters (the same as service/guide.js movieFlag, which
     the helper writes into titles.tsv): m movie with its year ("m2011"), s sports, n news, c kids,
     d documentary, ! new, ~S2 E5 season and episode.  Made in the worker (injected as source) and read
     back into the programme by readFlag: mv, y, k, n, ep. */
  function progFlag(body) {
    var k = '', y = null;
    if (/<category[^>]*>\s*(?:(?:tv |feature )?(?:movies?|films?)|spielfilm|película|cine|kino)\s*<\/category>/i.test(body)) { k = 'm'; y = /<date[^>]*>\s*((?:19|20)\d\d)\s*<\/date>/.exec(body); }
    else {
      var cats = '', re = /<category[^>]*>([^<]*)<\/category>/gi, m;
      while ((m = re.exec(body))) cats += ' ' + m[1].toLowerCase();
      if (cats) {
        if (/\b(sports?|football|soccer|basketball|baseball|hockey|tennis|golf|rugby|cricket|boxing|wrestling|mma|ufc|motorsports?|racing|nfl|nba|nhl|mlb|deportes?|f[uú]tbol|futebol|esportes?|calcio)\b/.test(cats)) k = 's';
        else if (/\b(news|noticias|not[ií]cias|noticiero|nachrichten|informativos?|current affairs|weather)\b/.test(cats)) k = 'n';
        else if (/\b(children|childrens|child|kids|infantil|infantiles|animation|animated|cartoons?|jeunesse|kinder)\b/.test(cats)) k = 'c';
        else if (/\b(documentar(?:y|ies)|documental|document[aá]rio|documentaire|dokumentation|nature|history|science)\b/.test(cats)) k = 'd';
      }
    }
    var ep = '', on = /<episode-num[^>]*system="onscreen"[^>]*>\s*([^<]*?)\s*<\/episode-num>/i.exec(body);
    if (on) {
      var se = /S\s*(\d{1,4})\s*[.:\-]?\s*E\s*(\d{1,5})/i.exec(on[1]), eo = /^(?:E|Ep\.?\s*)?(\d{1,5})$/i.exec(on[1]);
      ep = se ? 'S' + +se[1] + ' E' + +se[2] : eo ? 'E' + +eo[1] : '';
    }
    if (!ep) {
      var ns = /<episode-num[^>]*system="xmltv_ns"[^>]*>\s*([^<]*?)\s*<\/episode-num>/i.exec(body);
      if (ns) { var pp = ns[1].split('.'), sn = parseInt(pp[0], 10), en = parseInt(pp[1], 10); if (!isNaN(en)) ep = (isNaN(sn) ? '' : 'S' + (sn + 1) + ' ') + 'E' + (en + 1); }
    }
    // No <episode-num>: some guides start the description with it ("S04 E07 Love That Lets Go Lilly finally…").
    if (!ep) { var dse = /<desc[^>]*>\s*(?:<!\[CDATA\[)?\s*S(\d{1,3})\s*[.:\-]?\s*E(\d{1,4})\b/i.exec(body); if (dse) ep = 'S' + +dse[1] + ' E' + +dse[2]; }
    return k + (y ? y[1] : '') + (/<new\s*\/?>/i.test(body) ? '!' : '') + (ep ? '~' + ep : '');
  }
  function readFlag(f, pg) {
    var m = /^([mscnd]?)(\d{4})?(!?)(?:~(.*))?$/.exec(f || '');
    if (!m) return pg;
    if (m[1] === 'm') pg.mv = 1; else if (m[1]) pg.k = m[1];
    if (m[2]) pg.y = m[2];
    if (m[3]) pg.n = 1;
    if (m[4]) pg.ep = m[4];
    return pg;
  }

  // Same normaliser in the page and in the worker (injected as source).
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|raw|east|west|backup|us|usa|uk|ca)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  }

  function P() { return Store.playlist; }
  // The playlist a channel belongs to (several playlists on), else the first.
  function PL(ch) { return Store.plOf ? Store.plOf(ch) : P(); }
  var idPl = {};                // guide key -> the other playlist whose stored guide holds it (the first's are not listed)
  var alias = {};               // playlist id -> { guide id: its own key, where an earlier playlist has that id too }
  // The guide id as its playlist's own guide holds it (alias), or as it is.
  function own(ch, id) { var a = id && ch && ch.p && alias[ch.p]; return (a && a[id]) || id; }
  // A cache key back to the guide id its playlist's stored guide knows.
  function bare(key) { var w = idPl[key]; return w && key.indexOf(w + '|') === 0 ? key.slice(w.length + 1) : key; }
  // Does this guide id have anything from now on?  (Lists are in time order: the last one tells.)
  function live(id) { var x = cache.get(id), l = x && x.list; return !!(l && l.length && l[l.length - 1].e > Date.now()); }
  function epgId(ch) {
    var m = Store.edits.epgMap && Store.edits.epgMap[ch.k];
    if (m) return m;
    var id = own(ch, matched[ch.k] || ch.epg || '');
    // Per-channel provider guide: an XMLTV source's listings that disagree with it give way to it (vote).
    if (id && votes[ch.k] && votes[ch.k][0] === 'p' && votes[ch.k][2] === id && shortAllowed(ch)) return '';
    // The public guide only stands in where your sources and the provider's have nothing (or nothing
    // from now on: a provider's Pluto TV entries can stop days early).
    if (pubMatched[ch.k] && !(id && live(id))) return pubMatched[ch.k];
    // A sports guide (Settings > Guide > Sports guides) stands in for a sports channel's own guide when it
    // reaches at least half a day further ahead, and only where the two agree on what's on: the provider's
    // two days of Big Ten Network become six, but a sports guide with another channel's games doesn't win.
    if (pubMatched[ch.k] && typeof PubEpg !== 'undefined' && PubEpg.isSportsId && PubEpg.isSportsId(pubMatched[ch.k]) && endOf(pubMatched[ch.k]) > endOf(id) + 12 * 3600e3 && agree(id, pubMatched[ch.k])) return pubMatched[ch.k];
    return id;
  }
  // Do two guide ids' lists agree (PubEpg.alike)?  Remembered while both lists stay the same ones.
  var agreed = {};
  function agree(id, other) {
    var a = cache.get(id), b = cache.get(other), k = id + '\n' + other, m = agreed[k];
    if (!a || !b) return !a;
    if (m && m.a === a.list && m.b === b.list && Date.now() - m.at < 3600e3) return m.v;
    var v = !PubEpg.alike || PubEpg.alike(a.list, b.list, Date.now());
    agreed[k] = { a: a.list, b: b.list, v: v, at: Date.now() };
    return v;
  }

  /* Xtream with the per-channel provider guide: an XMLTV source's channel is checked against the provider's own
     listings for it the first time it's shown (and again after a day).  Where they disagree the provider's
     are used.  votes: channel key -> ['x' (the source's) or 'p' (the provider's), when, the guide id], kept
     in localStorage so it's settled once, not every start. */
  var votes = (function () { try { return JSON.parse(localStorage.getItem('tivibro.guideVotes') || '{}') || {}; } catch (e) { return {}; } })(), voteSave = 0;
  function vote(ch, list) {
    var id = own(ch, matched[ch.k] || ch.epg || ''), x = id && cache.get(id);
    if (!x || !list || !list.length || !(typeof PubEpg !== 'undefined' && PubEpg.alike)) return;
    var v = PubEpg.alike(list, x.list, Date.now()) ? 'x' : 'p', was = votes[ch.k];
    votes[ch.k] = [v, Date.now(), id];
    if (!was || was[0] !== v) { if (v === 'p') Log.info('epg', Library.name(ch) + ': the guide source\'s listings differ from the provider\'s; using the provider\'s'); emit(ch.k); emit(id); }
    clearTimeout(voteSave);
    voteSave = setTimeout(function () {
      var ks = Object.keys(votes);
      if (ks.length > 4000) ks.sort(function (p, q) { return votes[p][1] - votes[q][1]; }).slice(0, ks.length - 4000).forEach(function (k) { delete votes[k]; });
      try { localStorage.setItem('tivibro.guideVotes', JSON.stringify(votes)); } catch (e) {}
    }, 1000);
  }
  // Is this channel's XMLTV guide still to be checked against the provider's (no vote, an old one, another id)?
  function toVote(ch, id) {
    if (!shortAllowed(ch) || (Store.edits.epgMap && Store.edits.epgMap[ch.k]) || (pubMatched[ch.k] && id === pubMatched[ch.k])) return false;
    var w = votes[ch.k];
    return !w || w[2] !== id || Date.now() - w[1] > 86400e3;
  }
  function endOf(id) { var x = id && cache.get(id), l = x && x.list; return l && l.length ? l[l.length - 1].e : 0; }
  // Guide data for a channel lives under its XMLTV id when the XMLTV has it, otherwise under the channel key.
  function keyOf(ch) {
    if (xmlMode) { var id = epgId(ch); if (id && cache.has(id)) return id; }
    return ch.k;
  }
  function emit(k) { for (var i = 0; i < listeners.length; i++) listeners[i](k); }
  function shortAllowed(ch) { var p = ch ? PL(ch) : P(); return p.type === 'xtream' && p.providerEpg === 'short'; }

  /* ---------- Xtream short EPG ---------- */
  function pump() {
    while (inflight < MAX && queue.length) {
      var job = queue.pop();                        // LIFO: what you are looking at now wins
      if (Date.now() - job.t > 4000) { var j = cache.get(job.ch.k); if (j && j.pending) cache.delete(job.ch.k); continue; }
      inflight++;
      run(job.ch).then(done, done);
    }
  }
  function done() { inflight--; pump(); }
  function run(ch) {
    var k = ch.k, off = (+PL(ch).epgOffset || 0) * 60000;
    return U.getJSON(Source.shortEpgUrl(ch, 10), 12000).then(function (r) {
      var arr = (r && r.epg_listings) || [];
      var list = arr.map(function (p) {
        var s = +p.start_timestamp ? +p.start_timestamp * 1000 : Date.parse((p.start || '').replace(' ', 'T') + 'Z');
        var e = +p.stop_timestamp ? +p.stop_timestamp * 1000 : Date.parse((p.end || p.stop || '').replace(' ', 'T') + 'Z');
        return { s: s + off, e: e + off, t: U.b64utf8(p.title), d: U.b64utf8(p.description) };
      }).filter(function (p) { return p.e > p.s && isFinite(p.s); }).sort(function (a, b) { return a.s - b.s; });
      cache.set(k, { at: Date.now(), list: untangle(list) });
      if (xmlMode) vote(ch, list);
      emit(k);
    }).catch(function () { cache.set(k, { at: Date.now() - TTL + 60000, list: [] }); });
  }

  /* Event channels (events.js): when the guide has nothing for a channel whose name carries the
     event and its time, the guide shows that event at its time instead. */
  // A guide list as shown: team channels' "Next game" blocks become the game (Events.games), once per list.
  var shaped = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function shape(list) {
    if (!list || !list.length || typeof Events === 'undefined' || !Events.games) return list;
    var hit = shaped && shaped.get(list);
    if (hit) return hit;
    var out = Events.games(list);
    if (shaped) shaped.set(list, out);
    return out;
  }
  function request(ch) {
    var list = shape(guideFor(ch));
    if (list && list.length) return list;
    var ev = ch && typeof Events !== 'undefined' ? Events.of(ch) : null;
    return ev ? Events.programmes(ev) : list;
  }
  function guideFor(ch) {
    if (!ch) return null;
    if (xmlMode) {
      var id = epgId(ch);
      var x = id && cache.get(id);
      if (x) { if (toVote(ch, id)) ask(ch); return x.list; }
      if (!shortAllowed(ch)) return xmlReady ? [] : null;
    } else if (!shortAllowed(ch)) return [];
    var k = ch.k, hit = cache.get(k);
    if (hit && !hit.pending && Date.now() - hit.at < TTL) return hit.list;
    ask(ch);
    return hit ? hit.list : null;
  }
  // The per-channel provider guide for a channel, asked for (once at a time).
  function ask(ch) {
    var k = ch.k, hit = cache.get(k);
    if (hit && hit.pending) return;
    if (hit && Date.now() - hit.at < TTL && hit.list.length) { if (xmlMode) vote(ch, hit.list); return; }
    cache.set(k, { at: hit ? hit.at : 0, list: hit ? hit.list : [], pending: true });
    queue.push({ ch: ch, t: Date.now() });
    if (queue.length > 60) queue.splice(0, queue.length - 60);
    pump();
  }

  /* What is on now and next from what the guide already has, without asking for more (the phone
     app's channel list asks for every channel at once). */
  function peek(ch) {
    if (!ch) return null;
    var list = null;
    if (xmlMode) { var id = epgId(ch), x = id && cache.get(id); if (x) list = x.list; }
    if (!list) { var hit = cache.get(ch.k); if (hit) list = hit.list; }
    list = shape(list);
    if (!list || !list.length) { var ev = typeof Events !== 'undefined' ? Events.of(ch) : null; list = ev ? Events.programmes(ev) : null; }
    if (!list) return null;
    var t = Date.now();
    for (var i = 0; i < list.length; i++) {
      if (list[i].s <= t && list[i].e > t) return { now: list[i], next: after(list, i) };
      if (list[i].s > t && list[i].e > list[i].s) return { now: null, next: list[i] };
    }
    return null;
  }

  /* The programme after list[i], passing over empty ones: untangle() leaves a programme that started at the
     same time as another with no time of its own (a guide listing "CNN Special Program" and "Election Day in
     America" both at 9:00), kept in the list only so positions don't move. */
  function after(list, i) { for (var j = i + 1; j < list.length; j++) if (list[j].e > list[j].s) return list[j]; return null; }
  function nowNext(ch) {
    var list = request(ch);
    if (!list) return null;
    var t = Date.now(), now = null, next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].s <= t && list[i].e > t) { now = list[i]; next = after(list, i); break; }
      if (list[i].s > t && list[i].e > list[i].s) { next = list[i]; break; }
    }
    return { now: now, next: next };
  }

  /* ---------- XMLTV worker ---------- */
  function workerMain() {
    // norm() and pubKeys() arrive as self.norm and self.pubKeys (see work()): the release build
    // minifies this file, renaming functions and dropping comments, so nothing here may depend on
    // either; property names survive.
    function ts(s) {
      var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s || '');
      if (!m) return 0;
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      if (m[7]) { var sign = m[7][0] === '-' ? -1 : 1; t -= sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000; }
      return t;
    }
    function unesc(s) {
      return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, function (a, n) { return String.fromCharCode(parseInt(n, 16)); })
        .replace(/&#(\d+);/g, function (a, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
    }
    /* A game whose two sides are only in the sub-title ("College Football", "Dartmouth at Princeton"):
       into the title, so it reads as the game and My teams finds it (service/guide.js has the same). */
    var GAME_T = /football|basketball|hockey|baseball|soccer|\bncaa|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|\bmls\b/i, GAME_SUB = /\s(?:at|vs\.?|v\.?|versus)\s|@/i;
    function withSub(t, block) {
      if (!t || !GAME_T.test(t) || block.indexOf('<sub-title') < 0) return t;
      var st = /<sub-title[^>]*>([\s\S]*?)<\/sub-title>/.exec(block);
      st = st ? unesc(st[1]).replace(/\s+/g, ' ').trim() : '';
      if (!st || st.length > 80 || !GAME_SUB.test(' ' + st + ' ') || t.indexOf(st) >= 0) return t;
      var m = /^([\s\S]*?)(\s*\[[^\]]*\]\s*)?$/.exec(t);
      return m[1] + ': ' + st + (m[2] || '');
    }
    self.onmessage = function (ev) {
      var d = ev.data, want = {}, names = d.names || {}, from = d.from, to = d.to, past = d.past || {}, recent = d.recent || from, descMax = d.descMax || 400;
      // Memory budget (characters held, roughly): past half, descriptions get short; near the end no new
      // channels are taken; at the end nothing more.  A huge extra guide used to run the TV out of memory.
      var budget = d.budget || 0, used = 0, left = {};
      d.ids.forEach(function (i) { want[i] = 1; });
      // Earliest programme end worth keeping for a guide id: its catch-up days, or the last few hours.
      var since = {};
      function sinceOf(id) { var v = since[id]; if (v === undefined) v = since[id] = past[id] ? Math.max(from, Date.now() - past[id] * 86400e3) : recent; return v; }
      var out = {}, icons = {}, chans = [], matches = {}, report = [], total = 0, lastPost = 0;
      // The provider's guide comes first.  A channel it has (prov) is taken over by a later source only when
      // that source's programmes agree with it (self.alike: the same titles at the same times), not just
      // because it reaches more days ahead.  The first source that agrees takes it.
      var prov = {};
      // Public guide pass: pk maps matching keys to [channel key, past days] for the channels with no
      // guide.  Each guide channel's keys are looked up there; a channel takes its best-ranked match
      // within a source, and a channel matched by one source is not looked up in the next.
      var pk = d.pk || {}, best = {}, claimed = {}, pubMatch = {}, pubWant = {};
      (d.pubWant || []).forEach(function (i) { pubWant[i] = 1; });
      function tell(i, src, bytes, size, force) {
        var t = Date.now();
        if (!force && t - lastPost < 400) return;
        lastPost = t;
        // No size from the server: the size of the last full download of this guide, as an estimate.
        var est = !size && src.known > 0;
        self.postMessage({ progress: { src: i + 1, of: d.sources.length, host: src.host, bytes: bytes, total: est ? Math.max(src.known, bytes) : size, est: est, programmes: total, channels: chans.length } });
      }
      function one(src, i) {
        var got = {}, buf = '', n = 0, inFile = 0, off = (+src.offset || 0) * 60000, P = src.pub, wantP = {}, cand = {}, over = 0, kept = 0;
        var RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
        var CH = /<channel\b[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
        // This source's programmes for channels the provider's guide has: in place of the provider's if they agree.
        function judge() {
          for (var ck in cand) {
            if (self.alike(out[ck], cand[ck], Date.now())) { out[ck] = cand[ck]; delete prov[ck]; got[ck] = 1; over++; }
            else { kept++; for (var q = 0; q < cand[ck].length; q++) used -= 60 + cand[ck][q].t.length + cand[ck][q].d.length; }
          }
          cand = {};
        }
        function eat(final) {
          CH.lastIndex = 0;
          var c, lastC = 0;
          while ((c = CH.exec(buf))) {
            lastC = CH.lastIndex;
            var id = unesc(c[1]);
            if (!id.trim()) continue;            // <channel id="">: no programme can point at it
            var dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/.exec(c[2]);
            var name = dn ? unesc(dn[1]).trim() : id;
            inFile++;
            if (chans.length < 30000) chans.push([id, name]);
            if (P) {
              var pid = P.prefix + id;
              if (chans.length < 30000) chans.push([pid, name]);
              if (pubWant[pid]) wantP[id] = 1;
              var kk = self.pubKeys(name, id), pc = kk.country === 'UK' ? 'GB' : kk.country;
              kk.keys.push(['id:' + id, 0]);
              for (var q = 0; q < kk.keys.length; q++) {
                var cs = pk[kk.keys[q][0]];
                if (!cs) continue;
                var r = kk.keys[q][1] * 10 + (pc && pc !== P.cc ? 5 : 0);          // "PLUTO - CNN" loses to "US - CNN"
                for (var z = 0; z < cs.length; z++) {
                  var ck = cs[z][0], b = best[ck];
                  if (claimed[ck] || (b && b.r <= r) || (cs[z][2] && cs[z][2] !== P.cc)) continue;
                  best[ck] = { id: id, r: r }; wantP[id] = 1;
                  if (!(pid in past) || past[pid] < cs[z][1]) past[pid] = cs[z][1];
                }
              }
              if (wantP[id] && !icons[pid]) { var pi = /<icon[^>]*src="([^"]+)"/.exec(c[2]); if (pi) icons[pid] = unesc(pi[1]); }
              continue;
            }
            var nk = self.norm(name);
            if (!want[id] && nk && names[nk] != null && !matches[nk]) { matches[nk] = id; want[id] = 1; if (!(id in past) || past[id] < names[nk]) past[id] = names[nk]; }
            if (want[id] && !icons[id]) { var ic = /<icon[^>]*src="([^"]*)"/.exec(c[2]); if (ic) icons[id] = unesc(ic[1]); }
          }
          RE.lastIndex = 0;
          var m, last = lastC;
          while ((m = RE.exec(buf))) {
            last = RE.lastIndex;
            var a = m[1];
            var ch = /channel="([^"]*)"/.exec(a); ch = ch && unesc(ch[1]);
            if (!ch) continue;
            if (P) { if (!wantP[ch]) continue; ch = P.prefix + ch; } else if (!want[ch]) continue;
            var alt = !!cand[ch];
            if (!alt && out[ch] && !got[ch]) {                            // a higher-priority source already has this channel
              if (P || src.provider || !prov[ch]) continue;
              alt = true; cand[ch] = [];
            }
            var s = ts((/start="([^"]*)"/.exec(a) || [])[1]) + off, e = ts((/stop="([^"]*)"/.exec(a) || [])[1]) + off;
            if (!s || !e || e < sinceOf(ch) || s > to) continue;
            var t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
            var de = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
            if (budget && (used > budget || (!out[ch] && used > budget * 0.85))) { left[ch] = 1; continue; }
            var tt = t ? withSub(unesc(t[1]), m[2]) : '', dd = de ? unesc(de[1]).slice(0, budget && used > budget / 2 ? 100 : descMax) : '';
            used += 60 + tt.length + dd.length;
            var pg = { s: s, e: e, t: tt, d: dd };
            var fl = self.progFlag(m[2]); if (fl) self.readFlag(fl, pg);
            if (alt) { cand[ch].push(pg); n++; total++; continue; }
            got[ch] = 1;
            if (src.provider) prov[ch] = 1;
            (out[ch] || (out[ch] = [])).push(pg);
            n++; total++;
          }
          buf = final ? '' : buf.slice(last);
          if (buf.length > 4e6) buf = buf.slice(-1e6);
        }
        var poll = 0, rd = null, seen = 0, done = 0;
        return fetch(src.url, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var unzipped = !!r.headers.get('x-unzipped');                 // the helper did it
          var gz = !src.xfer && /\.gz($|\?)/.test(src.url);              // direct connection: unzip here
          if (gz && typeof DecompressionStream === 'undefined') { try { r.body.cancel(); } catch (e) {} throw new Error('This TV can only read .gz guides through the network helper.  Set Settings > Playback > Connection to Automatic, or use the plain .xml address.'); }
          var size = +(r.headers.get('x-raw-length') || r.headers.get('content-length')) || 0, bytes = 0, raw = r.body;
          // Unzipped by the helper: progress counts the zipped bytes it has downloaded, not the XML.
          if (unzipped) poll = setInterval(function () {
            fetch(src.xfer, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (x) { if (x && x.raw) { if (x.total) size = x.total; seen = x.raw; tell(i, src, x.raw, size); } }, function () {});
          }, 500);
          // Count bytes as they arrive (before unzipping) so the TV and the editor can show real progress.
          try {
            if (!unzipped) raw = r.body.pipeThrough(new TransformStream({ transform: function (chunk, ctl) { bytes += chunk.length; tell(i, src, bytes, size); ctl.enqueue(chunk); } }));
          } catch (e) { raw = r.body; }
          tell(i, src, 0, size, true);
          var body = gz ? raw.pipeThrough(new DecompressionStream('gzip')) : raw;
          var reader = rd = body.getReader(), dec = new TextDecoder('utf-8');
          function step() {
            return reader.read().then(function (x) {
              if (x.done) {
                buf += dec.decode(); eat(true); done = unzipped ? size || seen : bytes;
                if (unzipped && size) tell(i, src, size, size, true);
                // A small file can finish before the helper's byte count was read: ask once more.
                if (unzipped && !size) return fetch(src.xfer, { cache: 'no-store' }).then(function (y) { return y.json(); }).then(function (y) { if (y && y.raw) done = y.total || y.raw; }, function () {});
                return;
              }
              if (raw === r.body && !unzipped) { bytes += x.value.length; tell(i, src, bytes, size); }
              buf += dec.decode(x.value, { stream: true });
              if (buf.length > 512 * 1024) eat(false);
              return step();
            });
          }
          return step();
        }).then(function () { if (poll) { clearInterval(poll); poll = 0; } judge(); report.push({ url: src.label || src.url, key: src.key, bytes: done, ok: true, programmes: n, channels: Object.keys(got).length, inFile: inFile, filled: settle(), over: over, kept: kept }); },
          function (e) { clearInterval(poll); if (rd) { try { rd.cancel(); } catch (x) {} }      // stop the download too
            cand = {};
            report.push({ url: src.label || src.url, ok: false, error: String(e && e.message || e), filled: settle() }); });
        // Public pass: fix this source's matches (only those with programmes count).
        function settle() {
          if (!P) return undefined;
          var f = 0;
          for (var ck in best) { if (claimed[ck]) continue; var sid = P.prefix + best[ck].id; if (out[sid]) { pubMatch[ck] = sid; claimed[ck] = 1; f++; } }
          best = {};
          return f;
        }
      }
      var chain = Promise.resolve();
      // Public pass: a file is only worth downloading while some channel it could match is still open.
      function worth(src) {
        if (!src.pub) return true;
        for (var key in pk) for (var j = 0; j < pk[key].length; j++) { var e = pk[key][j]; if (!claimed[e[0]] && (!e[2] || e[2] === src.pub.cc)) return true; }
        for (var w in pubWant) if (w.indexOf(src.pub.prefix) === 0) return true;
        return false;
      }
      d.sources.forEach(function (src, i) { chain = chain.then(function () { if (!worth(src)) { report.push({ url: src.label || src.url, ok: true, programmes: 0, channels: 0, filled: 0, skipped: true }); return; } return one(src, i); }); });
      chain.then(function () {
        if (d.pub) {
          // Programmes kept for guide channels that lost to a better match: not needed.
          var used = {}, u;
          for (u in pubMatch) used[pubMatch[u]] = 1;
          for (u in pubWant) used[u] = 1;
          for (u in out) if (!used[u]) { delete out[u]; delete icons[u]; }
        }
        for (var k in out) out[k].sort(function (a, b) { return a.s - b.s; });
        for (var lk in left) if (out[lk]) delete left[lk];
        self.postMessage({ map: out, icons: icons, channels: chans, matches: matches, report: report, pubMatch: pubMatch, trimmed: Object.keys(left).length });
      });
    };
  }

  function sources(p) {
    p = p || P();
    var list = (p.epgSources || []).filter(function (s) { return s && s.url; }).map(function (s) { return { url: s.url.trim(), offset: +s.offset || 0 }; });
    if (p.providerEpg === 'xmltv') {
      var part = p.id !== P().id && Library.partOf ? Library.partOf(p.id) : null;
      var prov = part ? part.epgUrl : Library.data.epgUrl;
      // First: your provider's guide is the one to go by; your sources fill what it lacks, and take over a
      // channel only where they agree with it (alike, in the worker and the helper).
      if (prov) list.unshift({ url: prov, offset: +p.epgOffset || 0, provider: true });
    }
    return list;
  }

  /* Guides sometimes have two programmes at once on a channel: an old schedule left in next to the new
     one (FX with National Treasure 10:00pm-1:00am and X-Men 10:25pm-12:55am, X-Men airing).  The later
     start is what airs, so the earlier one ends there.  Only ends move: descriptions the helper keeps
     are found by a programme's place in the list. */
  /* Tags some guides put in titles in tiny raised or small-capital letters: "General Hospital ᴺᵉʷ", "ᴸᶦᵛᵉ",
     "ɴᴇᴡ", "ᴴᴰ".  Shown as they are they read oddly, so they come off the title, and "New" becomes the
     programme's NEW mark (the badge in the details).  Only runs of two or more, so a lone ₂ in "CO₂" or the ʻ in
     "Hawaiʻi" stay. */
  function tidyTitles(list) {
    var TAG = /\s*[\u02b0-\u02b8\u02e0-\u02e4\u1d00-\u1d22\u1d2c-\u1d6a\u1d9c-\u1dbf\u2070-\u209f\u0274\u0280\u029f]{2,}/g,
      TAG_NEW = /[\u1d3a\u0274\u1d0e][\u1d49\u1d31\u1d07][\u02b7\u1d42\u1d21]/,
      // Community guides (EPGTalk): emoji in front ("🏈🎓 [NCAAF] College Football"), a league in brackets,
      // and "[NEW]" or "[LIVE]" at the end.
      EMO = /(?:\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udc00-\udfff]|[\u2600-\u27bf])\ufe0f?/g,
      END = /\s*\[(new|live|premiere)\]\s*$/i, LEAD = /^\s*\[(?!(?:HD|SD|FHD|UHD|4K|CC|LIVE|NEW)\])([A-Z][A-Z0-9+&]{1,9})\]\s*/,
      QUICK = /[\u02b0-\u02e4\u1d00-\u1dbf\u2070-\u209f\u0274\u0280\u029f\ud83c-\ud83e\u2600-\u27bf\[]/;
    for (var i = 0; i < list.length; i++) {
      var p = list[i], t = p.t;
      if (!t || !QUICK.test(t)) continue;
      var c = t;
      if (TAG.test(c)) { TAG.lastIndex = 0; if (TAG_NEW.test(c)) p.n = 1; c = c.replace(TAG, ''); }
      TAG.lastIndex = 0;
      c = c.replace(EMO, ' ');
      var e = END.exec(c); if (e) { if (/new|premiere/i.test(e[1])) p.n = 1; c = c.slice(0, e.index); }
      c = c.replace(LEAD, function (a, x) { return x + ': '; });
      c = c.replace(/\s{2,}/g, ' ').trim();
      p.t = c || t;
    }
  }
  function untangle(list) {
    if (list && list.length && typeof tidyTitles === 'function') tidyTitles(list);     // (tests take untangle out on its own)
    if (!list || list.length < 2) return list;
    for (var i = 1; i < list.length; i++) if (list[i].s < list[i - 1].s) { list.sort(function (a, b) { return a.s - b.s; }); break; }   // read in the app: no positions to keep
    for (var j = 0; j < list.length - 1; j++) { var a = list[j], b = list[j + 1]; if (a.e > b.s) a.e = Math.max(a.s, b.s); }
    return list;
  }
  // pl: another playlist's guide, added beside the first playlist's (which starts everything afresh).
  function ingest(c, pl) {
    var t = Date.now(), other = pl && pl.id !== P().id ? pl.id : '', k;
    if (other) {
      findMemo = {};
      var mine = alias[other] || (alias[other] = {});
      for (k in c.map) {
        var key = !cache.has(k) || idPl[k] === other ? k : other + '|' + k;
        if (key !== k) mine[k] = key;
        cache.set(key, { at: t + 1e12, list: untangle(c.map[k]) }); idPl[key] = other;
      }
      for (k in c.icons || {}) if (!icons[k]) icons[k] = c.icons[k];
      var seenId = {}; chList.forEach(function (x) { seenId[x[0]] = 1; });
      (c.channels || []).forEach(function (x) { if (!seenId[x[0]]) chList.push(x); });
      statusOf[other] = { at: c.at || 0, sources: c.report || [] };
      if (c.matches && pl.nameMatch) Library.data.channels.forEach(function (ch) {
        if (ch.p !== other || (ch.epg && cache.has(ch.epg))) return;
        var mid = c.matches[norm(Library.name(ch))] || c.matches[norm(ch.n)];
        if (mid) matched[ch.k] = mid;
      });
      return;
    }
    cache.clear(); idPl = {}; alias = {};
    findMemo = {}; for (k in c.map) cache.set(k, { at: t + 1e12, list: untangle(c.map[k]) });   // XML data does not expire per row
    icons = c.icons || {};
    chList = c.channels || [];
    status = { at: c.at || 0, sources: c.report || [] };
    // Name matches arrive as normalised-name -> guide id; map them back onto channels.
    matched = {};
    if (c.matches && P().nameMatch) {
      Library.data.channels.forEach(function (ch) {
        if (ch.p) return;                                       // another playlist's: its own guide matches it
        if (ch.epg && cache.has(ch.epg)) return;
        var id = c.matches[norm(Library.name(ch))] || c.matches[norm(ch.n)];
        if (id) matched[ch.k] = id;
      });
    }
  }

  // Guide files whose server sends no size: remember how big each was last time, for progress.
  function sizes() { try { return JSON.parse(localStorage.getItem('tivibro.guideSizes') || '{}') || {}; } catch (e) { return {}; } }
  function rememberSizes(report) {
    var m = sizes(), n = 0;
    (report || []).forEach(function (r) { if (r.ok && r.key && r.bytes > 0) { m[r.key] = r.bytes; n++; } });
    var keys = Object.keys(m); if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(function (k) { delete m[k]; });
    if (n) try { localStorage.setItem('tivibro.guideSizes', JSON.stringify(m)); } catch (e) {}
  }
  /* Memory budget for one guide load, in characters held (see the worker).  2 GB TVs (most webOS 6
     and newer) get about 55 million, older ones less; safe mode (after the app closed during a load)
     halves it. */
  function budget(safe) {
    var t = typeof Store !== 'undefined' && Store.settings && +Store.settings.guideBudget;      // tests
    if (t) return safe ? Math.round(t / 2) : t;
    var mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0, v = Caps.probe().webos;
    var b = mem >= 8 ? 250e6 : mem >= 4 ? 140e6 : v && v <= 5 ? 30e6 : 55e6;
    return safe ? Math.round(b / 2) : b;
  }
  /* Crash-loop guard.  A load that never finishes because the app was closed under it (out of
     memory) is noted before it starts and cleared when it ends.  On the next start the same guide
     loads in safe mode; after a second such close it is paused until "Reload guide now", instead of
     closing TiviBro on every start. */
  var RUN = 'tivibro.guideRun';
  function runGet(kind) { try { var m = JSON.parse(localStorage.getItem(RUN) || '{}') || {}; return m[kind] || null; } catch (e) { return null; } }
  function runSet(kind, v) {
    try { var m = JSON.parse(localStorage.getItem(RUN) || '{}') || {}; if (v) m[kind] = v; else delete m[kind]; localStorage.setItem(RUN, JSON.stringify(m)); } catch (e) {}
  }
  var paused = null;
  function guard(kind, sig, force) {
    var prev = runGet(kind), tries = prev && prev.sig === sig ? prev.tries || 0 : 0;
    if (force) tries = 0;
    if (tries >= 2) {
      paused = { kind: kind, host: prev.host || '', at: Date.now() };
      var why = 'TiviBro closed twice while loading the guide' + (prev.host ? ' (' + prev.host + ')' : '') + ', probably out of memory.  Guide loading is paused: remove a big guide source, then use Reload guide now.';
      Log.warn('epg', why);
      setProgress({ active: false, phase: 'error', error: why, at: Date.now() });
      U.toast(why, 8000);
      return null;
    }
    if (tries === 1) Log.warn('epg', 'The last guide load did not finish (' + (prev.host || 'unknown source') + ').  Loading again with less memory.');
    runSet(kind, { sig: sig, tries: tries + 1, at: Date.now(), host: '' });
    return { safe: tries >= 1, host: function (h) { var x = runGet(kind); if (x && x.host !== h) { x.host = h; runSet(kind, x); } }, done: function () { runSet(kind, null); } };
  }
  /* ---------- big guides kept by the helper (service/guide.js) ----------
     With the network helper running, the helper downloads and reads XMLTV guides and keeps them on
     the TV's storage.  The app holds only each programme's times and title (the grid, search, the
     watchlist) and asks for a channel's descriptions when it shows them.  webOS closes an app at
     about 500 MB, which a big guide read in the app could pass (alpha 24 on a C2).  Without the
     helper, the worker above does it all in the app, within budget(). */
  var hOk = null, hMode = false, descWait = {}, descLRU = [], DESC_KEEP = 80;
  // pid: another playlist's stored guide (several playlists on); the first playlist's by default.
  function hUrl(what, kind, pid) { return 'http://127.0.0.1:' + Net.port + '/guide/' + what + '?pl=' + encodeURIComponent(pid || P().id) + '&kind=' + kind; }
  function useHelper() {
    if (!Net.active || !Net.port || (Store.settings && Store.settings.guideInApp)) return Promise.resolve(false);
    if (hOk !== null) return Promise.resolve(hOk);
    return fetch('http://127.0.0.1:' + Net.port + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { hOk = !!(j && j.guide); return hOk; }, function () { return false; });
  }
  function hStatus(kind, pid) { return fetch(hUrl('status', kind, pid), { cache: 'no-store' }).then(function (r) { return r.json(); }); }
  // A stored guide, shaped like the worker's result (times and titles, no descriptions).
  function hRead(kind, pid) {
    function get(what, json) { return fetch(hUrl(what, kind, pid), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no stored guide'); return json ? r.json() : r.text(); }); }
    return Promise.all([get('meta', true), get('titles', false)]).then(function (x) {
      var meta = x[0], text = x[1], map = {}, seen = new Map(), i = 0, n = text.length;
      while (i < n) {
        var j = text.indexOf('\n', i); if (j < 0) j = n;
        var a = text.indexOf('\t', i), b = text.indexOf('\t', a + 1), c = text.indexOf('\t', b + 1);
        if (a > i && c > 0 && c < j) {
          var d = text.indexOf('\t', c + 1), te = d > 0 && d < j ? d : j;           // after the title, maybe the guide's movie flag ("m2011")
          var id = text.slice(i, a), t = text.slice(c + 1, te), one = seen.get(t);
          if (one === undefined) { seen.set(t, t); one = t; }              // a title repeated all week is kept once
          var pg = { s: +text.slice(a + 1, b), e: +text.slice(b + 1, c), t: one };
          if (te < j) readFlag(text.slice(te + 1, j), pg);
          (map[id] || (map[id] = [])).push(pg);
        }
        i = j + 1;
      }
      meta.map = map;
      if (meta.extra) for (var k in meta.extra) if (!(k in meta)) meta[k] = meta.extra[k];
      return meta;
    });
  }
  // What the helper has stored: the full guide when its signature is sig, else just when it was made.
  function hCached(kind, sig, pid) {
    return hStatus(kind, pid).then(function (st) {
      var at = st.stored;
      if (!at) return null;
      if (at.sig !== sig) return { sig: at.sig, at: at.at };
      return hRead(kind, pid);
    }).catch(function () { return null; });
  }
  // Start a load in the helper (or follow the one already running for this guide) until it is stored.
  function hRun(kind, sig, msg, onProg, extra, pid) {
    var body = JSON.stringify({ pl: pid || P().id, kind: kind, sig: sig, msg: msg, extra: extra || null });
    return hStatus(kind, pid).catch(function () { return {}; }).then(function (st) {
      if (st.job && (st.phase === 'download' || st.phase === 'save') && st.job.sig === sig) return;   // the app restarted mid-load
      return fetch('http://127.0.0.1:' + Net.port + '/guide/load', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' } })
        .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'the helper could not load the guide'); });
    }).then(function () {
      return new Promise(function (resolve, reject) {
        var misses = 0;
        (function poll() {
          hStatus(kind, pid).then(function (st) {
            misses = 0;
            var jb = st.job || {};
            if (st.phase === 'download' || st.phase === 'save') { onProg(jb, st.phase); return setTimeout(poll, 600); }
            if (st.phase === 'stored' && st.stored && st.stored.sig === sig) return resolve(hRead(kind, pid));
            if (st.phase === 'failed') return resolve({ failed: jb.error || 'every guide file failed', report: jb.report || [], map: {}, icons: {}, channels: [], matches: {}, pubMatch: {} });
            reject(new Error(jb.error || 'the guide did not load'));
          }, function () { if (++misses > 8) reject(new Error('the network helper stopped')); else setTimeout(poll, 1000); });
        })();
      });
    });
  }
  /* A programme's description.  From the worker it is already there; from the helper it is asked for
     the first time a channel's description is shown (the grid's detail, the info panel), and the
     last DESC_KEEP channels keep theirs. */
  // A description that starts with the season and episode ("S04 E07 Love That…"): it's shown beside the
  // times already (p.ep, from the same words), so it comes off here.
  function seOff(d, p) { return p.ep && /^\s*S\d/i.test(d) ? d.replace(/^\s*S\d{1,3}\s*[.:\-]?\s*E\d{1,4}\b\s*[-:.|]?\s*/i, '') : d; }
  function desc(ch, p) {
    if (!p) return '';
    if (p.d != null || !hMode) return seOff(p.d || '', p);
    var id = ch && epgId(ch), x = id && cache.get(id);
    if (!x || descWait[id]) return '';
    descWait[id] = 1;
    fetch(hUrl('desc', PUB_ID.test(id) ? 'pub' : 'main', PUB_ID.test(id) ? '' : idPl[id]) + '&id=' + encodeURIComponent(bare(id)), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (arr) {
      var y = cache.get(id);
      if (y && y.list === x.list && Array.isArray(arr)) {
        for (var i = 0; i < x.list.length; i++) x.list[i].d = arr[i] || '';
        descLRU.push(id);
        while (descLRU.length > DESC_KEEP) { var old = cache.get(descLRU.shift()); if (old && old.list) old.list.forEach(function (q) { delete q.d; }); }
      }
      delete descWait[id];
      emit(id);
    }, function () { setTimeout(function () { delete descWait[id]; }, 30000); });
    return '';
  }

  // Keep a source failure distinct from the outcome of the public-guide pass.
  // Only say we are using public guides once there are current matching listings,
  // including a saved guide when a fresh download is unnecessary or unavailable.
  function mainGuideFailure(notice, error, report) {
    if (notice.gen != null && notice.gen !== pubGen) return;            // a newer load took over
    notice.error = error; notice.report = report || [];
    var label = notice.provider ? 'Provider guide unavailable' : 'Guide sources unavailable';
    setProgress({ active: false, phase: notice.fallback ? 'fallback' : 'error', error: error, at: Date.now(),
      message: notice.fallback ? label + '; checking public guides…' : '', report: notice.report });
    if (!notice.fallback) U.toast('Guide source failed: ' + error, 4000);
  }
  function finishGuideNotice(notice) {
    // Public guides paused after closes: guard()'s message is the one that matters, so it stays.
    if (!notice.error || !notice.fallback || paused) return;
    var available = Object.keys(pubMatched).some(function (k) { return live(pubMatched[k]); });
    var label = notice.provider ? 'Provider guide unavailable' : 'Guide sources unavailable';
    var reports = (pubStatus && pubStatus.sources || []).map(function (r) {
      return { host: r.host || r.name || 'public guide', ok: r.ok, programmes: r.programmes || 0, error: r.error || '' };
    });
    // The helper kept the guide it had: that one still works, so it isn't a failure.
    var msg = notice.kept ? (notice.provider ? 'Provider guide' : 'Guide sources') + ' could not update; using the saved guide' + (available ? ' and public guides.' : '.')
      : label + (available ? '; using public guides.' : '; public guides supplied no matching listings.');
    setProgress({ active: false, phase: available || notice.kept ? 'done' : 'error', error: notice.error, at: Date.now(),
      message: msg,
      channels: pubStatus && pubStatus.filled || 0, programmes: reports.reduce(function (a, r) { return a + r.programmes; }, 0),
      report: notice.report.concat(reports) });
  }

  /* Channels added to the list: the helper keeps programmes only for the guide ids (and, with name matching,
     the names) it was asked for, so a stored guide knows nothing of a channel added since.  What a guide was
     asked for is remembered as short hashes; a guide id or name in the list that wasn't asked for loads the
     guide again.  A channel added with an id already asked for (another copy of a channel) changes nothing,
     and neither does one taken away. */
  function wanted(pl) {
    var mine = pl.id === P().id ? '' : pl.id, days = +pl.epgDays || 1;
    var ids = {}, names = {};
    function keep(map, k, c) { var p = c.arch ? Math.min(days, +c.arch || days) : 0; if (!(k in map) || map[k] < p) map[k] = p; }
    Library.data.channels.forEach(function (c) {
      if ((c.p || '') !== mine) return;
      var m = Store.edits.epgMap[c.k];
      if (m) keep(ids, m, c);
      if (c.epg) keep(ids, c.epg, c);
      if (pl.nameMatch) { keep(names, norm(Library.name(c)), c); keep(names, norm(c.n), c); }
    });
    delete names[''];
    return { ids: ids, names: names };
  }
  function askedOf(w) { return Object.keys(w.ids).concat(Object.keys(w.names).map(function (n) { return 'n:' + n; })).map(U.hash); }
  function addedSince(a, now) {
    var had = {}, n = 0;
    a.forEach(function (h) { had[h] = 1; });
    now.forEach(function (h) { if (!had[h]) n++; });
    return n;
  }

  /* p: whose guide (the first playlist's when not given).  Another playlist's guide is added beside the
     first's (ingest), with its own crash guard ("main@<id>"). */
  function loadXml(force, notice, p) {
    p = p || P();
    var first = p.id === P().id, srcs = sources(p), pid = first ? '' : p.id, gk = first ? 'main' : 'main@' + p.id;
    var ckey = 'epg:' + p.id, akey = 'epgAsked:' + p.id;
    var sig = U.hash(JSON.stringify(srcs) + '|' + p.epgDays + '|' + p.nameMatch);
    return useHelper().then(function (h) {
      hMode = h;
      if (!h) return Store.idbGet(ckey);
      Store.idbSet(ckey, null);                                        // the helper keeps it now
      return hCached('main', sig, pid);
    }).then(function (c) {
      return Store.idbGet(akey).then(function (a) { return [c, a]; }, function () { return [c, null]; });
    }).then(function (ca) {
      var c = ca[0], a = ca[1], asked = askedOf(wanted(p)), added = 0;
      if (a && a.sig === sig && a.h) added = addedSince(a.h, asked);
      else if (c && c.sig === sig) Store.idbSet(akey, { sig: sig, h: asked });     // first time: the list as it is now
      if (added) Log.info('epg', added + ' guide id' + (added === 1 ? '' : 's') + ' or name' + (added === 1 ? '' : 's') + ' new in the channel list since the guide loaded; loading it again');
      var hours = +p.epgRefresh, age = c ? Date.now() - c.at : Infinity;
      var stale = !c || c.sig !== sig || added > 0 || (hours > 0 && age > hours * 3600e3) || (hours === -1 && !(loadXml.didStart || {})[p.id]);
      (loadXml.didStart = loadXml.didStart || {})[p.id] = true;
      if (c && c.sig === sig) { ingest(c, p); xmlReady = true; emit(null); }
      if (!stale && !force) { runSet(gk, null); return; }     // a forced reload cut short: the cache is fine
      var g = guard(gk, sig, force); if (!g) return;
      paused = null;
      return work(srcs, null, g, sig, null, p).then(function (res) {
        g.done();
        if (res.failed) {                                              // the helper kept the guide it had
          notice.kept = Object.keys(matched).length > 0;               // and it still has listings
          mainGuideFailure(notice, res.failed, (res.report || []).map(function (r) {
            return { host: r.provider ? 'provider guide' : hostOf(r.url), ok: r.ok, error: r.error || res.failed };
          }));
          return;
        }
        if (res.trimmed) {
          Log.warn('epg', 'Guide trimmed to fit this TV\'s memory: ' + res.trimmed + ' guide channels left out' + (g.safe ? ' (safe mode)' : ''));
          U.toast('The guide was too big for this TV: ' + res.trimmed + ' channels left out.  A big extra guide source is the usual cause.', 7000);
        }
        setProgress(Object.assign({}, progress, { active: true, phase: 'save' }));
        res.at = res.at || Date.now(); res.sig = sig;
        Store.idbSet(akey, { sig: sig, h: askedOf(wanted(p)) });              // what this guide was asked for
        ingest(res, p); xmlReady = true;
        if (!hMode) Store.idbSet(ckey, res);
        emit(null);
        rememberSizes(res.report);
        var bad = res.report.filter(function (r) { return !r.ok; });
        if (bad.length && bad.length === res.report.length) {
          mainGuideFailure(notice, bad[0].error, bad.map(function (r) {
            return { host: r.provider ? 'provider guide' : hostOf(r.url), ok: false, error: r.error };
          }));
          return;
        }
        if (bad.length) U.toast('Guide source failed: ' + bad[0].error, 4000);
        var progs = res.report.reduce(function (a, r) { return a + (r.programmes || 0); }, 0);
        setProgress({ active: false, phase: 'done', error: bad.length ? bad[0].error : '',
          at: Date.now(), programmes: progs, channels: Object.keys(res.map || {}).length, took: Date.now() - (progress.started || Date.now()),
          report: res.report.map(function (r) { return { host: r.provider ? 'provider guide' : hostOf(r.url), key: r.key || '', ok: r.ok, programmes: r.programmes || 0, channels: r.channels || 0, inFile: r.inFile || 0, error: r.error || '' }; }) });
      }, function (e) { g.done(); mainGuideFailure(notice, (e && e.message) || 'failed', []); throw e; });
    });
  }

  // pl: whose guide (several playlists on): only that playlist's channels are looked for.
  function work(srcs, pub, g, sig, extra, pl) {
    pl = pl || P();
    var mine = pl.id === P().id ? '' : pl.id;
    // Past programmes are only reachable on catch-up channels, so only those keep past days
    // (up to their catch-up length); the rest keep the last few hours.  On big playlists, where
    // most channels have no catch-up, this saves a large share of the TV's memory.
    var days = +pl.epgDays || 1;
    var w = pub ? { ids: {}, names: {} } : wanted(pl), ids = w.ids, names = w.names;
    var now = Date.now();
    var run = Date.now().toString(36);
    var msg = { sources: srcs.map(function (s, i) {
      // Through the helper, guides arrive already unzipped (.gz, gzip-encoded, or gzipped without saying so).
      var id = Net.active ? 'g' + run + i : '';
      var label = s.provider ? 'provider guide' : s.prefix ? s.name + ' ' + s.cc : s.url;
      return { url: Net.wrap(s.url, id ? { unzip: id } : null), xfer: id ? Net.xfer(id) : '', label: label, provider: !!s.provider, key: U.hash(s.url), known: sizes()[U.hash(s.url)] || 0, host: s.provider ? label : s.prefix ? 'public guide, ' + label : hostOf(s.url), offset: s.offset || 0,
        pub: s.prefix ? { prefix: s.prefix, cc: s.cc, name: s.name } : null };
    }),
      ids: Object.keys(ids), past: ids, names: names, from: now - days * 86400e3, recent: now - 3 * 3600e3, to: now + 2 * 86400e3,
      // webOS 4 and 5 TVs (2018 to 2020) have the least memory: shorter programme descriptions there.
      descMax: (function () { var v = Caps.probe().webos; return v && v <= 5 ? 250 : 400; })(), budget: budget(g && g.safe) * (mine ? 0.5 : 1) };      // another playlist's guide: half, beside the first's
    if (pub) { msg.pub = true; msg.pk = pub.pk; msg.pubWant = pub.want; }
    var keysFn = typeof PubEpg !== 'undefined' ? PubEpg.keys : function () { return { keys: [], country: '' }; };
    var alikeFn = typeof PubEpg !== 'undefined' && PubEpg.alike ? PubEpg.alike : function () { return false; };
    var code = 'self.norm = ' + norm.toString() + ';\nself.alike = ' + alikeFn.toString() + ';\nself.pubKeys = ' + keysFn.toString() + ';\nself.progFlag = ' + progFlag.toString() + ';\nself.readFlag = ' + readFlag.toString() + ';\n(' + workerMain.toString() + ')();';
    var started = Date.now();
    function onProg(p) { p.active = true; p.phase = 'download'; p.started = started; if (g) g.host(p.host); setProgress(p); }
    var k0 = msg.sources[0] ? msg.sources[0].known : 0;
    setProgress({ active: true, phase: 'download', src: 1, of: srcs.length, host: msg.sources[0] ? msg.sources[0].host : '', bytes: 0, total: k0 || 0, est: !!k0, programmes: 0, channels: 0, started: started });
    if (hMode) {
      // The helper reads it: relay addresses with /unz/<id>, so it unzips and counts as for the app.
      msg.sources.forEach(function (s) { var m = /\/unz\/([A-Za-z0-9_-]+)\//.exec(s.url); s.unz = m ? m[1] : ''; });
      msg.to = now + 3 * 86400e3;                                      // storage is cheap there: a day more ahead
      return hRun(pub ? 'pub' : 'main', sig, msg, function (j, phase) {
        var x = { src: j.src || 1, of: j.of || srcs.length, host: j.host || '', bytes: j.bytes || 0, total: j.total || 0, est: !!j.est, programmes: j.programmes || 0, channels: j.channels || 0 };
        if (phase === 'save') { if (g) g.host(x.host); return setProgress(Object.assign(x, { active: true, phase: 'save', started: started })); }
        onProg(x);
      }, extra, pub ? '' : mine).catch(function (e) { var m = (e && e.message) || 'the guide did not load'; return { failed: m, map: {}, icons: {}, channels: [], matches: {}, pubMatch: {}, report: [{ ok: false, error: m }] }; });
    }
    return new Promise(function (res) {
      var w, url;
      try {
        url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        w = new Worker(url);
      } catch (e) {
        // No workers available: run the same parser on the page.  Slower, but the guide still loads.
        var self_ = { postMessage: function (d) { if (d.progress) onProg(d.progress); else res(d); } };
        new Function('self', code)(self_);
        return self_.onmessage({ data: msg });
      }
      w.onmessage = function (ev) { if (ev.data && ev.data.progress) return onProg(ev.data.progress); w.terminate(); URL.revokeObjectURL(url); res(ev.data); };
      w.onerror = function (e) { w.terminate(); res({ map: {}, icons: {}, channels: [], matches: {}, report: [{ ok: false, error: e.message || 'worker failed' }] }); };
      w.postMessage(msg);
    });
  }

  var statusOf = {};             // the other playlists' guide status, by playlist id
  function init(lib, force) {
    cache.clear(); queue.length = 0; matched = {}; icons = {}; chList = []; status = { at: 0, sources: [] }; idPl = {}; alias = {}; statusOf = {};
    pubMatched = {}; pubList = []; pubStatus = null; pubGen++;
    var srcs = sources(), pub = pubOn(), gen = pubGen;
    // The other playlists that are on, with guide files of their own (several playlists on).
    var more = (Store.loaded ? Store.loaded() : []).slice(1).filter(function (p) { return sources(p).length > 0; });
    xmlMode = srcs.length > 0 || pub || more.length > 0; xmlReady = false;
    if (!xmlMode) { status.at = Date.now(); emit(null); return Promise.resolve(); }
    var first, notice = { gen: gen, fallback: pub, provider: srcs.length > 0 && srcs.every(function (s) { return !!s.provider; }) };
    if (srcs.length) first = loadXml(force, notice).catch(function () {});
    else { xmlReady = true; status.at = Date.now(); emit(null); first = Promise.resolve(); }
    // One after the other: two big guides at once could run a TV out of memory.
    more.forEach(function (p) {
      first = first.then(function () {
        if (gen !== pubGen) return;
        var note = { gen: gen, fallback: false, provider: sources(p).every(function (s) { return !!s.provider; }) };
        return loadXml(force, note, p).catch(function (e) { Log.warn('epg', 'The guide of ' + (p.name || 'another playlist') + ' did not load: ' + (e && e.message || e)); });
      });
    });
    loading = first.then(function () { return pub && gen === pubGen ? loadPub(gen).catch(function (e) { Log.warn('epg', 'Public guide failed: ' + (e && e.message || e)); }) : null; })
      .then(function () { if (gen === pubGen) finishGuideNotice(notice); loading = null; emit(null); });        // done: pages that say "loading now" redraw
    return loading;
  }

  /* ---------- public guide fill-in (pubepg.js) ---------- */
  // Several playlists on: each playlist's own Public guide fill-in switch decides for its channels;
  // the one pass uses the first playlist's countries and days.
  function pubOn() {
    if (typeof PubEpg === 'undefined' || !(Library.data && Library.data.channels.length)) return false;
    return (Store.loaded ? Store.loaded() : [P()]).some(function (p) { return PubEpg.conf(p).on; });
  }
  // Channels nothing else has a guide for.  Per-channel provider guides can't be checked ahead, so
  // a channel the provider gives a guide id to counts as covered there.
  function missing() {
    var map = Store.edits.epgMap || {}, ev = typeof Events !== 'undefined', first = PubEpg.conf(P()).on;
    return Library.data.channels.filter(function (ch) {
      if (map[ch.k] && !PUB_ID.test(map[ch.k])) return false;
      if (Library.noGuide(ch)) return false;                    // no guide wanted
      if (ch.p && !PubEpg.conf(PL(ch)).on) return false;        // its playlist has public fill-in off
      if (!ch.p && !first) return false;
      var id = own(ch, matched[ch.k] || ch.epg || '');
      if (id && live(id)) return false;
      // Per-channel provider guides can't be checked ahead, except for app channels (Pluto TV), whose
      // own guide is the better one anyway.
      if (ch.epg && shortAllowed(ch) && !(PubEpg.appId && PubEpg.appId(ch.epg))) return false;
      if (ev && Events.of(ch)) return false;
      return true;
    });
  }
  /* Sports channels that have a guide of their own (missing() has the ones without), for the sports guides:
     on with the helper, its playlist's Sports guides switch on, not pointed at a guide by hand, not an
     event channel.  At most 2,000 (a big sports playlist: your groups first, as pubPick). */
  function sportsChannels(miss) {
    if (!Net.active || !PubEpg.isSports) return [];
    var map = Store.edits.epgMap || {}, ev = typeof Events !== 'undefined', inMiss = {}, out = [], gs = {};
    miss.forEach(function (ch) { inMiss[ch.k] = 1; });
    Library.data.channels.forEach(function (ch) {
      if (inMiss[ch.k] || (map[ch.k] && !PUB_ID.test(map[ch.k])) || Library.noGuide(ch)) return;
      if (!PubEpg.sportsOn(ch.p ? PL(ch) : P()) || (ev && Events.of(ch))) return;
      if (!(ch.g in gs)) gs[ch.g] = PubEpg.isSports('', Library.groupName(ch.g));       // once per group (big playlists)
      if (gs[ch.g] || PubEpg.isSports(ch.n, '')) out.push(ch);
    });
    return out.length > 2000 ? pubPick(out).slice(0, 2000) : out;
  }
  function ingestPub(c) {
    var t = Date.now();
    findMemo = {}; for (var k in c.map) cache.set(k, { at: t + 1e12, list: untangle(c.map[k]) });
    for (var i in c.icons) if (!icons[i]) icons[i] = c.icons[i];
    pubMatched = c.pubMatch || {};
    pubList = c.channels || [];
    pubStatus = { at: c.at || 0, countries: c.countries || [], filled: Object.keys(pubMatched).length, asked: c.asked || 0, sources: c.report || [], took: c.took || 0 };
  }
  // When to look again after every public guide file failed, per playlist (the helper keeps the guide).
  function pubRetry(id, at) {
    var m = {}; try { m = JSON.parse(localStorage.getItem('tivibro.pubRetry') || '{}') || {}; } catch (e) {}
    if (id === undefined) return m;
    if (at) m[id] = at; else delete m[id];
    try { localStorage.setItem('tivibro.pubRetry', JSON.stringify(m)); } catch (e) {}
    return m;
  }
  /* At most this many channels are looked for in the public guides.  Building the list of names to look
     for costs the app memory per channel, and on a 187,000-channel playlist it came on top of a reload
     and the TV closed TiviBro (issue #24).  Your own groups and Favorites, recent channels and shown
     groups come first. */
  var PUB_MAX = 30000;
  function pubPick(miss) {
    if (miss.length <= PUB_MAX) return miss;
    var mine = {}, e = Store.edits, rank = function (c) { return mine[c.k] || (e.hiddenGroups && e.hiddenGroups[c.g] ? 3 : 2); };
    (e.recent || []).forEach(function (k) { mine[k] = 1; });
    if (Library.customGroups) Library.customGroups().forEach(function (g) { g.items.forEach(function (k) { mine[k] = 1; }); });
    var out = miss.map(function (c, i) { return { c: c, r: rank(c), i: i }; }).sort(function (a, b) { return a.r - b.r || a.i - b.i; }).slice(0, PUB_MAX).map(function (x) { return x.c; });
    Log.info('epg', 'Public guide: ' + miss.length + ' channels have no guide; looking for the first ' + PUB_MAX + ' (your groups, recent channels and shown groups first)');
    return out;
  }
  function loadPub(gen) {
    // Not while the channel list reloads: that is the TV's busiest moment (issue #24).
    var b = typeof Source !== 'undefined' && Source.busy ? Source.busy() : null;
    if (b) { Log.info('epg', 'Public guide: waiting for the channel list to finish reloading'); return b.then(function () { return gen === pubGen ? loadPub(gen) : null; }); }
    var p = P(), miss = pubPick(missing()), map = Store.edits.epgMap || {};
    var ccs = PubEpg.countriesFor(p, miss, Library.data);
    var gz = !!Net.active || typeof DecompressionStream !== 'undefined';
    var apps = PubEpg.appFiles ? PubEpg.appFiles(miss, gz) : [];
    // Sports guides: the sports channels too, guide or not, from the sports files first (helper only: the
    // files are big, and only the helper reads them as they come in).
    var sport = sportsChannels(miss), sfiles = sport.length >= 3 ? PubEpg.sportsFiles() : [];
    if (!sfiles.length) sport = [];
    var files = sfiles.concat(PubEpg.files(ccs, !!Net.active, gz), apps);
    miss = miss.concat(sport);
    var want = Object.keys(map).map(function (k) { return map[k]; }).filter(function (v) { return PUB_ID.test(v); });
    var ckey = 'epgpub:' + p.id, sig = U.hash(ccs.join() + '|' + p.epgDays + (apps.length ? '|' + apps.map(function (f) { return f.prefix; }).join() : '') + (sfiles.length ? '|sports' : '') + '|es1');
    return useHelper().then(function (h) {
      hMode = h;
      if (!h) return Store.idbGet(ckey);
      Store.idbSet(ckey, null);
      return hCached('pub', sig).then(function (c) { if (c) { var rt = pubRetry(); if (rt[p.id]) c.retry = rt[p.id]; } return c; });
    }).then(function (c) {
      if (gen !== pubGen) return;                                      // reloaded or switched off meanwhile
      if (c && c.sig === sig) { ingestPub(c); emit(null); }
      if (!files.length || !miss.length) {
        pubStatus = { at: Date.now(), countries: ccs, filled: 0, asked: miss.length, sources: [], none: !miss.length ? 'every channel has a guide' : 'no public guide for this playlist\'s countries' };
        emit(null);
        return;
      }
      // Free services: at most twice a day, however often your own guide reloads ("Reload guide now"
      // included; "Look again now" is the way to ask).  Sooner when the playlist gained channels with
      // no guide, a channel was pointed at a public guide channel, or a file failed (after an hour).
      var age = c ? Date.now() - c.at : Infinity, hours = +p.epgRefresh, every = hours === 0 ? Infinity : Math.max(12, hours > 0 ? hours : 12) * 3600e3;
      var need = want.some(function (w) { return !cache.has(w); });
      var failed = c && (c.report || []).some(function (r) { return !r.ok; });
      var stale = !c || c.sig !== sig || age > every || miss.length > (c.asked || 0) + 20 || need || (failed && age > 3600e3) || (c.retry && Date.now() > c.retry);
      var forced = pubForce;
      if (pubForce) { pubForce = false; stale = true; }
      if (!stale) { runSet('pub', null); return; }
      var pk = {}, days = +p.epgDays || 1, ctx = Tidy.make(Library.data);
      miss.forEach(function (ch) {
        // A channel with a known country only matches in that country's guides ("Mega" in a Greek
        // group is not the US Mega TV).  Regions (Latino, Ex-Yu) match anywhere.
        var pd = ch.arch ? Math.min(days, +ch.arch || days) : 0, seen = {}, cc = PubEpg.code(PubEpg.countryOf(ctx, ch));
        if (!PubEpg.supported(cc)) cc = '';
        function add(k) { if (seen[k]) return; seen[k] = 1; (pk[k] || (pk[k] = [])).push([ch.k, pd, cc]); }
        PubEpg.keys(Library.name(ch)).keys.forEach(function (x) { add(x[0]); });
        PubEpg.keys(ch.n).keys.forEach(function (x) { add(x[0]); });
        if (ch.epg) add('id:' + ch.epg);
        var aid = PubEpg.appId ? PubEpg.appId(ch.epg) : '';          // "US_5ca5…" is "5ca5…" in Pluto's own guide
        if (aid && !seen['id:' + aid]) { seen['id:' + aid] = 1; (pk['id:' + aid] || (pk['id:' + aid] = [])).push([ch.k, pd, '']); }
      });
      var started = Date.now(), g = guard('pub', sig, forced); if (!g) return;
      return work(files, { pk: pk, want: want }, g, sig, { asked: miss.length, countries: ccs }).then(function (res) {
        g.done();
        rememberSizes(res.report);
        if (gen !== pubGen) {
          // Superseded (turned off, looked again): don't leave its download showing as still running.
          if (progress.active && /^public guide/.test(progress.host || '')) setProgress({ active: false, phase: 'done', at: Date.now(), programmes: 0, channels: 0 });
          return;
        }
        // Every file failed (offline, a site down): keep what the TV had rather than an empty result.
        if (c && c.sig === sig && res.report.length && res.report.every(function (r) { return !r.ok; })) {
          c.retry = Date.now() + 3600e3;                                  // try again in an hour
          if (hMode) pubRetry(p.id, c.retry); else Store.idbSet(ckey, c);
          Log.warn('epg', 'Public guide: every file failed (' + res.report[0].error + '), keeping the last one');
          return;
        }
        res.at = res.at || Date.now(); res.sig = sig; res.asked = miss.length; res.countries = ccs; res.took = Date.now() - started;
        res.report = res.report.map(function (r) { return { url: r.url, ok: r.ok, programmes: r.programmes || 0, filled: r.filled || 0, error: r.error || '', skipped: !!r.skipped }; });
        ingestPub(res);
        if (hMode) pubRetry(p.id, 0); else Store.idbSet(ckey, res);
        emit(null);
        var filled = Object.keys(res.pubMatch || {}).length;
        Log.info('epg', 'Public guide filled ' + filled + ' of ' + miss.length + ' channels with no guide (' + ccs.join(', ') + ', ' + Math.round(res.took / 1000) + ' s)');
        setProgress({ active: false, phase: res.report.every(function (r) { return !r.ok; }) ? 'error' : 'done', at: Date.now(), programmes: res.report.reduce(function (a, r) { return a + r.programmes; }, 0),
          channels: filled, took: res.took, report: res.report.map(function (r) { return { host: 'public guide, ' + r.url, ok: r.ok, programmes: r.programmes, channels: r.filled, error: r.error }; }) });
      });
    });
  }

  /* Programmes whose title matches, for search and the watchlist.  q is text or a test function.
     Every match is gathered first (up to a safety cap) and then the useful ones kept: on now, the
     soonest to come, the latest replays.  Stopping at the first matches found would miss tonight's
     showing on a channel that happens to come late in the guide. */
  /* Programmes on between from and to on every guide channel the app holds: cb(guide key, programme).
     Lists are in start order, so each is entered by a binary search (Movies on now looks every few minutes). */
  function during(from, to, cb) {
    cache.forEach(function (v, k) {
      var l = v.list; if (!l || !l.length) return;
      var lo = 0, hi = l.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (l[mid].e <= from) lo = mid + 1; else hi = mid; }
      for (var i = lo; i < l.length && l[i].s < to; i++) if (l[i].e > from && l[i].e > l[i].s) cb(k, l[i]);
    });
  }
  function search(q, limit) {
    var test = typeof q === 'function' ? q : (function (s) { s = String(s).toLowerCase(); return function (t) { return t.toLowerCase().indexOf(s) >= 0; }; })(q);
    var out = [], CAP = 20000;
    cache.forEach(function (v, k) {
      if (out.length >= CAP || !v.list) return;
      for (var i = 0; i < v.list.length; i++) { var p = v.list[i]; if (p.t && p.e > p.s && test(p.t)) out.push({ key: k, p: p }); }
    });
    var now = Date.now(), rank = function (x) { return x.p.s <= now && x.p.e > now ? 0 : x.p.s > now ? 1 : 2; };
    out.sort(function (a, b) { var d = rank(a) - rank(b); return d || (rank(a) === 2 ? b.p.s - a.p.s : a.p.s - b.p.s); });
    return out.slice(0, limit || 60);
  }

  /* Programmes whose description has one of the words (whole words): a promise of [{ key, p, d }].  Local
     stations often call a game "NFL Football" and name the teams only in the description.  Descriptions
     the app holds (the provider's per-channel guide, a guide read in the app) are looked at here; a guide
     the helper keeps is looked through by the helper (/guide/find), which sends back where they are. */
  var findMemo = {};
  function findDesc(words, max) {
    words = (words || []).map(function (w) { return String(w).trim(); }).filter(function (w) { return w.length >= 2; });
    max = max || 500;
    if (!words.length) return Promise.resolve([]);
    var key = words.join('\n') + '|' + max, memo = findMemo[key];
    if (memo && Date.now() - memo.at < 120000) return memo.p;
    var rx = new RegExp('(^|[^a-z0-9\u00c0-\uffff])(' + words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); }).join('|') + ')(?![a-z0-9\u00c0-\uffff])', 'i');
    var out = [], have = new Map();
    function take(key, p, d) { if (!p || have.has(p) || out.length >= max) return; have.set(p, 1); out.push({ key: key, p: p, d: d }); }
    cache.forEach(function (v, k) {
      if (!v.list) return;
      for (var i = 0; i < v.list.length; i++) { var p = v.list[i]; if (p.d && rx.test(p.d)) take(k, p, p.d); }
    });
    // Each loaded playlist's stored guide, and the public one.
    var stores = [['main', ''], ['pub', '']].concat(Object.keys(statusOf).map(function (id) { return ['main', id]; }));
    var ask = !hMode ? Promise.resolve() : Promise.all(stores.map(function (st) {
      var kind = st[0];
      return fetch(hUrl('find', kind, st[1]) + '&max=' + max + '&q=' + encodeURIComponent(JSON.stringify(words)), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : []; }).then(function (arr) {
          (Array.isArray(arr) ? arr : []).forEach(function (x) {
            // Another playlist's stored guide: its id may be kept under its own key (alias).
            var key = st[1] ? (alias[st[1]] && alias[st[1]][x.id]) || (idPl[x.id] === st[1] ? x.id : '') : (idPl[x.id] ? '' : x.id);
            var c = key && cache.get(key); if (c && c.list && c.list[x.i]) take(key, c.list[x.i], x.d);
          });
        }, function () {});
    }));
    var pr = ask.then(function () { return out; });
    for (var mk in findMemo) if (Date.now() - findMemo[mk].at > 120000) delete findMemo[mk];
    findMemo[key] = { at: Date.now(), p: pr };
    return pr;
  }

  // Manual assignment: point a channel at any guide channel from the loaded sources.
  function assign(ch, id) {
    var m = Store.edits.epgMap;
    if (id) m[ch.k] = id; else delete m[ch.k];
    Store.saveEdits();
    if (id && !cache.has(id) && xmlMode) { U.toast('Loading guide for this channel'); return init(Library, !PUB_ID.test(id)); }
    emit(null);
  }

  return { _flag: { progFlag: progFlag, readFlag: readFlag },
    untangle: untangle, pubPick: function (miss) { return pubPick(miss); }, init: init, request: request, nowNext: nowNext, search: search, during: during, findDesc: findDesc, keyOf: keyOf, epgId: epgId, assign: assign, norm: norm, desc: desc,
    get inHelper() { return hMode; },
    // A channel's guide id as its own playlist's guide names it (without an alias's playlist id).
    guideId: function (ch) { var id = epgId(ch); return id ? bare(id) : ''; },
    icon: function (id) { return icons[id] || ''; },
    guideChannels: function () { return pubList.length ? chList.concat(pubList) : chList; },
    // Where a channel's guide comes from when it's the public one: { name, site } or null.
    pubSource: function (ch) { var id = ch && epgId(ch); return id && PUB_ID.test(id) && typeof PubEpg !== 'undefined' ? PubEpg.sourceOf(id) : null; },
    get pubStatus() { return pubStatus; },
    get paused() { return paused; },
    pubAgain: function () { pubForce = true; return init(Library, false); },
    // Does this guide channel have any programmes (in the days loaded)?
    hasId: function (id) { var x = id && cache.get(id); return !!(x && x.list && x.list.length); },
    hasData: function (ch) { var id = epgId(ch); return !!(id && cache.has(id)) || !!(typeof Events !== 'undefined' && Events.of(ch)); },
    onUpdate: function (fn) { listeners.push(fn); },
    refresh: function (lib, force) { return init(lib || Library, force); },
    get status() { return status; },
    // Another playlist's guide (several playlists on): when it loaded and how each file went.
    statusFor: function (id) { return statusOf[id] || null; },
    get loading() { return !!loading; },
    get progress() { return progress; },
    onProgress: function (fn) { progListeners.push(fn); },
    peek: peek,
    get xml() { return xmlMode; }
  };
})();
