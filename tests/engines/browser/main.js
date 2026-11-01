/* Electron driver: TiviBro in the Chromium of an older webOS TV.
     bash tests/engines/run.sh browser          (every engine; see run.sh)
   Electron 1.4 = Chromium 53 (webOS 4), 4.2 = 69 (webOS 5), 7.3 = 78 (webOS 6), 11.5 = 87 (webOS 22).
   Boots the app at 1920x1080 against the mock provider and the helper, then: start-up guard,
   channels, guide, remote-key navigation, a channel preview, the side menu and Settings.  Writes
   results (JSON) and screenshots to $TB_OUT.  ES5 with callbacks: Electron 1.4's main process is
   Node 6, and executeJavaScript/capturePage take callbacks there but return promises later. */
'use strict';
var electron = require('electron'), app = electron.app, BrowserWindow = electron.BrowserWindow;
var fs = require('fs'), path = require('path');
var URL = process.env.TB_APP || 'http://127.0.0.1:8079/index.html';
var OUT = process.env.TB_OUT || path.join(__dirname, 'out');
// The mock provider (tests/mock/mock_provider.js on :8077) unless TB_SETTINGS says otherwise.
var SETTINGS = process.env.TB_SETTINGS || JSON.stringify({ meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' });
var R = { engine: 'Chromium ' + process.versions.chrome, electron: process.versions.electron, steps: [], errors: [], console: [], shots: [] };
var win, wc, t0;

function both(ret, cb) { if (ret && typeof ret.then === 'function') ret.then(function (v) { cb(v); }, function (e) { cb({ __err: String(e) }); }); }
function js(code, cb) {
  var done = false;
  function fin(v) { if (!done) { done = true; cb(v); } }
  try { both(wc.executeJavaScript('(function(){try{return JSON.stringify((function(){' + code + '})());}catch(e){return JSON.stringify({__err:String(e&&e.stack||e)});}})()', false, function (v) { fin(v); }), fin); }
  catch (e) { fin(JSON.stringify({ __err: String(e) })); }
}
function val(cb) { return function (s) { var v; try { v = typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { v = { __err: 'bad result ' + s }; } cb(v); }; }
function waitFor(label, code, ms, cb) {
  var start = Date.now();
  (function poll() {
    js('return (' + code + ');', val(function (v) {
      if (v && !v.__err && v !== false) { step(label, true, Date.now() - start + ' ms'); return cb(v); }
      if (Date.now() - start > ms) { step(label, false, 'timed out after ' + ms + ' ms' + (v && v.__err ? ': ' + v.__err : '')); return cb(null); }
      setTimeout(poll, 250);
    }));
  })();
}
function step(name, ok, info) { R.steps.push({ name: name, ok: !!ok, info: info === undefined ? '' : String(info) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); }
function key(k, cb, gap) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: k });
  if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k });
  setTimeout(function () { wc.sendInputEvent({ type: 'keyUp', keyCode: k }); setTimeout(cb, gap || 300); }, 60);
}
function keys(list, cb) { var i = 0; (function n() { if (i >= list.length) return cb(); key(list[i++], n); })(); }
function shot(name, cb) {
  function save(img) { try { var f = path.join(OUT, name + '.png'); fs.writeFileSync(f, img.toPNG()); R.shots.push(f); } catch (e) { R.errors.push('screenshot ' + name + ': ' + e.message); } cb(); }
  try { both(wc.capturePage(save), save); } catch (e) { R.errors.push('capturePage: ' + e.message); cb(); }
}
function finish() {
  js('return { errs: window.__errs || [], logErr: (window.Log && Log.lines ? Log.lines(false).filter(function (l) { return /error/i.test(l); }).slice(-15) : []), ua: navigator.userAgent };', val(function (v) {
    R.errors = R.errors.concat((v && v.errs) || []);
    R.logErrors = (v && v.logErr) || [];
    R.ua = v && v.ua;
    step('no uncaught page errors', !R.errors.length, R.errors.slice(0, 3).join(' | '));
    R.ms = Date.now() - t0;
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1));
    app.quit();
  }));
}

