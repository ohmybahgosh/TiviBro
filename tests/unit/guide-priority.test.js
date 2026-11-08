// The provider's guide comes first.  Another guide takes a channel over only where the two agree (the same
// titles at the same times), not because it reaches more days ahead (PubEpg.alike, the worker in epg.js and
// the helper's service/guide.js).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');
const PubEpg = require('../../app/js/pubepg.js');
let fails = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }
const H = 3600e3, now = Math.floor(Date.now() / H) * H;
// A schedule: hours from now, titles.
const sched = (from, titles, len) => titles.map((t, i) => ({ s: now + (from + i * (len || 1)) * H, e: now + (from + (i + 1) * (len || 1)) * H, t: t }));
const NEWS = ['Morning News', 'Today Show', 'Judge Judy', 'Local News at Noon', 'Days of Our Lives', 'General Hospital', 'Dr. Phil', 'Evening News', 'Jeopardy!', 'Wheel of Fortune'];
const OTHER = ['SportsCenter', 'NFL Live', 'First Take', 'College GameDay', 'NBA Today', 'Around the Horn', 'Pardon the Interruption', 'SportsCenter', 'Monday Night Football', 'SportsCenter'];

check('the same schedule, reaching days further: agrees', () => {
  const prov = sched(-2, NEWS), alt = sched(-2, NEWS.concat(NEWS, NEWS, NEWS));
  assert.equal(PubEpg.alike(prov, alt, now), true);
});
check('small differences in titles still agree ("New", case, an added word)', () => {
  const prov = sched(-1, ['Big Ten Football: Michigan at Ohio State', 'Big Ten Tonight', 'B1G Hoops', 'The Journey']);
  const alt = sched(-1, ['NCAAF: Michigan at Ohio State [NEW]', 'BIG TEN TONIGHT', 'B1G Hoops Live', 'The Journey']);
  assert.equal(PubEpg.alike(prov, alt, now), true);
});
check('another channel\'s schedule with more days: does not agree', () => {
  assert.equal(PubEpg.alike(sched(-2, NEWS), sched(-2, OTHER.concat(OTHER, OTHER)), now), false);
});
check('the right schedule three hours off: does not agree', () => {
  assert.equal(PubEpg.alike(sched(-2, NEWS), sched(1, NEWS.concat(NEWS)), now), false);
});
check('the provider has nothing from now on: the other may stand in', () => {
  assert.equal(PubEpg.alike(sched(-6, NEWS.slice(0, 4)), sched(-2, OTHER), now), true);
  assert.equal(PubEpg.alike([], sched(-2, OTHER), now), true);
});
check('the provider\'s guide is one filler title all day: the other may stand in', () => {
  assert.equal(PubEpg.alike(sched(-1, ['ESPN', 'ESPN', 'ESPN', 'ESPN', 'ESPN']), sched(-1, OTHER), now), true);
});
check('the other guide has nothing from now on, or only after the provider\'s ends: no', () => {
  assert.equal(PubEpg.alike(sched(-1, NEWS), sched(-8, NEWS.slice(0, 5)), now), false);
  assert.equal(PubEpg.alike(sched(-1, NEWS.slice(0, 3)), sched(5, NEWS), now), false);
});
check('a few titles differ (a late change): still agrees', () => {
  const alt = NEWS.slice(); alt[3] = 'Special Report'; alt[7] = 'Breaking News';
  assert.equal(PubEpg.alike(sched(-2, NEWS), sched(-2, alt), now), true);
});

