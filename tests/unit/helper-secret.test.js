// webOS restarted the helper on its own: it has a new secret for its control routes (web editor, phone app,
// channel lists).  TiviBro used to keep the old one, and every control request was refused until it was
// opened again.  Now a refusal for the secret, or a fingerprint in /ping that isn't ours, has TiviBro ask
// the helper for the secret again, and the refused request is sent once more.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const src = fs.readFileSync(path.join(__dirname, '../../app/js/net.js'), 'utf8');
const tag = (c) => require('crypto').createHash('sha256').update('tivibro-ctl-tag\n' + c).digest('hex').slice(0, 16);

(async () => {
  // The helper itself: a fingerprint in /ping, never the secret, and a refusal that says why.
  const r = proxy.create({ ctl: 'SECRET-ONE' }); await new Promise((f) => r.server.listen(0, '127.0.0.1', f));
  const port = r.server.address().port;
  const get = (p, h) => new Promise((res) => http.get({ host: '127.0.0.1', port, path: p, headers: h || {} }, (rs) => { let b = ''; rs.on('data', (d) => b += d); rs.on('end', () => res({ status: rs.statusCode, text: b })); }));
  let a = await get('/ping');
  ok('the helper\'s /ping has its secret\'s fingerprint, not the secret', JSON.parse(a.text).key === tag('SECRET-ONE') && a.text.indexOf('SECRET-ONE') < 0, a.text.slice(0, 80));
  a = await get('/editor/status', { 'X-TiviBro-Ctl': 'OLD' });
  ok('a wrong secret is refused, saying it was the secret', a.status === 403 && JSON.parse(a.text).code === 'ctl', a);
  r.server.close();

  // The app: the helper restarted with a new secret.
  let helperCtl = 'NEW', asked = 0;
  const seen = [];
  const ctx = {
    console, Promise, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, setInterval: () => 0, clearInterval() {}, Object,
    localStorage: { getItem: () => null },
    Log: { info() {}, warn() {}, error() {}, debug() {} },
    Store: { settings: { network: 'auto' }, playlist: {} },
    fetch: (u, init) => {
      if (/\/ping$/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, key: tag(helperCtl) }) });
      const h = (init && init.headers) || {}; seen.push(h['X-TiviBro-Ctl']);
      const good = h['X-TiviBro-Ctl'] === helperCtl;
      const body = good ? { running: true } : { error: 'not allowed', code: 'ctl' };
      const resp = { status: good ? 200 : 403, ok: good, json: () => Promise.resolve(body) };
      resp.clone = () => resp;
      return Promise.resolve(resp);
    },
    PalmServiceBridge: function () { const me = this; this.call = function () { asked++; const c = asked === 1 ? 'OLD' : helperCtl; setTimeout(() => me.onservicecallback(JSON.stringify({ returnValue: true, port: 47811, ctl: c, key: tag(c) })), 1); }; this.cancel = function () {}; }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.Net = Net;', ctx);
  await ctx.Net.start(3000);
  const res = await ctx.Net.ctlFetch('http://127.0.0.1:47811/editor/status', { headers: {} });
  ok('refused for an old secret: TiviBro asks the helper again and the request goes through', res.status === 200 && seen.join(',') === 'OLD,NEW' && asked === 2, { status: res.status, seen, asked });
  const res2 = await ctx.Net.ctlFetch('http://127.0.0.1:47811/editor/status', { headers: { 'Content-Type': 'application/json' } });
  ok('later requests use the new secret straight away', res2.status === 200 && seen[seen.length - 1] === 'NEW' && asked === 2, { seen, asked });
  helperCtl = 'NEWER';
  const changed = await ctx.Net.fixCtl('test');
  ok('asked again after another restart: the newest secret', changed === true && ctx.Net.ctlHeaders({})['X-TiviBro-Ctl'] === 'NEWER');
  // A 403 that isn't about the secret is left alone (a page in the TV's browser, a pairing refused).
  const before = asked;
  ctx.fetch = () => { const resp = { status: 403, ok: false, json: () => Promise.resolve({ error: 'Pairing is not open', code: 'closed' }) }; resp.clone = () => resp; return Promise.resolve(resp); };
  vm.runInContext('fetch = this.fetch', ctx);
  const res3 = await ctx.Net.ctlFetch('http://127.0.0.1:47811/companion/pair', { headers: {} });
  ok('another kind of refusal is passed on as it is', res3.status === 403 && asked === before, { asked, before });
  console.log(fails ? fails + ' failures' : 'all helper secret tests passed');
  process.exit(fails ? 1 : 0);
})();
