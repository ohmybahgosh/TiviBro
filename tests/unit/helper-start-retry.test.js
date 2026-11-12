// The helper turned down for a moment just after the TV starts or wakes ("... is not running", issues #75
// and #82): TiviBro asks again rather than going without it.  A refusal for good is not asked again.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const src = fs.readFileSync(path.join(__dirname, '../../app/js/net.js'), 'utf8');
function run(answers) {
  const calls = [], logs = [];
  const ctx = {
    console, Promise, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null },
    Log: { info: (c, m) => logs.push(m), warn: (c, m) => logs.push(m), error: (c, m) => logs.push(m), debug() {} },
    Store: { settings: { network: 'auto' }, playlist: {} },
    fetch: (u) => /:47811\//.test(u) ? Promise.reject(new Error('nothing there')) : Promise.resolve({ json: () => ({ ok: true, node: 'v16' }) }),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
    PalmServiceBridge: function () { const me = this; this.call = function () { const a = answers[calls.length] || answers[answers.length - 1]; calls.push(a); setTimeout(() => me.onservicecallback(JSON.stringify(a)), 1); }; }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.Net = Net;', ctx);
  return ctx.Net.start(3000).then((port) => ({ port, calls: calls.length, logs }));
}
(async () => {
  const notRunning = { returnValue: false, errorText: 'app.tivibro.tv.service is not running.' };
  let r = await run([notRunning, notRunning, { returnValue: true, port: 47900 }]);
  ok('turned down twice just after a start: asked again, and it runs', r.port === 47900 && r.calls === 3, r);
  r = await run([{ returnValue: false, errorText: 'Service does not exist' }]);
  ok('a helper that is not installed is not asked again', !r.port && r.calls === 1, r);
  r = await run([notRunning]);
  ok('at most four tries', !r.port && r.calls === 4, r);
  console.log(fails ? fails + ' failures' : 'all helper start tests passed');
  process.exit(fails ? 1 : 0);
})();
