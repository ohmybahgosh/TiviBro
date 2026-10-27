/* Updates: checks GitHub releases for a newer TiviBro and, on rooted TVs with the Homebrew
   Channel, installs it in place through luna://org.webosbrew.hbchannel.service/install (the
   Homebrew Channel downloads the IPK, checks its SHA-256 and installs it).  Other TVs see the new
   version and how to install it from a computer.
   Release data comes from the GitHub API through the network helper; the IPK hash comes from the
   Homebrew manifest that every release carries (scripts/gen-manifest.js). */
var Update = (function () {
  'use strict';
  var REPO = 'ohmybahgosh/TiviBro', APP_ID = 'app.tivibro.tv';
  var API = 'https://api.github.com/repos/' + REPO + '/releases?per_page=15';
  var HBC = 'luna://org.webosbrew.hbchannel.service';
  var KEY = 'tivibro.update';
  var DAY = 24 * 3600e3;

  // state: idle | checking | current | available | installing | installed | error
  var st = { state: 'idle', latest: null, error: '', progress: 0, status: '', checked: 0, installer: null };
  var listeners = [];
  function set(p) { for (var k in p) st[k] = p[k]; listeners.forEach(function (f) { try { f(st); } catch (e) {} }); }

  /* ---------- versions ---------- */
  // "v0.6.0-alpha.3" -> { nums: [0,6,0], pre: ['alpha', 3] }; a version without a suffix is newer
  // than any of its pre-releases (0.6.0 > 0.6.0-beta.1 > 0.6.0-alpha.3 > 0.6.0-alpha.2).
  function parse(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
    if (!m) return null;
    return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map(function (x) { return /^\d+$/.test(x) ? +x : x; }) : [] };
  }
  function compare(a, b) {
    var x = parse(a), y = parse(b);
    if (!x || !y) return x ? 1 : y ? -1 : 0;
    for (var i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
    if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
    for (var j = 0; j < Math.max(x.pre.length, y.pre.length); j++) {
      var p = x.pre[j], q = y.pre[j];
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      if (p === q) continue;
      if (typeof p === 'number' && typeof q === 'number') return p > q ? 1 : -1;
      if (typeof p === 'number') return -1;
      if (typeof q === 'number') return 1;
      return p > q ? 1 : -1;
    }
    return 0;
  }
  function isPre(v) { var p = parse(v); return !!(p && p.pre.length); }
  function current() { return window.TIVIBRO_VERSION || '0.0.0'; }

  // Newest usable release from a GitHub API list: no drafts, pre-releases only when wanted, and it
  // must carry the Homebrew manifest (that is where the IPK's hash lives).
  function pick(list, wantPre) {
    var best = null;
    (list || []).forEach(function (r) {
      if (!r || r.draft || !parse(r.tag_name)) return;
      if ((r.prerelease || isPre(r.tag_name)) && !wantPre) return;
      var man = (r.assets || []).filter(function (a) { return /\.manifest\.json$/.test(a.name); })[0];
      var ipk = (r.assets || []).filter(function (a) { return /\.ipk$/.test(a.name); })[0];
      if (!man || !ipk) return;
      if (!best || compare(r.tag_name, best.tag) > 0) {
        best = { tag: r.tag_name, version: r.tag_name.replace(/^v/, ''), name: r.name || r.tag_name, pre: !!(r.prerelease || isPre(r.tag_name)),
          page: r.html_url || '', published: r.published_at || '', notes: notes(r.body), manifest: man.browser_download_url, ipkName: ipk.name, size: ipk.size || 0 };
      }
    });
    return best;
  }
  // Release notes as short plain lines for the TV: first bullets, no Markdown.
  function notes(md) {
    var out = [], stop = false;
    String(md || '').split(/\r?\n/).forEach(function (l) {
      if (/^#{1,4}\s*Install/i.test(l)) stop = true;          // the release workflow's install footer
      if (stop || out.length >= 14) return;
      var t = l.replace(/^\s*[-*]\s+/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#+\s*/, '').trim();
      if (!t || /^>/.test(t) || /^SHA-256/i.test(t)) return;
      out.push(t.length > 220 ? t.slice(0, 217) + '…' : t);
    });
    return out;
  }

  /* ---------- settings and cache ---------- */
  function S() { return Store.settings; }
  function wantPre() { var s = S(); return s.updatePre != null ? !!s.updatePre : isPre(current()); }
  function auto() { return S().updateAuto !== false; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function keep(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  /* ---------- checking ---------- */
  function check(quiet) {
    if (st.state === 'checking' || st.state === 'installing') return Promise.resolve(st);
    set({ state: 'checking', error: '' });
    return U.getJSON(API, 15000, 'releases').then(function (list) {
      if (!Array.isArray(list)) throw new Error(list && list.message ? 'GitHub said: ' + list.message : 'Unexpected answer from GitHub');
      var r = pick(list, wantPre());
      if (!r || compare(r.version, current()) <= 0) { set({ state: 'current', latest: r, checked: Date.now() }); keep({ checked: Date.now(), latest: r }); return st; }
      // The manifest holds the IPK's file name and SHA-256 for this exact build.
      return U.getJSON(r.manifest, 15000, 'release manifest').then(function (m) {
        if (!m || !m.ipkHash || !m.ipkHash.sha256) throw new Error('The release has no checksum');
        var base = r.manifest.replace(/[^/]*$/, '');
        r.ipkUrl = /^https?:/.test(m.ipkUrl) ? m.ipkUrl : base + (m.ipkUrl || r.ipkName);
        r.sha256 = m.ipkHash.sha256;
        if (m.ipkSize) r.size = m.ipkSize;
        set({ state: 'available', latest: r, checked: Date.now() });
        keep({ checked: Date.now(), latest: r });
        if (quiet) U.toast('TiviBro ' + r.version + ' is available.  Settings > Updates and about.', 7000);
        Log.info('update', 'Update available: ' + r.version + ' (running ' + current() + ')');
        return st;
      });
    }).catch(function (e) {
      var msg = String(e && e.message || e), code = e && e.status;
      if (code === 404 || /\b404\b/.test(msg)) msg = 'No public releases found (the repository may be private).';
      else if (code === 403 || /\b403\b/.test(msg)) msg = 'GitHub is limiting requests right now.  Try again in an hour.';
      Log.warn('update', 'Update check failed: ' + msg);
      set({ state: 'error', error: msg, checked: Date.now() });
      if (!quiet) U.toast('Update check failed: ' + msg, 5000);
      return st;
    });
  }
  // At start: once a day at most, quietly, well after the guide has loaded.
  function autoCheck() {
    var c = load();
    if (c && c.latest && compare(c.latest.version, current()) > 0 && c.latest.sha256) set({ state: 'available', latest: c.latest, checked: c.checked });
    if (!auto()) return;
    if (c && Date.now() - (c.checked || 0) < DAY) return;
    setTimeout(function () { check(true); }, 45000);
  }

  /* ---------- installing (rooted TVs with the Homebrew Channel) ---------- */
  function luna(uri, params, onMsg) {
    if (typeof PalmServiceBridge === 'undefined') { onMsg({ returnValue: false, errorText: 'Not running on webOS' }); return null; }
    var b = new PalmServiceBridge();
    b.onservicecallback = function (msg) { var r; try { r = JSON.parse(msg); } catch (e) { r = { returnValue: false, errorText: String(msg).slice(0, 200) }; } onMsg(r); };
    b.call(uri, JSON.stringify(params || {}));
    return b;          // keep a reference while a subscription runs, or it is cancelled
  }
  // Is the Homebrew Channel service there?  Any answer but "does not exist" means yes.
  var probe = null;
  function installer() {
    if (probe) return probe;
    probe = new Promise(function (res) {
      var done = false, t = setTimeout(function () { finish(false, 'no answer'); }, 4000);
      function finish(ok, why) { if (done) return; done = true; clearTimeout(t); set({ installer: ok ? 'hbchannel' : '' , installerWhy: why || '' }); res(ok); }
      luna(HBC + '/getAppInfo', { id: APP_ID }, function (r) {
        var txt = String(r.errorText || '');
        if (r.returnValue !== false || !/does not exist|not found|Unknown service|Denied/i.test(txt)) finish(true);
        else finish(false, txt);
      });
    });
    return probe;
  }
  var job = null;
  function install() {
    var r = st.latest;
    if (!r || !r.ipkUrl || !r.sha256) return Promise.reject(new Error('Check for updates first.'));
    return installer().then(function (ok) {
      if (!ok) throw new Error('Installing from the TV needs a rooted TV with the Homebrew Channel.');
      set({ state: 'installing', progress: 0, status: 'Starting…', error: '' });
      Log.info('update', 'Installing ' + r.version + ' from ' + r.ipkUrl);
      return new Promise(function (res, rej) {
        job = luna(HBC + '/install', { ipkUrl: r.ipkUrl, ipkHash: r.sha256, subscribe: true }, function (m) {
          if (m.returnValue === false) {
            job = null;
            var e = new Error(m.errorText || 'The Homebrew Channel could not install it.');
            Log.error('update', 'Install failed: ' + e.message);
            set({ state: 'error', error: e.message });
            return rej(e);
          }
          if (m.statusText || m.progress != null) set({ status: m.statusText || st.status, progress: m.progress != null ? +m.progress : st.progress });
          if (m.finished) {
            job = null;
            set({ state: 'installed', status: 'Installed', progress: 100 });
            Log.info('update', 'Installed ' + r.version + '; restarting');
            keep({ checked: 0, latest: null });
            // The new files are on disk; reloading the page starts the new version.
            setTimeout(function () { location.reload(); }, 2500);
            res(st);
          }
        });
      });
    });
  }

  function describe() {
    var r = st.latest;
    switch (st.state) {
      case 'checking': return 'Checking…';
      case 'current': return 'Up to date' + (r && compare(r.version, current()) < 0 ? '  (newest release is ' + r.version + ')' : '');
      case 'available': return r.version + ' is available' + (r.pre ? ' (test version)' : '');
      case 'installing': return 'Installing ' + (r ? r.version : '') + '…  ' + (st.status || '') + (st.progress ? '  ' + Math.round(st.progress) + '%' : '');
      case 'installed': return 'Installed.  Restarting…';
      case 'error': return st.error;
      default: return 'Not checked yet';
    }
  }

  return {
    check: check, autoCheck: autoCheck, install: install, installer: installer, describe: describe,
    onChange: function (f) { listeners.push(f); }, get state() { return st; }, get current() { return current(); },
    get wantPre() { return wantPre(); }, REPO: REPO, isPre: isPre,
    _test: { parse: parse, compare: compare, pick: pick, notes: notes, isPre: isPre }
  };
})();
