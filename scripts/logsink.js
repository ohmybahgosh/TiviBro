// Development log receiver for TiviBro.  The app (in the simulator or a desktop browser) finds it
// on 127.0.0.1:47812 and streams every log line here.  Writes:
//   logs/session-<date>-<time>.log   one file per run
//   logs/latest.log                  always the current run (what Claude reads)
// Credentials are already masked by the app before they are sent.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const file = path.join(dir, 'session-' + stamp + '.log'), latest = path.join(dir, 'latest.log');
fs.writeFileSync(file, ''); fs.writeFileSync(latest, '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url === '/ping') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end('{"tivibroSink":true}'); }
  if (req.url === '/log' && req.method === 'POST') {
    let b = ''; req.setEncoding('utf8');
    req.on('data', d => { b += d; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { const t = b.endsWith('\n') ? b : b + '\n'; fs.appendFileSync(file, t); fs.appendFileSync(latest, t); res.writeHead(204, cors); res.end(); });
    return;
  }
  res.writeHead(404, cors); res.end();
}).listen(47812, '127.0.0.1', () => console.log('TiviBro log -> ' + path.relative(process.cwd(), latest)))
  .on('error', e => { console.error('log sink: ' + e.message + (e.code === 'EADDRINUSE' ? ' (another sink is already running, it keeps logging)' : '')); process.exit(0); });
