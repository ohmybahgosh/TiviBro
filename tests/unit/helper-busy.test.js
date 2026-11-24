// A busy helper is waited for, not restarted (issue #166): on a 1 GB TV a helper reading a big show list
// misses pings for half a minute, and restarting it then left TiviBro without it and the next starts hung.
// Missed pings only count; after two minutes webOS is asked (status), and only no answer there restarts it.
// A subscription that drops (the helper exited) still restarts it at once.
// Issue #172: no answer from webOS either is only a restart when the helper's port refuses the connection (it's
// gone); a port that takes it but doesn't answer is a busy helper, waited for.  A start while the helper from
// before is still busy asks webOS only once it answers (that call froze TiviBro on a 1 GB TV).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const src = fs.readFileSync(path.join(__dirname, '../../app/js/net.js'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* net.js in a sandbox: the helper's luna calls (start subscribes; status answers or not), its /ping
   (answered or not) and the 15 s timer, run by hand. */
function sandbox() {
  // tick: the first 15 s timer in net.js, the pings (the second one checks the control secret).
  // pingOk: answered; refused: nothing on the port (fails at once); else the port takes it and no answer comes (busy).
  const t = { calls: [], logs: [], pingOk: true, refused: false, statusAnswers: true, tick: null, bridges: [], ls: {} };
  const ctx = {
    console, Promise, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, setInterval: (f, ms) => { if (ms === 15000 && !t.tick) t.tick = f; return 0; }, clearInterval() {},
    localStorage: { getItem: (k) => (k in t.ls ? t.ls[k] : null), setItem: (k, v) => { t.ls[k] = String(v); } }, document: { hidden: false },
    Log: { info: (c, m) => t.logs.push(m), warn: (c, m) => t.logs.push(m), error: (c, m) => t.logs.push(m), debug() {} },
    Store: { settings: { network: 'auto' }, playlist: {} },
    fetch: () => t.pingOk ? Promise.resolve({ ok: true, json: () => ({ ok: true, node: 'v8' }) }) : t.refused ? Promise.reject(new TypeError('Failed to fetch')) : new Promise(() => {}),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
    PalmServiceBridge: function () {
      const me = this; t.bridges.push(me);
      this.cancel = function () { me.cancelled = true; };
      this.call = function (url) {
        t.calls.push(url.replace(/^.*\//, ''));
        if (/\/start$/.test(url)) setTimeout(() => me.onservicecallback(JSON.stringify({ returnValue: true, port: 47811 })), 1);
        else if (t.statusAnswers) setTimeout(() => me.onservicecallback(JSON.stringify({ returnValue: true, port: 47811, subscribers: 1 })), 1);
      };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.Net = Net;', ctx);
  t.Net = ctx.Net;
  t.ticks = async (n) => { for (let i = 0; i < n; i++) { t.tick(); await wait(); } await wait(60); };
  return t;
}

(async () => {
  let t = sandbox();
  await t.Net.start(3000);
  t.pingOk = false;
  await t.ticks(4);
  ok('a helper that misses pings for a minute is waited for, not restarted', t.calls.join() === 'start' && t.logs.some((m) => /busy or slow/.test(m)), t.calls);
  await t.ticks(4);
  ok('after two minutes webOS is asked, and a helper it says runs is left alone', t.calls.join() === 'start,status' && t.logs.some((m) => /still runs/.test(m)) && !t.bridges[0].cancelled, t.calls);
  t.pingOk = true;
  await t.ticks(1);
  ok('it answers again: said so', t.logs.some((m) => /answers again/.test(m)));

  t = sandbox();
  await t.Net.start(3000);
  t.pingOk = false; t.statusAnswers = false; t.refused = true;
  await t.ticks(8);
  await wait(120);
  ok('no answer from webOS either, and its port refuses: started again', t.calls.slice(0, 3).join() === 'start,status,start' && t.logs.some((m) => /did not answer for it/.test(m)), t.calls);

  t = sandbox();
  await t.Net.start(3000);
  t.pingOk = false; t.statusAnswers = false;
  await t.ticks(8);
  await wait(120);
  ok('no answer from webOS, but its port takes the connection: busy, waited for (issue #172)', t.calls.join() === 'start,status' && t.logs.some((m) => /busy \(its port takes/.test(m)) && !t.bridges[0].cancelled, t.calls);

  // A start while the helper from before is still busy: webOS is asked only once it answers.
  t = sandbox();
  t.ls['tivibro.helperPort'] = '47811'; t.pingOk = false;
  const started = t.Net.start(3000);
  await wait(150);
  ok('the helper from before still busy: webOS isn\'t asked yet', t.calls.length === 0 && t.logs.some((m) => /from before is still busy/.test(m)), t.calls);
  t.pingOk = true;
  await wait(150);
  await started;
  ok('...and is once it answers', t.calls.join() === 'start', t.calls);

  t = sandbox();
  t.ls['tivibro.helperPort'] = '47811'; t.pingOk = false; t.refused = true;
  await t.Net.start(3000);
  ok('nothing on its port (a fresh start): webOS asked at once', t.calls.join() === 'start' && !t.logs.some((m) => /still busy/.test(m)), t.calls);
  ok('the port is kept for next time', t.ls['tivibro.helperPort'] === '47811');

  t = sandbox();
  await t.Net.start(3000);
  t.pingOk = false;
  t.Net.suspect('a stream could not reach it');
  await wait(80);
  ok('a stream that could not reach it counts as a miss, nothing more', t.calls.join() === 'start', t.calls);

  t = sandbox();
  await t.Net.start(3000);
  t.bridges[0].onservicecallback(JSON.stringify({ returnValue: false, errorText: 'Message status unknown' }));
  await wait(120);
  ok('its subscription dropping still starts it again at once', t.calls.join() === 'start,start' && t.logs.some((m) => /subscription dropped/.test(m)), t.calls);

  console.log(fails ? fails + ' failures' : 'all busy helper tests passed');
  process.exit(fails ? 1 : 0);
})();