var seq = [
  function boot(next) {
    waitFor('app started (no error screen)', 'window.__tbBooted === true || ([].slice.call(document.body.children).filter(function (e) { return e.style && e.style.zIndex === "999"; })[0] || {}).innerText', 20000, function (v) {
      if (typeof v === 'string') { step('start-up guard screen shown', false, v.slice(0, 200)); return shot('boot', finish); }
      next();
    });
  },
  function channels(next) { waitFor('channels loaded', 'window.Library && Library.count() > 0 && Library.count()', 45000, function (n) { R.channels = n; next(); }); },
  // The channel list came from the helper (service/live.js), not parsed whole in the app.
  function liveHelper(next) { waitFor('the channel list came from the helper or what it keeps', '/The helper loaded|kept from the last load/.test(Log.lines ? Log.lines(false).join("\\n") : "")', 5000, function () { next(); }); },
  function guide(next) { waitFor('guide shows programmes', '(document.body.innerText.match(/\\d:\\d\\d ?[ap]m/gi) || []).length > 6', 90000, function () { setTimeout(function () { shot('1-guide', next); }, 1500); }); },
  function xmltv(next) {
    if (!/xmltv|epgSources/.test(SETTINGS)) return next();
    waitFor('XMLTV guide parsed', 'window.Epg && Epg.guideChannels().length > 0 && !Epg.loading && Epg.guideChannels().length', 90000, function (n) { R.xmltvChannels = n; next(); });
  },
  // Movies from the helper, which keeps the full list on the TV's storage (service/vod.js), and the
  // playlist kept there too (service/kv.js).
  function movies(next) {
    if (!/xtream/.test(SETTINGS)) return next();
    js('Vod.prepare(); return 1;', val(function () {
      waitFor('movies come from the helper', 'Vod.allItems().length > 0 && (Log.lines ? Log.lines(false).join("\\n") : "").indexOf("The helper gave") >= 0 && Vod.allItems().length', 60000, function (n) { R.movies = n; next(); });
    }));
  },
  function navigate(next) {
    js('return document.activeElement && document.querySelector(".focus, .focused, [data-focus]") ? (document.querySelector(".focus, .focused, [data-focus]").textContent || "").slice(0, 40) : null;', val(function (before) {
      keys(['Down', 'Down', 'Down', 'Right', 'Right', 'Left', 'Up'], function () {
        js('return (document.querySelector(".focus, .focused, [data-focus]") || {}).textContent;', val(function (after) {
          step('remote keys move the guide focus', after && after !== before, JSON.stringify(String(before).slice(0, 30)) + ' -> ' + JSON.stringify(String(after).slice(0, 30)));
          shot('2-guide-moved', next);
        }));
      });
    }));
  },
  function preview(next) {
    js('var c = Library.find("x1") || Library.all && Library.all()[0]; Views.startChannel(c, false); return c && c.n;', val(function (n) {
      R.previewChannel = n;
      setTimeout(function () {
        js('var v = document.querySelector("video"); var ms = window.MediaSource; return { ready: v && v.readyState, t: v && v.currentTime, paused: v && v.paused, err: v && v.error && v.error.code, mse: !!ms, h264: !!(ms && ms.isTypeSupported("video/mp4; codecs=\\"avc1.64001f\\"")), aac: !!(ms && ms.isTypeSupported("audio/mp4; codecs=\\"mp4a.40.2\\"")), stats: window.Player && Player.stats, log: (Log.lines(false) || []).filter(function (l) { return /player/i.test(l); }).slice(-6) };', val(function (v) {
          R.video = v;
          step('channel preview started the player', v && (v.ready > 0 || (v.stats && v.stats.state) || (v.log && v.log.length)), JSON.stringify({ ready: v && v.ready, t: v && v.t, h264: v && v.h264, state: v && v.stats && v.stats.state }));
          shot('3-preview', next);
        }));
      }, 6000);
    }));
  },
  function sideMenu(next) {
    keys(['Escape', 'Left', 'Left', 'Left'], function () { setTimeout(function () { shot('4-menu', next); }, 600); });
  },
  function settings(next) {
    js('Views.switchTab("settings"); return Views.tab;', val(function (tab) {
      setTimeout(function () {
        keys(['Right', 'Down', 'Down', 'Down'], function () {
          js('var t = document.body.innerText; return { tab: Views.tab, visible: t.indexOf("Buffer profile") >= 0 || t.indexOf("Playlists") >= 0, text: (document.activeElement && document.activeElement.innerText || "").slice(0, 60) };', val(function (v) {
            step('settings screen opens and takes keys', v && v.tab === 'settings' && v.visible, v && JSON.stringify(v.text).slice(0, 80));
            shot('5-settings', next);
          }));
        });
      }, 800);
    }));
  },
  // Settings, Phone app: switched on, and the pairing screen with its code and QR code.
  function phone(next) {
    js('TIVIBRO_VERSION = "0.6.0-alpha.99"; Phone.turn(true).then(function () { Settings.section("phone"); }); return 1;', val(function () {
      setTimeout(function () {
        js('Phone.showPair(); return 1;', val(function () {
          setTimeout(function () {
            js('var m = document.getElementById("modal"); return { code: (m.querySelector(".pair-code") || {}).textContent, qr: !!m.querySelector(".pair-qr svg"), w: (m.querySelector(".pair-qr") || {}).offsetWidth, left: (m.querySelector(".pair-left") || {}).textContent };', val(function (v) {
              step('phone app: the pairing screen shows its code and QR code', v && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(v.code) && v.qr && v.w > 200 && /Works for/.test(v.left), JSON.stringify(v));
              shot('5-phone-pair', function () { js('UI.close(); Phone.turn(false); return 1;', val(function () { setTimeout(next, 600); })); });
            }));
          }, 2000);
        }));
      }, 1200);
    }));
  },
  // The first-run set-up tour: every step drawn and driven with the remote, the QR code drawn.
  function tour(next) {
    js('Tour.open({ first: true }); return Tour.step;', val(function (st) {
      setTimeout(function () {
        keys(['Down', 'Return'], function () {
          setTimeout(function () {
            js('return { qr: !!document.querySelector(".tour-qr svg"), w: document.querySelector(".tour-qr") ? document.querySelector(".tour-qr").offsetWidth : 0 };', val(function (q) {
              step('set-up tour: the QR code for the phone is drawn', q && q.qr && q.w > 100, JSON.stringify(q));
              shot('6-tour-phone', function () {
                keys(['Escape', 'Up', 'Return'], function () {
                  var seen = [];
                  (function walk(n) {
                    js('return Tour.step;', val(function (id) {
                      if (seen.indexOf(id) < 0) seen.push(id);
                      if (id === 'done' || n > 12) {
                        js('var t = document.getElementById("viewSetup"); var r = t.querySelector(".tour-step.on"); return { steps: [].slice.call(t.querySelectorAll(".tour-step")).length, on: r && r.innerText, chip: (t.querySelector(".tour-chip") || {}).innerText };', val(function (v) {
                          step('set-up tour: every step draws on this engine', id === 'done' && seen.length >= 6, seen.join(',') + ' ' + JSON.stringify(v));
                          shot('7-tour-summary', function () { js('Tour.keys("back"); for (var i = 0; i < 12 && Tour.isOpen && Tour.step !== "welcome"; i++) Tour.go(-1); Tour.keys("back"); return Tour.isOpen;', val(function () { next(); })); });
                        }));
                        return;
                      }
                      if (id === 'countries') shot('6-tour-countries', function () {});
                      js('Tour.go(1); return Tour.step;', val(function () { setTimeout(function () { walk(n + 1); }, 700); }));
                    }));
                  })(0);
                });
              });
            }));
          }, 2500);
        });
      }, 1500);
    }));
  }
];

app.on('ready', function () {
  try { fs.mkdirSync(OUT); } catch (e) {}
  // preload.js reads this: not every Electron passes the main process's environment on to the page.
  fs.writeFileSync(path.join(require('os').tmpdir(), 'tivibro-engines.json'), JSON.stringify({ settings: SETTINGS, relay: process.env.TB_RELAY || '47811' }));
  win = new BrowserWindow({ width: 1920, height: 1080, show: true, useContentSize: true, webPreferences: { nodeIntegration: false, contextIsolation: false, preload: path.join(__dirname, 'preload.js') } });
  wc = win.webContents;
  wc.on('console-message', function (e, level, msg) { if (level >= 2) R.console.push(String(msg).slice(0, 300)); });
  wc.on('crashed', function () { R.errors.push('renderer crashed'); finish(); });
  t0 = Date.now();
  wc.once('did-finish-load', function () {
    var i = 0;
    (function n() { if (i >= seq.length) return finish(); var f = seq[i++]; try { f(n); } catch (e) { step(f.name, false, e.message); n(); } })();
  });
  win.loadURL(URL);
  setTimeout(function () { step('whole run in time', false); finish(); }, 240000);
});
