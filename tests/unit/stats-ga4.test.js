/* tivibro.app's GA4 numbers for the stats dashboard (scripts/stats/ga4.js): a signed sign-in, the reports asked
   for, rows flattened and dates as the dashboard writes them.
     node tests/unit/stats-ga4.test.js */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const GA = require('../../scripts/stats/ga4.js');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'stats@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const asked = [];
global.fetch = async (url, init) => {
  if (/oauth2/.test(url)) {
    const jwt = decodeURIComponent(/assertion=([^&]+)/.exec(init.body)[1]).split('.');
    const ok = crypto.createVerify('RSA-SHA256').update(jwt[0] + '.' + jwt[1]).verify(publicKey, Buffer.from(jwt[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const claim = JSON.parse(Buffer.from(jwt[1], 'base64').toString());
    assert.ok(ok && claim.iss === sa.client_email && /analytics\.readonly/.test(claim.scope), 'a signed, read-only sign-in');
    return new Response(JSON.stringify({ access_token: 'tok' }));
  }
  assert.ok(/properties\/561631629:runReport$/.test(url) && init.headers.Authorization === 'Bearer tok');
  const b = JSON.parse(init.body); asked.push(b);
  const dim = b.dimensions && b.dimensions[0].name;
  const row = (d, ms) => ({ dimensionValues: d ? [{ value: d }] : [], metricValues: ms.map((v) => ({ value: String(v) })) });
  const rows = dim === 'date' ? [row('20261123', [5, 3, 6, 20, 4, 61.5])] : dim === 'pagePath' ? [row('/', [40, 12])] : !dim ? [row(null, [30, 20, 40, 90, 0.6, 70])] : [row('x', b.metrics.map(() => 1))];
  return new Response(JSON.stringify({ dimensionHeaders: dim ? [{ name: dim }] : [], metricHeaders: b.metrics.map((m) => ({ name: m.name })), rows }));
};

(async () => {
  const g = await GA.collect(JSON.stringify(sa), '561631629');
  assert.deepStrictEqual(g.daily[0], { date: '2026-11-23', activeUsers: 5, newUsers: 3, sessions: 6, screenPageViews: 20, engagedSessions: 4, averageSessionDuration: 61.5 });
  assert.deepStrictEqual(g.pages[0], { pagePath: '/', screenPageViews: 40, activeUsers: 12 });
  assert.equal(g.totals.activeUsers, 30, 'the 28-day totals');
  assert.ok(g.countries.length && g.devices.length && g.sources.length && g.channels.length && g.events.length && g.installs.length, 'every top list');
  assert.ok(asked.some((b) => b.dimensionFilter && b.dimensionFilter.filter.stringFilter.value === 'copy_install'), 'install copies by method');
  console.log('PASS GA4 for the stats page: a signed read-only sign-in, daily numbers and top lists, rows flattened');
})().catch((e) => { console.error(e); process.exitCode = 1; });
