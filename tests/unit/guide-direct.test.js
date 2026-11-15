// Issue #93: a 1 GB TV with Network set to Direct closed TiviBro while it read the whole guide in the app,
// on top of the video.  Epg.waitIdle and appCopy (app/js/epg.js), and the problem report's masking of server
// names in the helper's network errors (Diag's scrubber, app/js/diag.js).
//   node tests/unit/guide-direct.test.js
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), acorn = require('acorn');
let fails = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(() => console.log('PASS ' + name), e => { fails++; console.error('FAIL ' + name + ': ' + e.message); }); }
function pick(file, names) {
  const src = fs.readFileSync(file, 'utf8'), ast = acorn.parse(src, { ecmaVersion: 2016 });
  const body = ast.body.find(n => n.type === 'VariableDeclaration').declarations[0].init.callee.body.body;
  return body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)).map(n => src.slice(n.start, n.end)).join('\n');
}
const epg = pick('app/js/epg.js', ['waitIdle', 'appCopy', 'holdOff']);
function world(o) {
  const c = Object.assign({ Player: { memSafe: 'this TV has 1 GB of memory or less' }, Views: { playing: { k: 'a' } }, Net: { port: 47811 },
    Store: { idbGet: () => Promise.resolve(o && o.idb || null) }, asked: [],
    hCached: function (kind, sig, pid) { c.asked.push([kind, sig, pid]); return Promise.resolve(o && o.helper || null); } }, o || {});
  vm.createContext(c); vm.runInContext(epg, c); return c;
}
const G = { sig: 's1', at: 1 };
(async () => {
  await check('in the app, short of memory and playing: the guide waits even with none to show', () => {
    const c = world();
    assert.equal(c.waitIdle(false, null, 's1', false), true);
    assert.equal(c.waitIdle(false, { sig: 'old', at: 1 }, 's1', false), true);
  });
  await check('through the helper with no guide yet: it still loads (the helper holds it, not the app)', () => {
    assert.equal(world().waitIdle(false, null, 's1', true), false);
  });
  await check('a guide on screen still waits, as before', () => {
    assert.equal(world().waitIdle(false, G, 's1', true), true);
  });
  await check('asked for (Reload guide), or nothing playing, or plenty of memory: no wait', () => {
    assert.equal(world().waitIdle(true, null, 's1', false), false);
    assert.equal(world({ Views: { playing: null } }).waitIdle(false, null, 's1', false), false);
    assert.equal(world({ Player: { memSafe: '' } }).waitIdle(false, null, 's1', false), false);
  });
  await check('Direct: the copy the helper stored on Automatic shows when the app has none', async () => {
    const c = world({ helper: G });
    assert.deepEqual(await c.appCopy('epg:p1', 's1', ''), G);
    assert.deepEqual(c.asked, [['main', 's1', '']]);
  });
  await check("Direct: the app's own copy comes first, and no helper means no ask", async () => {
    const own = { sig: 's1', at: 2 }, c = world({ idb: own, helper: G });
    assert.equal(await c.appCopy('epg:p1', 's1', ''), own); assert.equal(c.asked.length, 0);
    const d = world({ Net: { port: 0 } });
    assert.equal(await d.appCopy('epg:p1', 's1', ''), null); assert.equal(d.asked.length, 0);
  });
  await check('the problem report masks server names in network errors', () => {
    const c = { Log: { redact: s => s }, Store: { settings: { playlists: [{ server: 'http://saved.example.net:8080', user: 'abc', pass: 'xyz' }] } } };
    vm.createContext(c); vm.runInContext(pick('app/js/diag.js', ['scrubber']), c);
    const s = c.scrubber();
    assert.equal(s('helper: getaddrinfo ENOTFOUND line.example-panel.top'), 'helper: getaddrinfo ENOTFOUND <server>');
    assert.equal(s('helper: connect ECONNREFUSED 203.0.113.7:443'), 'helper: connect ECONNREFUSED <server>:443');
    assert.equal(s('getaddrinfo ENOTFOUND saved.example.net'), 'getaddrinfo ENOTFOUND <provider>');
    assert.equal(s("Host: tv.example.org. is not in the cert's altnames: DNS:cdn.example.org"), "Host: <server>. is not in the cert's altnames: DNS:<server>");
    for (const keep of ['connect ECONNREFUSED 127.0.0.1:47811', 'ETIMEDOUT after 15001ms', 'Chromium 87.0.4280.88']) assert.equal(s(keep), keep);
  });
  if (fails) process.exitCode = 1;
})();
