/* Runs before the app's scripts: settings for the mock provider, and a record of page errors. */
'use strict';
try {
  var cfg = JSON.parse(require('fs').readFileSync(require('path').join(require('os').tmpdir(), 'tivibro-engines.json'), 'utf8'));
  if (!sessionStorage.getItem('tb-engines')) {
    localStorage.clear();
    localStorage.setItem('tivibro.settings', cfg.settings);
    sessionStorage.setItem('tb-engines', '1');
  }
  localStorage.setItem('tivibro.devRelay', cfg.relay);
} catch (e) {}
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message) + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', function (e) { window.__errs.push('unhandled rejection: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
