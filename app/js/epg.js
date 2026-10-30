/* Program guide, built so the UI thread never parses anything large.

   Sources, per playlist (Settings > Playlists > the playlist > Guide sources):
   - Your XMLTV addresses, in priority order, each with its own time offset.
   - The provider's guide: for Xtream either per-channel ("short", fast and light) or the
     full XMLTV file; for M3U the address inside the playlist.
   XMLTV is streamed and parsed in a Web Worker, trimmed to a time window and to channels
   that exist in the playlist, then cached in IndexedDB.  Channels are linked to guide data
   by their guide id, by a manual assignment, or (optionally) by matching names.
   Xtream channels the XMLTV doesn't cover still get the per-channel guide.
   Channels still without a guide after all that are looked up in a free public guide (pubepg.js),
   in a second, separate pass, so your own guide is on screen first. */
var Epg = (function () {
  'use strict';

  var cache = new Map();        // guide key -> { at, list:[{s,e,t,d}] }
  var listeners = [];
  var queue = [], inflight = 0, MAX = 3, TTL = 20 * 60 * 1000;
  var xmlMode = false, xmlReady = false, icons = {}, matched = {}, chList = [], status = { at: 0, sources: [] };
  // Public guide fill-in: channel key -> guide id ("epgpw:US/464745"), its guide channels, how it went.
  var pubMatched = {}, pubList = [], pubStatus = null, pubForce = false, PUB_ID = /^\w+:[A-Z]{2}\//;
  var loading = null;
  // Live progress of a full guide download, for the TV chip and the web editor.
  var progress = { active: false }, progListeners = [];
  function setProgress(p) {
    progress = p;
    for (var i = 0; i < progListeners.length; i++) { try { progListeners[i](p); } catch (e) {} }
    chip(p);
  }
  function hostOf(u) { var m = /^(?:https?:\/\/)?(?:[^@/]*@)?([^/:?#]+)/i.exec(u || ''); return m ? m[1] : 'guide'; }
  function mb(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; }
  // Small corner chip on the TV while a big guide loads, so nothing looks frozen.
  function chip(p) {
    var el = document.getElementById('epgProg'); if (!el) return;
    if (!p.active) {
      if (p.phase === 'error') { el.textContent = 'Guide did not load: ' + (p.error || 'error'); el.className = 'epgprog bad'; }
      else if (p.phase === 'done') { el.textContent = 'Guide loaded'; el.className = 'epgprog ok'; }
      clearTimeout(chip.t); chip.t = setTimeout(function () { el.className = 'epgprog hidden'; }, 3500);
      return;
    }
    clearTimeout(chip.t);
    var pct = p.total ? Math.min(99, Math.floor(100 * p.bytes / p.total)) : -1;
    el.className = 'epgprog';
    el.innerHTML = '<b>Loading guide' + (p.of > 1 ? ' ' + p.src + '/' + p.of : '') + '</b> ' +
      (p.phase === 'save' ? 'saving…' : pct >= 0 ? pct + '%' : mb(p.bytes || 0)) +
      '<i style="width:' + (pct >= 0 ? pct : 100) + '%"' + (pct < 0 ? ' class="indet"' : '') + '></i>';
  }

  // Same normaliser in the page and in the worker (injected as source).
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|raw|east|west|backup|us|usa|uk|ca)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  }

  function P() { return Store.playlist; }
  function epgId(ch) {
    var m = Store.edits.epgMap && Store.edits.epgMap[ch.k];
    if (m) return m;
    var id = matched[ch.k] || ch.epg || '';
    // The public guide only stands in where your sources and the provider's have nothing.
    if (pubMatched[ch.k] && !(id && cache.has(id))) return pubMatched[ch.k];
    return id;
  }
  // Guide data for a channel lives under its XMLTV id when the XMLTV has it, otherwise under the channel key.
  function keyOf(ch) {
    if (xmlMode) { var id = epgId(ch); if (id && cache.has(id)) return id; }
    return ch.k;
  }
  function emit(k) { for (var i = 0; i < listeners.length; i++) listeners[i](k); }
  function shortAllowed() { var p = P(); return p.type === 'xtream' && p.providerEpg === 'short'; }

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
    var k = ch.k, off = (+P().epgOffset || 0) * 60000;
    return U.getJSON(Source.shortEpgUrl(ch, 10), 12000).then(function (r) {
      var arr = (r && r.epg_listings) || [];
      var list = arr.map(function (p) {
        var s = +p.start_timestamp ? +p.start_timestamp * 1000 : Date.parse((p.start || '').replace(' ', 'T') + 'Z');
        var e = +p.stop_timestamp ? +p.stop_timestamp * 1000 : Date.parse((p.end || p.stop || '').replace(' ', 'T') + 'Z');
        return { s: s + off, e: e + off, t: U.b64utf8(p.title), d: U.b64utf8(p.description) };
      }).filter(function (p) { return p.e > p.s && isFinite(p.s); }).sort(function (a, b) { return a.s - b.s; });
      cache.set(k, { at: Date.now(), list: list });
      emit(k);
    }).catch(function () { cache.set(k, { at: Date.now() - TTL + 60000, list: [] }); });
  }

  /* Event channels (events.js): when the guide has nothing for a channel whose name carries the
     event and its time, the guide shows that event at its time instead. */
  function request(ch) {
    var list = guideFor(ch);
    if (list && list.length) return list;
    var ev = ch && typeof Events !== 'undefined' ? Events.of(ch) : null;
    return ev ? Events.programmes(ev) : list;
  }
  function guideFor(ch) {
    if (!ch) return null;
    if (xmlMode) {
      var id = epgId(ch);
      var x = id && cache.get(id);
      if (x) return x.list;
      if (!shortAllowed()) return xmlReady ? [] : null;
    } else if (!shortAllowed()) return [];
    var k = ch.k, hit = cache.get(k);
    if (hit && !hit.pending && Date.now() - hit.at < TTL) return hit.list;
    if (!hit || !hit.pending) {
      cache.set(k, { at: hit ? hit.at : 0, list: hit ? hit.list : [], pending: true });
      queue.push({ ch: ch, t: Date.now() });
      if (queue.length > 60) queue.splice(0, queue.length - 60);
      pump();
    }
    return hit ? hit.list : null;
  }

  function nowNext(ch) {
    var list = request(ch);
    if (!list) return null;
    var t = Date.now(), now = null, next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].s <= t && list[i].e > t) { now = list[i]; next = list[i + 1] || null; break; }
      if (list[i].s > t) { next = list[i]; break; }
    }
    return { now: now, next: next };
  }

  /* ---------- XMLTV worker ---------- */
  function workerMain() {
    /* NORM */
    /* PUBKEYS */
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
    self.onmessage = function (ev) {
      var d = ev.data, want = {}, names = d.names || {}, from = d.from, to = d.to, past = d.past || {}, recent = d.recent || from, descMax = d.descMax || 400;
      d.ids.forEach(function (i) { want[i] = 1; });
      // Earliest programme end worth keeping for a guide id: its catch-up days, or the last few hours.
      var since = {};
      function sinceOf(id) { var v = since[id]; if (v === undefined) v = since[id] = past[id] ? Math.max(from, Date.now() - past[id] * 86400e3) : recent; return v; }
      var out = {}, icons = {}, chans = [], matches = {}, report = [], total = 0, lastPost = 0;
      // Public guide pass: pk maps matching keys to [channel key, past days] for the channels with no
      // guide.  Each guide channel's keys are looked up there; a channel takes its best-ranked match
      // within a source, and a channel matched by one source is not looked up in the next.
      var pk = d.pk || {}, best = {}, claimed = {}, pubMatch = {}, pubWant = {};
      (d.pubWant || []).forEach(function (i) { pubWant[i] = 1; });
      function tell(i, src, bytes, size, force) {
        var t = Date.now();
        if (!force && t - lastPost < 400) return;
        lastPost = t;
        self.postMessage({ progress: { src: i + 1, of: d.sources.length, host: src.host, bytes: bytes, total: size, programmes: total, channels: chans.length } });
      }
      function one(src, i) {
        var got = {}, buf = '', n = 0, off = (+src.offset || 0) * 60000, P = src.pub, wantP = {};
        var RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
        var CH = /<channel\b[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
        function eat(final) {
          CH.lastIndex = 0;
          var c, lastC = 0;
          while ((c = CH.exec(buf))) {
            lastC = CH.lastIndex;
            var id = unesc(c[1]);
            var dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/.exec(c[2]);
            var name = dn ? unesc(dn[1]).trim() : id;
            if (chans.length < 30000) chans.push([id, name]);
            if (P) {
              var pid = P.prefix + id;
              if (chans.length < 30000) chans.push([pid, name]);
              if (pubWant[pid]) wantP[id] = 1;
              var kk = pubKeys(name, id), pc = kk.country === 'UK' ? 'GB' : kk.country;
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
            var nk = norm(name);
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
            if (out[ch] && !got[ch]) continue;                            // a higher-priority source already has this channel
            var s = ts((/start="([^"]*)"/.exec(a) || [])[1]) + off, e = ts((/stop="([^"]*)"/.exec(a) || [])[1]) + off;
            if (!s || !e || e < sinceOf(ch) || s > to) continue;
            var t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
            var de = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
            got[ch] = 1;
            (out[ch] || (out[ch] = [])).push({ s: s, e: e, t: t ? unesc(t[1]) : '', d: de ? unesc(de[1]).slice(0, descMax) : '' });
            n++; total++;
          }
          buf = final ? '' : buf.slice(last);
          if (buf.length > 4e6) buf = buf.slice(-1e6);
        }
        var poll = 0;
        return fetch(src.url, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var unzipped = !!r.headers.get('x-unzipped');                 // the helper did it
          var gz = !src.xfer && /\.gz($|\?)/.test(src.url);              // direct connection: unzip here
          if (gz && typeof DecompressionStream === 'undefined') { try { r.body.cancel(); } catch (e) {} throw new Error('This TV can only read .gz guides through the network helper.  Set Settings > Playback > Network to Automatic, or use the plain .xml address.'); }
          var size = +(r.headers.get('x-raw-length') || r.headers.get('content-length')) || 0, bytes = 0, raw = r.body;
          // Unzipped by the helper: progress counts the zipped bytes it has downloaded, not the XML.
          if (unzipped) poll = setInterval(function () {
            fetch(src.xfer, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (x) { if (x && x.raw) { if (x.total) size = x.total; tell(i, src, x.raw, size); } }, function () {});
          }, 500);
          // Count bytes as they arrive (before unzipping) so the TV and the editor can show real progress.
          try {
            if (!unzipped) raw = r.body.pipeThrough(new TransformStream({ transform: function (chunk, ctl) { bytes += chunk.length; tell(i, src, bytes, size); ctl.enqueue(chunk); } }));
          } catch (e) { raw = r.body; }
          tell(i, src, 0, size, true);
          var body = gz ? raw.pipeThrough(new DecompressionStream('gzip')) : raw;
          var reader = body.getReader(), dec = new TextDecoder('utf-8');
          function step() {
            return reader.read().then(function (x) {
              if (x.done) { buf += dec.decode(); eat(true); if (unzipped && size) tell(i, src, size, size, true); return; }
              if (raw === r.body && !unzipped) { bytes += x.value.length; tell(i, src, bytes, size); }
              buf += dec.decode(x.value, { stream: true });
              if (buf.length > 512 * 1024) eat(false);
              return step();
            });
          }
          return step();
        }).then(function () { if (poll) { clearInterval(poll); poll = 0; } report.push({ url: src.label || src.url, ok: true, programmes: n, channels: Object.keys(got).length, filled: settle() }); },
          function (e) { clearInterval(poll); report.push({ url: src.label || src.url, ok: false, error: String(e && e.message || e), filled: settle() }); });
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
        self.postMessage({ map: out, icons: icons, channels: chans, matches: matches, report: report, pubMatch: pubMatch });
      });
    };
  }

  function sources() {
    var p = P(), list = (p.epgSources || []).filter(function (s) { return s && s.url; }).map(function (s) { return { url: s.url.trim(), offset: +s.offset || 0 }; });
    if (p.providerEpg === 'xmltv') {
      var prov = Library.data.epgUrl;
      if (prov) list.push({ url: prov, offset: +p.epgOffset || 0, provider: true });
    }
    return list;
  }

  function ingest(c) {
    var t = Date.now();
    cache.clear();
    for (var k in c.map) cache.set(k, { at: t + 1e12, list: c.map[k] });   // XML data does not expire per row
    icons = c.icons || {};
    chList = c.channels || [];
    status = { at: c.at || 0, sources: c.report || [] };
    // Name matches arrive as normalised-name -> guide id; map them back onto channels.
    matched = {};
    if (c.matches && P().nameMatch) {
      Library.data.channels.forEach(function (ch) {
        if (ch.epg && cache.has(ch.epg)) return;
        var id = c.matches[norm(Library.name(ch))] || c.matches[norm(ch.n)];
        if (id) matched[ch.k] = id;
      });
    }
  }

  function loadXml(force) {
    var p = P(), srcs = sources();
    var ckey = 'epg:' + p.id;
    var sig = U.hash(JSON.stringify(srcs) + '|' + p.epgDays + '|' + p.nameMatch);
    return Store.idbGet(ckey).then(function (c) {
      var hours = +p.epgRefresh, age = c ? Date.now() - c.at : Infinity;
      var stale = !c || c.sig !== sig || (hours > 0 && age > hours * 3600e3) || (hours === -1 && !loadXml.didStart);
      loadXml.didStart = true;
      if (c && c.sig === sig) { ingest(c); xmlReady = true; emit(null); }
      if (!stale && !force) return;
      return work(srcs).then(function (res) {
        setProgress(Object.assign({}, progress, { active: true, phase: 'save' }));
        res.at = Date.now(); res.sig = sig;
        ingest(res); xmlReady = true;
        Store.idbSet(ckey, res);
        emit(null);
        var bad = res.report.filter(function (r) { return !r.ok; });
        if (bad.length) U.toast('Guide source failed: ' + bad[0].error, 4000);
        var progs = res.report.reduce(function (a, r) { return a + (r.programmes || 0); }, 0);
        setProgress({ active: false, phase: bad.length && bad.length === res.report.length ? 'error' : 'done', error: bad.length ? bad[0].error : '',
          at: Date.now(), programmes: progs, channels: Object.keys(res.map || {}).length, took: Date.now() - (progress.started || Date.now()),
          report: res.report.map(function (r) { return { host: r.provider ? 'provider guide' : hostOf(r.url), ok: r.ok, programmes: r.programmes || 0, channels: r.channels || 0, error: r.error || '' }; }) });
      }, function (e) { setProgress({ active: false, phase: 'error', error: (e && e.message) || 'failed', at: Date.now() }); throw e; });
    });
  }

  function work(srcs, pub) {
    // Past programmes are only reachable on catch-up channels, so only those keep past days
    // (up to their catch-up length); the rest keep the last few hours.  On big playlists, where
    // most channels have no catch-up, this saves a large share of the TV's memory.
    var days = +P().epgDays || 1;
    var ids = {}, names = {};
    function keep(map, k, c) { var p = c.arch ? Math.min(days, +c.arch || days) : 0; if (!(k in map) || map[k] < p) map[k] = p; }
    if (!pub) Library.data.channels.forEach(function (c) {
      var m = Store.edits.epgMap[c.k];
      if (m) keep(ids, m, c);
      if (c.epg) keep(ids, c.epg, c);
      if (P().nameMatch) { keep(names, norm(Library.name(c)), c); keep(names, norm(c.n), c); }
    });
    delete names[''];
    var now = Date.now();
    var run = Date.now().toString(36);
    var msg = { sources: srcs.map(function (s, i) {
      // Through the helper, guides arrive already unzipped (.gz, gzip-encoded, or gzipped without saying so).
      var id = Net.active ? 'g' + run + i : '';
      var label = s.provider ? 'provider guide' : s.prefix ? s.name + ' ' + s.cc : s.url;
      return { url: Net.wrap(s.url, id ? { unzip: id } : null), xfer: id ? Net.xfer(id) : '', label: label, host: s.provider ? label : s.prefix ? 'public guide, ' + label : hostOf(s.url), offset: s.offset || 0,
        pub: s.prefix ? { prefix: s.prefix, cc: s.cc, name: s.name } : null };
    }),
      ids: Object.keys(ids), past: ids, names: names, from: now - days * 86400e3, recent: now - 3 * 3600e3, to: now + 2 * 86400e3,
      // webOS 4 and 5 TVs (2018 to 2020) have the least memory: shorter programme descriptions there.
      descMax: (function () { var v = Caps.probe().webos; return v && v <= 5 ? 250 : 400; })() };
    if (pub) { msg.pub = true; msg.pk = pub.pk; msg.pubWant = pub.want; }
    var keysSrc = typeof PubEpg !== 'undefined' ? 'var pubKeys = ' + PubEpg.keys.toString() + ';' : 'function pubKeys() { return { keys: [], country: \'\' }; }';
    var code = '(' + workerMain.toString().replace('/* NORM */', function () { return norm.toString(); }).replace('/* PUBKEYS */', function () { return keysSrc; }) + ')()';
    var started = Date.now();
    function onProg(p) { p.active = true; p.phase = 'download'; p.started = started; setProgress(p); }
    setProgress({ active: true, phase: 'download', src: 1, of: srcs.length, host: msg.sources[0] ? msg.sources[0].host : '', bytes: 0, total: 0, programmes: 0, channels: 0, started: started });
    return new Promise(function (res) {
      var w, url;
      try {
        url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        w = new Worker(url);
      } catch (e) {
        // No workers available: run the same parser on the page.  Slower, but the guide still loads.
        var self_ = { postMessage: function (d) { if (d.progress) onProg(d.progress); else res(d); } };
        new Function('self', code.replace(/^\(/, '').replace(/\)\(\)$/, '').replace(/^function workerMain\(\) \{/, '').replace(/\}$/, ''))(self_);
        return self_.onmessage({ data: msg });
      }
      w.onmessage = function (ev) { if (ev.data && ev.data.progress) return onProg(ev.data.progress); w.terminate(); URL.revokeObjectURL(url); res(ev.data); };
      w.onerror = function (e) { w.terminate(); res({ map: {}, icons: {}, channels: [], matches: {}, report: [{ ok: false, error: e.message || 'worker failed' }] }); };
      w.postMessage(msg);
    });
  }

  function init(lib, force) {
    cache.clear(); queue.length = 0; matched = {}; icons = {}; chList = []; status = { at: 0, sources: [] };
    pubMatched = {}; pubList = []; pubStatus = null;
    var srcs = sources(), pub = pubOn();
    xmlMode = srcs.length > 0 || pub; xmlReady = false;
    if (!xmlMode) { status.at = Date.now(); emit(null); return Promise.resolve(); }
    var first;
    if (srcs.length) first = loadXml(force).catch(function () {});
    else { xmlReady = true; status.at = Date.now(); emit(null); first = Promise.resolve(); }
    loading = first.then(function () { return pub ? loadPub(force).catch(function (e) { Log.warn('epg', 'Public guide failed: ' + (e && e.message || e)); }) : null; })
      .then(function () { loading = null; });
    return loading;
  }

  /* ---------- public guide fill-in (pubepg.js) ---------- */
  function pubOn() { return typeof PubEpg !== 'undefined' && PubEpg.conf(P()).on && !!(Library.data && Library.data.channels.length); }
  // Channels nothing else has a guide for.  Per-channel provider guides can't be checked ahead, so
  // a channel the provider gives a guide id to counts as covered there.
  function missing() {
    var map = Store.edits.epgMap || {}, short = shortAllowed(), ev = typeof Events !== 'undefined';
    return Library.data.channels.filter(function (ch) {
      if (map[ch.k] && !PUB_ID.test(map[ch.k])) return false;
      var id = matched[ch.k] || ch.epg || '';
      if (id && cache.has(id)) return false;
      if (short && ch.epg) return false;
      if (ev && Events.of(ch)) return false;
      return true;
    });
  }
  function ingestPub(c) {
    var t = Date.now();
    for (var k in c.map) cache.set(k, { at: t + 1e12, list: c.map[k] });
    for (var i in c.icons) if (!icons[i]) icons[i] = c.icons[i];
    pubMatched = c.pubMatch || {};
    pubList = c.channels || [];
    pubStatus = { at: c.at || 0, countries: c.countries || [], filled: Object.keys(pubMatched).length, asked: c.asked || 0, sources: c.report || [], took: c.took || 0 };
  }
  function loadPub(force) {
    var p = P(), miss = missing(), map = Store.edits.epgMap || {};
    var ccs = PubEpg.countriesFor(p, miss, Library.data);
    var gz = !!Net.active || typeof DecompressionStream !== 'undefined';
    var files = PubEpg.files(ccs, !!Net.active, gz);
    var want = Object.keys(map).map(function (k) { return map[k]; }).filter(function (v) { return PUB_ID.test(v); });
    var ckey = 'epgpub:' + p.id, sig = U.hash(ccs.join() + '|' + p.epgDays);
    return Store.idbGet(ckey).then(function (c) {
      if (c && c.sig === sig) { ingestPub(c); emit(null); }
      if (!files.length || !miss.length) {
        pubStatus = { at: Date.now(), countries: ccs, filled: 0, asked: miss.length, sources: [], none: !miss.length ? 'every channel has a guide' : 'no public guide for this playlist\'s countries' };
        return;
      }
      // Free services: at most twice a day, however often your own guide reloads.  Sooner when the
      // playlist gained channels with no guide, or a channel was pointed at a public guide channel.
      var age = c ? Date.now() - c.at : Infinity, hours = +p.epgRefresh, every = hours === 0 ? Infinity : Math.max(12, hours > 0 ? hours : 12) * 3600e3;
      var need = want.some(function (w) { return !cache.has(w); });
      var stale = !c || c.sig !== sig || age > every || miss.length > (c.asked || 0) + 20 || need;
      if (pubForce) { pubForce = false; stale = true; }
      if (!stale && !(force && age > 3600e3)) return;
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
      });
      var started = Date.now();
      return work(files, { pk: pk, want: want }).then(function (res) {
        res.at = Date.now(); res.sig = sig; res.asked = miss.length; res.countries = ccs; res.took = res.at - started;
        res.report = res.report.map(function (r) { return { url: r.url, ok: r.ok, programmes: r.programmes || 0, filled: r.filled || 0, error: r.error || '', skipped: !!r.skipped }; });
        ingestPub(res);
        Store.idbSet(ckey, res);
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
  function search(q, limit) {
    var test = typeof q === 'function' ? q : (function (s) { s = String(s).toLowerCase(); return function (t) { return t.toLowerCase().indexOf(s) >= 0; }; })(q);
    var out = [], CAP = 20000;
    cache.forEach(function (v, k) {
      if (out.length >= CAP || !v.list) return;
      for (var i = 0; i < v.list.length; i++) { var p = v.list[i]; if (p.t && test(p.t)) out.push({ key: k, p: p }); }
    });
    var now = Date.now(), rank = function (x) { return x.p.s <= now && x.p.e > now ? 0 : x.p.s > now ? 1 : 2; };
    out.sort(function (a, b) { var d = rank(a) - rank(b); return d || (rank(a) === 2 ? b.p.s - a.p.s : a.p.s - b.p.s); });
    return out.slice(0, limit || 60);
  }

  // Manual assignment: point a channel at any guide channel from the loaded sources.
  function assign(ch, id) {
    var m = Store.edits.epgMap;
    if (id) m[ch.k] = id; else delete m[ch.k];
    Store.saveEdits();
    if (id && !cache.has(id) && xmlMode) { U.toast('Loading guide for this channel'); return init(Library, !PUB_ID.test(id)); }
    emit(null);
  }

  return {
    init: init, request: request, nowNext: nowNext, search: search, keyOf: keyOf, epgId: epgId, assign: assign, norm: norm,
    icon: function (id) { return icons[id] || ''; },
    guideChannels: function () { return pubList.length ? chList.concat(pubList) : chList; },
    // Where a channel's guide comes from when it's the public one: { name, site } or null.
    pubSource: function (ch) { var id = ch && epgId(ch); return id && PUB_ID.test(id) && typeof PubEpg !== 'undefined' ? PubEpg.sourceOf(id) : null; },
    get pubStatus() { return pubStatus; },
    pubAgain: function () { pubForce = true; return init(Library, false); },
    hasData: function (ch) { var id = epgId(ch); return !!(id && cache.has(id)) || !!(typeof Events !== 'undefined' && Events.of(ch)); },
    onUpdate: function (fn) { listeners.push(fn); },
    refresh: function (lib, force) { return init(lib || Library, force); },
    get status() { return status; },
    get loading() { return !!loading; },
    get progress() { return progress; },
    onProgress: function (fn) { progListeners.push(fn); },
    get xml() { return xmlMode; }
  };
})();
