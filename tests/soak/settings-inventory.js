/* Every setting is still there (the Settings overhaul): every row you can change or press, walked through
   every section and the pages inside them (three deep, the advanced ones too) through the phone's own view
   of Settings, is compared with tests/settings-inventory.json, the list taken before the overhaul.  A row
   may move to another section or page; it may only be renamed through RENAMED below, and only dropped
   through GONE (with the reason).  UPDATE=1 writes the list again (only when a setting is added on purpose).
     node tests/mock/mock_provider.js &  (on :8077)
     npm run serve &                      (app on :8078, dev helper on :47811)
     node tests/soak/settings-inventory.js */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = 'http://127.0.0.1:47811';
const FILE = path.join(__dirname, '../settings-inventory.json');
// old label -> new label, for settings renamed in plain words.
const RENAMED = { 'Play next episode automatically': 'Play the next one automatically' };
// old label -> why it is no longer a row (it must still be reachable another way).
const GONE = {
  // The second Settings overhaul: pages that are headings on their section now, their rows in place.
  'Display and shelves': 'a heading on My media', 'Trakt': 'a heading on My media', 'In the player': 'a heading on Remote and buttons',
  'In the guide': 'a heading on Remote and buttons', 'On the Channels screen': 'a heading on Remote and buttons', 'Quick menu buttons': 'a heading on Remote and buttons',
  // Advanced settings are always in place now, under an Advanced heading, so the switch for them went.
  'Settings shown': 'advanced settings are always shown, under an Advanced heading'
};
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 1500) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
// Rows that name things of the moment (a playlist, a count, a time) rather than a setting.
const VOLATILE = /^(Demo provider|TiviBro \d|Guide last loaded|provider guide|Channels with guide data|Last backup|Status|Storage|Network helper|Browser engine|Channels loaded|Audio converter|Debug from a computer|Fetching details now|Coming up|No |Left out of this playlist)/;

(async () => {
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: true });
  s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Inventory' });
  const sa = (o) => C.ask(cred, 'settings', o, { seal: true }).then((r) => r.data);

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // Every row shown (the old Everyday filter off), as a test build.
  await ev(() => { TIVIBRO_VERSION = '0.6.0-alpha.99'; Store.settings.setLevel = 'all'; if (UI.modalOpen) UI.close(); Views.switchTab('settings'); Settings.open(); });
  await page.waitForTimeout(600);

  const rows = new Map();          // label -> { kind, where }
  let pages = 0;
  async function walk(sec, pathTo, trail) {
    const pg = await sa({ op: 'page', sec, path: pathTo }).catch(() => null);
    if (!pg) return;
    pages++;
    for (const r of pg.rows) {
      if (r.kind === 'head' || r.kind === 'info' || r.kind === 'summary') continue;
      const label = String(r.label || '').trim();
      if (!label || VOLATILE.test(label)) continue;
      if (!rows.has(label)) rows.set(label, { kind: r.kind, where: trail });
      if (r.kind === 'page' && pathTo.length < 3 && !/^(Add playlist|Your groups|Hidden groups|Hidden channels)/.test(label)) await walk(sec, pathTo.concat([r.i]), trail + ' > ' + label);
    }
  }
  const secs = (await sa({ op: 'sections' })).sections;
  for (const x of secs) await walk(x.id, [], x.title);
  console.log('walked ' + pages + ' pages, ' + rows.size + ' rows');

  if (process.env.UPDATE) {
    const out = {}; [...rows.keys()].sort().forEach((k) => { out[k] = rows.get(k); });
    fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
    console.log('wrote ' + FILE);
  } else {
    const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const missing = Object.keys(base).filter((k) => !GONE[k] && !rows.has(RENAMED[k] || k));
    ok('every setting from before the overhaul is still in Settings (' + Object.keys(base).length + ')', !missing.length, missing.map((k) => k + '  (was in ' + base[k].where + ')').join('\n'));
    const added = [...rows.keys()].filter((k) => !base[k] && !Object.values(RENAMED).includes(k));
    if (added.length) console.log('new rows: ' + added.join(' | '));
  }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all settings accounted for');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
