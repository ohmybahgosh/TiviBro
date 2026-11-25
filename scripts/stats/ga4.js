/* tivibro.app's Google Analytics numbers for the stats dashboard, read by the Stats workflow with a service
   account that has Viewer access to the GA4 property (the Play upload account's key, already a repo secret).
   Only totals and top lists, never anything about one visitor.  GA4 counts only visitors who chose Allow.
     const GA = require('./ga4.js');  GA.collect(serviceAccountJson, propertyId) -> Promise<{ daily, pages, ... }>
   No packages: the OAuth sign-in is a JWT signed with node's crypto. */
'use strict';
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// An access token for the service account (one hour), from Google's token endpoint with a signed JWT.
async function token(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key));
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + sig
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google sign-in: ' + r.status + ' ' + (j.error_description || j.error || ''));
  return j.access_token;
}

// One runReport, flattened to rows of { <dimension>: value, <metric>: number }.
async function report(tok, property, body) {
  const r = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + property + ':runReport', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('GA4 ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 200));
  const dims = (j.dimensionHeaders || []).map((h) => h.name), mets = (j.metricHeaders || []).map((h) => h.name);
  return (j.rows || []).map((row) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = row.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = +row.metricValues[i].value; });
    return o;
  });
}

/* Everything the dashboard shows from GA4: each of the last 30 days (merged by date on the page, so the history
   grows past GA's own window), and top lists for the last 28 days. */
async function collect(saJson, property) {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
  const tok = await token(sa);
  const last28 = [{ startDate: '28daysAgo', endDate: 'yesterday' }];
  const top = (dim, metrics, limit, filter) => report(tok, property, Object.assign({ dateRanges: last28, dimensions: [{ name: dim }], metrics: metrics.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: metrics[0] }, desc: true }], limit: limit }, filter ? { dimensionFilter: filter } : {}));
  const event = (name) => ({ filter: { fieldName: 'eventName', stringFilter: { value: name } } });
  const [daily, pages, sources, channels, countries, devices, events, installs, totals] = await Promise.all([
    report(tok, property, { dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'date' }],
      metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagedSessions', 'averageSessionDuration'].map((name) => ({ name })), orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    top('pagePath', ['screenPageViews', 'activeUsers'], 15),
    top('sessionSource', ['sessions', 'activeUsers'], 15),
    top('sessionDefaultChannelGroup', ['sessions'], 10),
    top('country', ['activeUsers'], 25),
    top('deviceCategory', ['activeUsers'], 5),
    top('eventName', ['eventCount'], 25),
    top('customEvent:install_method', ['eventCount'], 10, event('copy_install')).catch(() => []),
    report(tok, property, { dateRanges: last28, metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'].map((name) => ({ name })) })
  ]);
  // GA's dates are yyyymmdd in the property's time zone.
  daily.forEach((d) => { d.date = d.date.slice(0, 4) + '-' + d.date.slice(4, 6) + '-' + d.date.slice(6, 8); });
  return { daily, totals: totals[0] || {}, pages, sources, channels, countries, devices, events, installs };
}

module.exports = { collect, token, report };
