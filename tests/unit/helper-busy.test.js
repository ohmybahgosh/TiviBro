// A busy helper is waited for, not restarted (issue #166): on a 1 GB TV a helper reading a big show list
// misses pings for half a minute, and restarting it then left TiviBro without it and the next starts hung.
// Missed pings only count; after two minutes webOS is asked (status), and only no answer there restarts it.
// A subscription that drops (the helper exited) still restarts it at once.
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
  const t = { calls: [], logs: [], pingOk: true, statusAnswers: true, tick: null, bridges: [] };
  const ctx = {
    console, Promise, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, setInterval: (f, ms) => { if (ms === 15000 && !t.tick) t.tick = f; return 0; }, clearInterval() {},
    localStorage: { getItem: () => null }, document: { hidden: false },
    Log: { info: (c, m) => t.logs.push(m), warn: (c, m) => t.logs.push(m), error: (c, m) => t.logs.push(m), debug() {} },
    Store: { settings: { network: 'auto' }, playlist: {} },
    fetch: () => t.pingOk ? Promise.resolve({ ok: true, json: () => ({ ok: true, node: 'v8' }) }) : new Promise(() => {}),
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
  t.pingOk = false; t.statusAnswers = false;
  await t.ticks(8);
  await wait(120);
  ok('no answer from webOS either: started again', t.calls.join() === 'start,status,start' && t.logs.some((m) => /did not answer for it/.test(m)), t.calls);

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
