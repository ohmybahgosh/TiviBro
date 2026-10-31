// app/js/update.js: version ordering, picking a release, the check, and installing through a fake
// Homebrew Channel service.  Runs the real file in a sandbox with stand-ins for the app's modules.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '../../app/js/update.js'), 'utf8');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

function sandbox(opts) {
  opts = opts || {};
  const store = {}, toasts = [], calls = [], reloads = [];
  const sb = {
    TIVIBRO_VERSION: opts.version || '0.6.0-alpha.2',
    Store: { settings: Object.assign({}, opts.settings || {}) },
    Log: { info() {}, warn() {}, error() {}, state() {}, closing() {} },
    Net: { wrap: u => u },
    U: {
      toast: (m) => toasts.push(m),
      getJSON: (url) => {
        calls.push(url);
        if (opts.apiError && /api\.github/.test(url)) return Promise.reject(Object.assign(new Error('HTTP 404 Not Found'), { status: 404 }));
        if (/api\.github/.test(url)) return Promise.resolve(opts.releases || RELEASES);
        if (/manifest\.json$/.test(url)) return Promise.resolve({ version: '0.7.0', ipkUrl: 'app.tivibro.tv_0.7.0_all.ipk', ipkHash: { sha256: 'ab'.repeat(32) }, ipkSize: 700000 });
        return Promise.reject(new Error('unexpected ' + url));
      }
    },
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
    location: { reload: () => reloads.push(1) },
    setTimeout: (fn, ms) => { if (ms <= 3000) fn(); return 1; }, clearTimeout() {},
    Promise, JSON, Date, Math, String, Array, Object, RegExp, Error,
    PalmServiceBridge: opts.noBridge ? undefined : function () {
      const b = this;
      b.call = function (uri, params) {
        calls.push(uri + ' ' + params);
        const reply = m => b.onservicecallback(JSON.stringify(m));
        if (/getAppInfo/.test(uri)) return opts.noHbc ? reply({ returnValue: false, errorCode: -1, errorText: 'Service does not exist: org.webosbrew.hbchannel.service.' }) : reply({ returnValue: true, appInfo: {} });
        if (/\/install$/.test(uri)) {
          if (opts.installFails) return reply({ returnValue: false, errorText: 'Invalid checksum' });
          reply({ returnValue: true, statusText: 'Downloading', progress: 30 });
          reply({ returnValue: true, statusText: 'Installing', progress: 100 });
          reply({ returnValue: true, finished: true, statusText: 'Application installed' });
        }
      };
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  return { Update: vm.runInContext('Update', sb), toasts, calls, reloads, store, sb };
}
const rel = (tag, extra) => Object.assign({ tag_name: tag, name: 'TiviBro ' + tag, html_url: 'https://github.com/x/y/releases/tag/' + tag, published_at: '2026-10-27T23:00:00Z',
  body: '### New\n\n- **Faster** guides with `gz`\n- See [docs](https://x)\n\n### Install\n\n- ignore me',
  assets: [{ name: 'app.tivibro.tv.manifest.json', browser_download_url: 'https://github.com/x/y/releases/download/' + tag + '/app.tivibro.tv.manifest.json' }, { name: 'app.tivibro.tv_' + tag.replace(/^v|-.*$/g, '') + '_all.ipk', size: 650000 }] }, extra || {});
const RELEASES = [rel('v0.7.0-alpha.1', { prerelease: true }), rel('v0.6.0'), rel('v0.6.0-alpha.3', { prerelease: true }), rel('v0.9.0', { draft: true }), rel('v0.5.0', { assets: [] })];

(async () => {
  const { Update } = sandbox();
  const T = Update._test;
  const order = ['0.5.0', '0.6.0-alpha.2', '0.6.0-alpha.3', '0.6.0-alpha.10', '0.6.0-beta.1', '0.6.0-rc.1', '0.6.0', '0.6.1', '0.10.0'];
  let sorted = true;
  for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
    const want = i < j ? -1 : i > j ? 1 : 0;
    if (T.compare(order[i], order[j]) !== want) { sorted = false; console.log('  bad', order[i], order[j], T.compare(order[i], order[j])); }
  }
  ok('versions order correctly (pre-releases before the release, numbers numerically)', sorted);
  ok('a leading v is ignored', T.compare('v0.6.0', '0.6.0') === 0);
  ok('pick: newest full release when test versions are off', T.pick(RELEASES, false).version === '0.6.0');
  ok('pick: newest overall when test versions are on, drafts and releases without a manifest skipped', T.pick(RELEASES, true).version === '0.7.0-alpha.1');
  const n = T.notes(RELEASES[0].body);
  ok('release notes stop at the folded install section too', T.notes('**New in alpha 33**\n\n- One\n\n> **Test build.**\n\n<details><summary>Install</summary>\n\n- Homebrew').join('|') === 'New in alpha 33|One', T.notes('**New in alpha 33**\n\n- One\n\n<details><summary>Install</summary>\n- Homebrew').join('|'));
  ok('release notes become plain lines and stop at the install section', n.join('|') === 'New|Faster guides with gz|See docs', n.join('|'));

  // Running an alpha: test versions are on by default, so 0.7.0-alpha.1 is offered.
  let s = sandbox();
  await s.Update.check(false);
  let st = s.Update.state;
  ok('check finds the newer test version for an alpha build', st.state === 'available' && st.latest.version === '0.7.0-alpha.1', st.state);
  ok('IPK address comes from the manifest, next to it', st.latest.ipkUrl === 'https://github.com/x/y/releases/download/v0.7.0-alpha.1/app.tivibro.tv_0.7.0_all.ipk', st.latest.ipkUrl);
  ok('the checksum comes from the manifest', st.latest.sha256 === 'ab'.repeat(32));
  ok('the result is remembered for the next start', /0\.7\.0-alpha\.1/.test(s.store['tivibro.update'] || ''));

  s = sandbox({ version: '0.6.0' });
  await s.Update.check(false);
  ok('a full release is not offered test versions by default', s.Update.state.state === 'current', s.Update.state.state);
  s = sandbox({ version: '0.6.0', settings: { updatePre: true } });
  await s.Update.check(false);
  ok('…unless "Include test versions" is on', s.Update.state.state === 'available' && s.Update.state.latest.version === '0.7.0-alpha.1');
  s = sandbox({ version: '0.7.0' });
  await s.Update.check(false);
  ok('nothing offered when already newest', s.Update.state.state === 'current');

  s = sandbox({ apiError: true });
  await s.Update.check(false);
  ok('a private or missing repository gives a clear message', s.Update.state.state === 'error' && /private/.test(s.Update.state.error), s.Update.state.error);

  s = sandbox();
  await s.Update.check(true);
  ok('a quiet check announces an update with a toast', s.toasts.some(t => /0\.7\.0-alpha\.1 is available/.test(t)), s.toasts.join(' | '));

  // Installing through the Homebrew Channel.
  s = sandbox();
  await s.Update.check(false);
  ok('the Homebrew Channel is detected', await s.Update.installer() === true && s.Update.state.installer === 'hbchannel');
  await s.Update.install();
  const call = s.calls.filter(c => /hbchannel\.service\/install/.test(c))[0] || '';
  ok('install hands the IPK link and checksum to the Homebrew Channel', /"ipkUrl":"https:\/\/github\.com\/x\/y\/releases\/download\/v0\.7\.0-alpha\.1\/app\.tivibro\.tv_0\.7\.0_all\.ipk"/.test(call) && /"ipkHash":"(ab){32}"/.test(call) && /"subscribe":true/.test(call), call);
  ok('progress is shown while it installs, then it is marked installed', s.Update.state.state === 'installed' && s.Update.state.progress === 100);
  ok('the app reloads into the new version', s.reloads.length === 1);

  s = sandbox({ installFails: true });
  await s.Update.check(false);
  let err = null; try { await s.Update.install(); } catch (e) { err = e; }
  ok('an install error is reported, nothing reloads', err && /checksum/i.test(err.message) && s.Update.state.state === 'error' && s.reloads.length === 0);

  s = sandbox({ noHbc: true });
  await s.Update.check(false);
  ok('without the Homebrew Channel, the TV says it cannot install by itself', await s.Update.installer() === false && s.Update.state.installer === '');
  err = null; try { await s.Update.install(); } catch (e) { err = e; }
  ok('…and install refuses with a reason', err && /rooted/.test(err.message));

  s = sandbox();
  ok('describe() before any check', s.Update.describe() === 'Not checked yet');

  console.log(fail ? fail + ' failures' : 'all update tests passed');
  process.exit(fail ? 1 : 0);
})();
