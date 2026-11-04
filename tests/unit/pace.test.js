// Pacing images after a host says "too many requests" (service/pace.js, issue #45): the rules with a fake
// clock, then the relay itself against a logo host that answers 429 once.
const http = require('http'), path = require('path');
const Pace = require(path.join(__dirname, '../../service/pace.js'));
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

// The rules, with a clock that only moves when told to.
let t = 1e6; const timers = [];
const p = Pace.create({ now: () => t, later: (f, ms) => timers.push({ at: t + ms, f }) });
ok('logo paths are images', p.isImage('/a/b/logo.PNG') && p.isImage('/x.jpg?w=200') && p.isImage('/i.webp'));
ok('streams and lists are not', !p.isImage('/live/1/2/3.ts') && !p.isImage('/x.m3u8') && !p.isImage('/player_api.php') && !p.isImage(''));
ok('Retry-After in seconds', p.waitFor('5') === 5000);
ok('kept between 2 and 60 seconds', p.waitFor('0') === 2000 && p.waitFor('600') === 60000);
ok('no Retry-After: 10 seconds', p.waitFor(undefined) === 10000 && p.waitFor('soon') === 10000);
ok('an HTTP date', p.waitFor(new Date(t + 7000).toUTCString()) >= 6000);
let ran = 0;
ok('a host that never said 429: at once', p.wait('i.imgur.com', true, () => ran++) === 0 && ran === 1);
p.backoff('i.imgur.com', '5');
ok('images from it wait for Retry-After', p.wait('i.imgur.com', true, () => ran++) === 5000 && ran === 1);
ok('the next one waits its turn after that', p.wait('i.imgur.com', true, () => ran++) === 5000 + Pace.SPACING);
ok('a stream from the same host is never held', p.wait('i.imgur.com', false, () => ran++) === 0 && ran === 2);
ok('another host is not held', p.wait('logos.example', true, () => ran++) === 0 && ran === 3);
timers.forEach((x) => x.f());
ok('the waiting ones run later', ran === 5);
t += 6000 + 2 * Pace.SPACING;
ok('during the cool-down, still one at a time', p.paced('i.imgur.com') && p.wait('i.imgur.com', true, () => {}) === 0 && p.wait('i.imgur.com', true, () => {}) === Pace.SPACING);
t += Pace.COOL;
ok('a minute later, back to normal', !p.paced('i.imgur.com') && p.wait('i.imgur.com', true, () => {}) === 0 && p.wait('i.imgur.com', true, () => {}) === 0);

(async () => {
  // A logo host that turns the first request away (Retry-After 2) and then answers.
  let hits = 0;
  const up = http.createServer((req, res) => {
    hits++;
    if (req.url === '/busy.png' && hits === 1) { res.writeHead(429, { 'Retry-After': '2' }); return res.end('slow down'); }
    if (req.url === '/always.ts') { res.writeHead(429, { 'Retry-After': '2' }); return res.end('no'); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('PNG');
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port + '/x/http/127.0.0.1:' + up.address().port;
  const get = (u) => new Promise((res) => http.get(u, (x) => { let b = ''; x.on('data', d => b += d); x.on('end', () => res({ status: x.statusCode, body: b })); }).on('error', e => res({ status: 0, body: e.message })));
  const t0 = Date.now();
  const a = await get(B + '/busy.png');
  const took = Date.now() - t0;
  ok('a logo turned away once arrives after the wait', a.status === 200 && a.body === 'PNG' && took >= 1900 && hits === 2, a.status + ' in ' + took + ' ms, ' + hits + ' asks');
  const rec = proxy.LOG.filter(x => /busy\.png/.test(x.u)).pop() || {};
  ok('the log says it waited', rec.s === 200 && rec.waited === 2000, JSON.stringify(rec));
  const s = await get(B + '/always.ts');
  ok('a stream gets the 429 at once, untouched', s.status === 429, s.status);
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all pacing tests passed');
  process.exit(fail ? 1 : 0);
})();
