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
var CTL = process.env.TIVIBRO_REC_CTL || '', LOG = path.join(DIR, 'agent.log');
function log(o) { o.t = Date.now(); try { fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); } catch (e) {} }
var server = http.createServer(function (req, res) {
  var file = req.url.indexOf('/record/file/') === 0;
  if (!file && CTL && req.headers['x-tivibro-ctl'] !== CTL) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"not allowed","code":"ctl"}'); }
  Record.handle(req, res, {}, log);
});
server.on('error', function (e) { log({ lv: 'error', event: 'agent listen failed', e: e.code }); process.exit(0); });
server.listen(+(process.env.TIVIBRO_REC_AGENT_PORT || 47820), '127.0.0.1', function () {
  try { fs.writeFileSync(path.join(DIR, 'agent.pid'), String(process.pid)); } catch (e) {}
  log({ lv: 'info', event: 'agent listening' }); Record.start({ log: log });
});
process.on('uncaughtException', function (e) { log({ lv: 'error', event: 'agent uncaught', e: e && (e.stack || e.message) }); });
