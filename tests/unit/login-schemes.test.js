// Both http and https failed (issue #87): the message says the same thing whichever scheme was typed, a port
// that only speaks http isn't called a certificate problem, and each attempt's answer goes with the message
// (the set-up screen, the web editor and the phone app show it) without the server's name.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };

const src = fs.readFileSync(path.join(__dirname, '../../app/js/source.js'), 'utf8');
const ctx = { console, Log: { info() {}, warn() {}, error() {}, debug() {} }, Store: { settings: {} }, Net: { active: true, port: 47811, wrap: u => u }, Promise };
ctx.window = ctx;
vm.createContext(ctx);
const EPROTO = 'helper: write EPROTO 4155720016:error:1408F10B:SSL routines:ssl3_get_record:wrong version number:../ssl/record/ssl3_record.c:331:';
// http answers 404, https on the same port is a plain http port.
ctx.answer = function (url) {
  const e = /^https:/.test(url) ? Object.assign(new Error(EPROTO), { kind: 'http', status: 502, via: 'helper' })
    : Object.assign(new Error('HTTP 404 Not Found'), { kind: 'http', status: 404, via: 'helper' });
  return Promise.reject(e);
};
vm.runInContext('var U = { secretShape: function (v) { return String(v).length + " chars"; }, hash: function (s) { return String(s).length; }, getJSON: function (u) { return answer(u); } };', ctx);
vm.runInContext('var PlShape = { parseM3U: function () {} };', ctx);
vm.runInContext(src + '\nthis.Source = Source;', ctx);
const S = ctx.Source;

const f = S.friendly(Object.assign(new Error(EPROTO), { kind: 'http', via: 'helper' }));
ok('a plain http port asked for https is not called a certificate problem', !/certificate/i.test(f) && /doesn't use https/.test(f), f);
ok('a real certificate error still says certificate', /certificate/.test(S.friendly(Object.assign(new Error('helper: CERT_HAS_EXPIRED'), { kind: 'http', via: 'helper' }))));

function tryWith(server) {
  return S.load({ id: 'x' + server.length, type: 'xtream', server: server, user: 'demo', pass: 'demo' }).then(() => null, e => e);
}
(async () => {
  const a = await tryWith('http://panel.example.org:8080'), b = await tryWith('https://panel.example.org:8080'), c = await tryWith('panel.example.org:8080');
  ok('typed http: the server\'s own answer (404) is the message', /Not found \(HTTP 404\)/.test(a.message.split('What each')[0]), a.message);
  ok('typed https: the same 404, not the https failure', /Not found \(HTTP 404\)/.test(b.message.split('What each')[0]), b.message);
  ok('no scheme: the same 404', /Not found \(HTTP 404\)/.test(c.message.split('What each')[0]), c.message);
  ok('the message still says both were tried', /^Tried both http and https\./.test(a.message), a.message);
  ok('each attempt is listed by scheme and port', /http, port 8080: Not found \(HTTP 404\)\./.test(a.message) && /https, port 8080: This port doesn't use https/.test(a.message), a.message);
  ok('the server\'s name is not in the message', [a, b, c].every(e => e.message.indexOf('example.org') < 0));
  ok('no port given: the default ports are named', /http, port 80:/.test((await tryWith('panel.example.org')).message));
  if (fail) { console.log(fail + ' login scheme test(s) failed'); process.exit(1); }
  console.log('all login scheme tests passed');
})();
