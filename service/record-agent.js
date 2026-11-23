/* The recording agent: record.js run as root outside webOS's developer-mode jail, so it can reach USB drives
   (/tmp/usb), which the jailed helper can't.  Started by the helper through the Homebrew Channel's root exec on a
   rooted TV; listens on 127.0.0.1:47820 only, with TiviBro's secret (TIVIBRO_REC_CTL) for everything but a
   recording's file.  Keeps its own list (root-owned, apart from the helper's storage).  Exits if it can't listen
   (one is running already).  Plain ES5 for Node 0.12. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var DIR = '/media/developer/.tivibro-rec';
try { fs.mkdirSync(DIR); } catch (e) {}
process.env.TIVIBRO_REC_AGENT = '1';
process.env.TIVIBRO_REC_LIST = process.env.TIVIBRO_REC_LIST || path.join(DIR, 'recordings.json');
var Record = require('./record');
// Its own copy of the program for Windows shares (recording to one), so root never writes into the helper's folder.
require('./smb').binDir(path.join(DIR, 'bin'));
var CTL = process.env.TIVIBRO_REC_CTL || '', LOG = path.join(DIR, 'agent.log');
// The secret, compared in constant time (a byte-by-byte compare that stops early tells a guesser how far it got).
function sameText(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!b || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function log(o) { o.t = Date.now(); try { fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); } catch (e) {} }
var server = http.createServer(function (req, res) {
  var file = req.url.indexOf('/record/file/') === 0 || (req.url.indexOf('/record/ts/') === 0 && req.method !== 'POST');
  // Everything but a recording's file needs the secret; an agent started without one answers nothing else.
  if (!file && !sameText(req.headers['x-tivibro-ctl'], CTL)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"not allowed","code":"ctl"}'); }
  Record.handle(req, res, {}, log);
});
server.on('error', function (e) { log({ lv: 'error', event: 'agent listen failed', e: e.code }); process.exit(0); });
server.listen(+(process.env.TIVIBRO_REC_AGENT_PORT || 47820), '127.0.0.1', function () {
  try { fs.writeFileSync(path.join(DIR, 'agent.pid'), String(process.pid)); } catch (e) {}
  log({ lv: 'info', event: 'agent listening' }); Record.start({ log: log });
});
/* The helper, kept up for the phone app (the phone used to say "TiviBro's connection starting" for good).  Installing a
   new TiviBro stops the helper and clears the wake-ups it sets with webOS, and nothing starts it again until TiviBro
   is opened.  This agent runs as root the whole time (rooted TVs): once a minute, with the phone app connection
   switched on and nothing answering on its port, it asks webOS to start the helper (its "wake" method). */
var SVC_DIR = __dirname;
function helperUp(port, cb) {
  var done = false, s = require('net').connect(port, '127.0.0.1');
  function end(v) { if (done) return; done = true; try { s.destroy(); } catch (e) {} cb(v); }
  s.on('connect', function () { end(true); }); s.on('error', function () { end(false); }); s.setTimeout(3000, function () { end(false); });
}
var wokeAt = 0;
setInterval(function () {
  var c = null; try { c = JSON.parse(fs.readFileSync(path.join(SVC_DIR, 'companion.json'), 'utf8')); } catch (e) {}
  if (!c || c.on !== true) return;
  helperUp(+c.port || 47810, function (up) {
    if (up || Date.now() - wokeAt < 50000) return;
    wokeAt = Date.now();
    require('child_process').exec("luna-send -n 1 luna://app.tivibro.tv.service/wake '{}'", { timeout: 20000 }, function (err) {
      log({ lv: err ? 'warn' : 'info', event: 'agent woke the helper for the phone app', e: err ? err.message : undefined });
    });
  });
}, 60000);
process.on('uncaughtException', function (e) { log({ lv: 'error', event: 'agent uncaught', e: e && (e.stack || e.message) }); });