// The helper, end to end: two XMLTV files, the provider's first.
function xml(chans) {
  const ts = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000'; };
  let o = '<?xml version="1.0"?><tv>';
  for (const id in chans) o += '<channel id="' + id + '"><display-name>' + id + '</display-name></channel>';
  for (const id in chans) chans[id].forEach((p) => { o += '<programme start="' + ts(p.s) + '" stop="' + ts(p.e) + '" channel="' + id + '"><title>' + p.t.replace(/&/g, '&amp;') + '</title></programme>'; });
  return o + '</tv>';
}
check('helper: the provider\'s guide first; a source takes a channel only where it agrees', () => new Promise((resolve, reject) => {
  const files = {
    '/prov.xml': xml({ 'agree.us': sched(-2, NEWS), 'differ.us': sched(-2, NEWS), 'provonly.us': sched(-2, NEWS) }),
    '/extra.xml': xml({ 'agree.us': sched(-2, NEWS.concat(NEWS, NEWS)), 'differ.us': sched(-2, OTHER.concat(OTHER, OTHER)), 'extraonly.us': sched(-2, OTHER) })
  };
  const srv = http.createServer((q, r) => { r.writeHead(files[q.url] ? 200 : 404, { 'content-type': 'text/xml' }); r.end(files[q.url] || ''); });
  srv.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + srv.address().port;
    process.env.TIVIBRO_GUIDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-gp-'));
    const G = require('../../service/guide.js');
    const msg = { sources: [{ url: base + '/prov.xml', label: 'provider guide', provider: true }, { url: base + '/extra.xml', label: 'extra', key: 'x' }],
      ids: ['agree.us', 'differ.us', 'provonly.us', 'extraonly.us'], past: {}, names: {}, from: now - 86400e3, recent: now - 3 * H, to: now + 3 * 86400e3 };
    const job = G.start({ pl: 'gp', kind: 'main', sig: 's1', msg: msg }, () => {});
    const t0 = Date.now();
    (function wait() {
      if (job.phase !== 'done' && job.phase !== 'error' && Date.now() - t0 < 10000) return setTimeout(wait, 50);
      srv.close();
      try {
        assert.equal(job.phase, 'done', job.error);
        const dir = path.join(process.env.TIVIBRO_GUIDE_DIR, G.keyOf('gp', 'main'));
        const rows = fs.readFileSync(path.join(dir, 'titles.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
        const of = (id) => rows.filter((r) => r[0] === id).map((r) => r[3]);
        assert.equal(of('agree.us').length, 30, 'agreeing source with three times the days takes over');
        assert.deepEqual(of('differ.us'), NEWS, 'a disagreeing source with more days does not');
        assert.deepEqual(of('provonly.us'), NEWS);
        assert.deepEqual(of('extraonly.us'), OTHER, 'a channel only the source has comes from it');
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')), r = meta.report[1];
        assert.equal(r.over, 1); assert.equal(r.kept, 1);
        resolve();
      } catch (e) { reject(e); }
    })();
  });
}));

// The guide worker in the app (no helper): the same rule.
check('worker: the provider\'s guide first; a source takes a channel only where it agrees', () => new Promise((resolve, reject) => {
  const vm = require('vm'), acorn = require('acorn');
  const src = fs.readFileSync('app/js/epg.js', 'utf8');
  const body = acorn.parse(src, { ecmaVersion: 2016 }).body.find((n) => n.type === 'VariableDeclaration').declarations[0].init.callee.body.body;
  const fn = (name) => { const n = body.find((x) => x.type === 'FunctionDeclaration' && x.id.name === name); return src.slice(n.start, n.end); };
  const files = {
    '/prov.xml': xml({ 'agree.us': sched(-2, NEWS), 'differ.us': sched(-2, NEWS) }),
    '/extra.xml': xml({ 'agree.us': sched(-2, NEWS.concat(NEWS, NEWS)), 'differ.us': sched(-2, OTHER.concat(OTHER, OTHER)), 'extraonly.us': sched(-2, OTHER) })
  };
  const srv = http.createServer((q, r) => { r.writeHead(files[q.url] ? 200 : 404, { 'content-type': 'text/xml' }); r.end(files[q.url] || ''); });
  srv.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const self = { postMessage: (m) => { if (!m.map) return; srv.close(); try {
      assert.equal(m.map['agree.us'].length, 30);
      assert.deepEqual(m.map['differ.us'].map((p) => p.t), NEWS);
      assert.deepEqual(m.map['extraonly.us'].map((p) => p.t), OTHER);
      assert.equal(m.report[1].over, 1); assert.equal(m.report[1].kept, 1);
      resolve();
    } catch (e) { reject(e); } } };
    const ctx = { self: self, fetch: fetch, TextDecoder: TextDecoder, TransformStream: TransformStream, Promise: Promise, Date: Date, Math: Math };
    vm.createContext(ctx);
    vm.runInContext('(function(){ ' + fn('progFlag') + fn('readFlag') + fn('norm') + ' self.norm = norm; self.progFlag = progFlag; self.readFlag = readFlag; self.pubKeys = function () { return { keys: [], country: "" }; }; })();', ctx);
    ctx.self.alike = PubEpg.alike;
    vm.runInContext('(' + fn('workerMain') + ')();', ctx);
    self.onmessage({ data: { sources: [{ url: base + '/prov.xml', label: 'provider guide', provider: true }, { url: base + '/extra.xml', label: 'extra', key: 'x' }],
      ids: ['agree.us', 'differ.us', 'extraonly.us'], past: {}, names: {}, from: now - 86400e3, recent: now - 3 * H, to: now + 3 * 86400e3 } });
  });
}));

(async () => {
  for (const [name, fn] of checks) {
    try { await fn(); console.log('PASS ' + name); } catch (e) { fails++; console.error('FAIL ' + name + ': ' + e.message); }
  }
  if (fails) process.exitCode = 1; else console.log('all guide priority checks passed');
})();
