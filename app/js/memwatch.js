/* Lists big for this TV's memory, noticed before the TV closes TiviBro (issues #114 to #116: 1 GB TVs with
   10,000 channels, four guide sources, or 41,000 movies and shows).  Every minute it weighs what TiviBro holds
   (channels, guide sources, movies and shows) against the TV's memory, and reads the browser's own memory
   gauge where the TV has one.  When it is a lot:
     - Memory-safe playback off (Automatic, on a TV with more than 1 GB): it asks once to turn it on.
     - Already on: it says once what helps most, with Settings > System > Fix a problem one press away.
   It never asks while something plays fullscreen or a menu is open, and Not now waits 30 days. */
var Memwatch = (function () {
  'use strict';
  var ASKED = 'tivibro.memAsked', WAIT = 30 * 86400e3, timer = null;

  function gb() { return (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0; }
  function asked(kind) { try { var o = JSON.parse(localStorage.getItem(ASKED) || '{}') || {}; return o[kind] && Date.now() - o[kind] < WAIT; } catch (e) { return false; } }
  function note(kind) { try { var o = JSON.parse(localStorage.getItem(ASKED) || '{}') || {}; o[kind] = Date.now(); localStorage.setItem(ASKED, JSON.stringify(o)); } catch (e) {} }

  // What TiviBro holds, and how big that is for this TV: a score where 1 is about what 1 GB can carry.
  function load() {
    var p = Store.playlist || {}, ch = typeof Library !== 'undefined' && Library.count ? Library.count() : 0;
    var guides = (p.epgSources || []).length + (p.providerEpg === 'off' ? 0 : 1), titles = typeof Vod !== 'undefined' && Vod.titleCount ? Vod.titleCount() : 0;
    var score = ch / 9000 + Math.max(0, guides - 1) * 0.3 + titles / 35000;
    var mem = gb();                                                    // 0: the TV doesn't say (an older LG): counted as 1 GB
    return { channels: ch, guides: guides, titles: titles, gb: mem, score: score / Math.max(1, mem || 1) };
  }
  // The browser's own gauge (Chromium has one, not every TV fills it in): how full the app's memory is.
  function heap() {
    var m = typeof performance !== 'undefined' && performance.memory;
    return m && m.jsHeapSizeLimit > 0 ? m.usedJSHeapSize / m.jsHeapSizeLimit : 0;
  }
  function busy() { return document.body.classList.contains('full') || (typeof UI !== 'undefined' && UI.modalOpen) || document.getElementById('viewSetup') && !document.getElementById('viewSetup').classList.contains('hidden'); }
  function what(l) {
    var out = [];
    if (l.channels >= 5000) out.push(l.channels + ' channels');
    if (l.guides >= 3) out.push(l.guides + ' guide sources');
    if (l.titles >= 15000) out.push(l.titles + ' movies and shows');
    return out.join(', ');
  }
  function check() {
    if (typeof Player === 'undefined' || typeof Store === 'undefined' || !Store.settings || busy()) return;
    var l = load(), h = heap(), big = l.score >= 1 || h >= 0.75, safe = !!Player.memSafe, mem = l.gb ? l.gb + ' GB' : 'little memory';
    if (!big) return;
    var lists = what(l);
    if (!safe && Store.settings.memSafe !== 'off' && !asked('safe')) {
      note('safe');
      Log.warn('memory', 'Lists big for this TV (' + (lists || 'memory ' + Math.round(h * 100) + '% full') + ', TV ' + mem + '): asking to turn on Memory-safe playback');
      UI.menu('Your lists are big for this TV', [
        { label: 'Turn on Memory-safe playback', sub: (lists ? lists + ' on a TV with ' + mem + '.  ' : 'This TV is running short of memory.  ') + 'It holds less video and guide in memory, so the TV is less likely to close TiviBro.', action: function () {
          Store.settings.memSafe = 'on'; Store.saveSettings(); Log.info('memory', 'Memory-safe playback turned on from the reminder'); U.toast('Memory-safe playback is on.  Settings > Playback changes it.', 5000);
        } },
        { label: 'Not now', sub: 'Settings > Playback > Memory-safe playback, any time.', current: true }
      ]);
      return;
    }
    // Already memory-safe and still a lot: the one-time pointer to what helps most.
    if (safe && (l.score >= 1.6 || h >= 0.85) && !asked('tips')) {
      note('tips');
      Log.warn('memory', 'Lists very big for this TV (' + (lists || 'memory ' + Math.round(h * 100) + '% full') + ', TV ' + mem + '), memory-safe already: showing what helps');
      UI.menu('Your lists are very big for this TV', [
        { label: 'See what helps', sub: (lists ? lists + ' on a TV with ' + mem + '.  ' : '') + 'Fewer guide sources, fewer public guide countries, and fewer days kept are what keep TiviBro open on it.', action: function () {
          Views.switchTab('settings'); Settings.open(); Settings.section('about');   // System: Fix a problem is its first row
        } },
        { label: 'Not now', current: true }
      ]);
    }
  }
  function start() { if (!timer) { timer = setInterval(function () { try { check(); } catch (e) {} }, 60000); setTimeout(function () { try { check(); } catch (e) {} }, 90000); } }
  return { start: start, check: check, load: load };
})();
