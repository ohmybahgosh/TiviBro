// WebEdit.testEpgSource ("Test connection" for a guide address in the web editor) must give up
// on a server that accepts the connection and then goes silent, instead of spinning forever --
// the same bug class just fixed in epg.js's guide-download worker, in a sibling call site that
// has the identical unprotected fetch -> getReader() -> read() loop.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

function setup(opts) {
  opts = opts || {};
  let now = 1e9;
  let seq = 0;
  const timers = [];
  const setTimeoutFake = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
  const clearTimeoutFake = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  function advance(ms) {
    now += ms;
    timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at).forEach(t => { clearTimeoutFake(t.id); t.fn(); });
  }

  // One chunk, then silence forever -- until the request is given up on.
  function fakeFetch(url, fetchOpts) {
    if (opts.uncooperative) {
      // A hand-rolled reader that does not honor cancel() on a pending read() at all -- Node's
      // real ReadableStream always settles a pending read on cancel() per spec, which is too
      // conformant to model an incomplete 2016-era (Chromium 53) Streams implementation.
      let delivered = false;
      const reader = {
        read() {
          if (!delivered) { delivered = true; return Promise.resolve({ done: false, value: new TextEncoder().encode('<tv><channel id="a"><display-name>A</display-name></channel>') }); }
          return new Promise(() => {});   // never settles on its own, cancel() does nothing
        },
        cancel() {}
      };
      return Promise.resolve({ ok: true, status: 200, url, headers: { get: (k) => k.toLowerCase() === 'content-length' ? '99999' : null }, body: { getReader: () => reader } });
    }
    let ctl;
    const stream = new ReadableStream({
      start(c) { ctl = c; c.enqueue(new TextEncoder().encode('<tv><channel id="a"><display-name>A</display-name></channel>')); },
      cancel() { try { ctl.error(Object.assign(new Error('cancelled'), { name: 'AbortError' })); } catch (e) {} }
    });
    if (fetchOpts && fetchOpts.signal) fetchOpts.signal.addEventListener('abort', () => { try { ctl.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); } catch (e) {} });
    return Promise.resolve({ ok: true, status: 200, url, headers: { get: (k) => k.toLowerCase() === 'content-length' ? '99999' : null }, body: stream });
  }

  const ctx = {
    console, Promise, Object, Array, String, RegExp, isFinite,
    Date: { now: () => now },
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    fetch: fakeFetch, TextDecoder, TextEncoder, ReadableStream,
    Net: { active: false, wrap: (u) => u, port: 0, xfer: () => '' },
    Log: { info() {}, warn() {}, error() {}, debug() {} },
    Store: { settings: {}, edits: { epgMap: {} }, playlist: {} },
    Library: { data: { channels: [] } },
    Epg: { xml: false, refresh: () => Promise.resolve(), pubStatus: null, pubSource: () => null, hasData: () => false, epgId: () => '' },
    PubEpg: { conf: () => ({ on: false, cc: [] }), all: () => [] },
    U: { el: () => ({}) },
    UI: {},
    App: {},
    document: { getElementById: () => null }
  };
  if (!opts.noAbortController) ctx.AbortController = AbortController;   // omitted to simulate webOS 4's Chromium 53
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/webedit.js'), 'utf8') + '\nthis.WebEdit = WebEdit;', ctx);
  return { WebEdit: ctx.WebEdit, advance };
}

async function flush(n) { for (let i = 0; i < (n || 5); i++) await new Promise((r) => setImmediate(r)); }

async function runCase(label, setupOpts) {
  const { WebEdit, advance } = setup(setupOpts);

  if (typeof WebEdit._testEpgSource !== 'function') { ok('WebEdit exposes _testEpgSource for this test', false, 'not exported yet'); return; }

  const p = WebEdit._testEpgSource({ url: 'http://example.test/guide.xml' });
  let settled = false, failed = null;
  p.then(() => { settled = true; }, (e) => { settled = true; failed = e; });

  await flush();
  ok(label + ': does not settle while the source is still delivering', !settled);

  advance(60000);             // well past any reasonable idle timeout
  await flush();

  ok(label + ': settles once the stalled source is given up on, instead of spinning forever', settled);
  ok(label + ': rejects rather than reporting a silent false success', !!failed, failed ? failed.message : 'resolved instead of rejecting');
}

(async () => {
  await runCase('with AbortController', {});
  await runCase('without AbortController (webOS 4)', { noAbortController: true });
  await runCase('engine ignores cancel()/abort() entirely (worst case)', { noAbortController: true, uncooperative: true });
})().then(() => { console.log(fail ? fail + ' failures' : 'all webedit testEpgSource timeout tests passed'); process.exit(fail ? 1 : 0); });
