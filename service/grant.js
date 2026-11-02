/* TiviBro's helper asks for two permissions it is refused in developer mode (service/grant.sh says
   which and why).  On a rooted TV the Homebrew Channel can run grant.sh as root; the helper does that
   once when TiviBro opens, if the TV's manifest for TiviBro doesn't list the extra permissions yet
   (an in-app update writes it afresh).  The groups apply to the helper from its next start.
   Not rooted, or the manifest can't be read: nothing happens, and the helper keeps its fallbacks
   (a reminder shows even if the screensaver is on). */
'use strict';
var fs = require('fs'), path = require('path');
var DIR = '/var/luna-service2-dev';
var PERMS = DIR + '/client-permissions.d/app.tivibro.tv.service.perms.json';

function create(opts) {
  var call = opts.call, log = opts.log || function () {}, dir = opts.dir || DIR;
  var manifest = dir + '/manifests.d/app.tivibro.tv.json', perms = dir + '/client-permissions.d/app.tivibro.tv.service.perms.json';
  var tried = false;
  // true: missing; false: there; null: can't tell (no manifest, or not readable from here).
  function missing() {
    try { var m = JSON.parse(fs.readFileSync(manifest, 'utf8')); return (m.clientPermissionFiles || []).indexOf(perms) < 0; }
    catch (e) { return null; }
  }
  function ensure(cb) {
    cb = cb || function () {};
    if (tried) return cb('already tried');
    var need = missing();
    if (need !== true) return cb(need === false ? 'granted' : 'unknown');
    tried = true;
    call('luna://org.webosbrew.hbchannel.service/exec', { command: 'sh ' + JSON.stringify(path.join(opts.here || __dirname, 'grant.sh')) }, function (res) {
      var out = String(res && (res.stdoutString || res.stdout) || '').trim();
      var ok = res && res.returnValue !== false && /granted/.test(out);
      log({ lv: ok ? 'info' : 'warn', event: ok ? 'permissions added (power state, app in front)' : 'permissions not added', e: ok ? undefined : (res && (res.errorText || res.stderrString)) || out || 'no answer' });
      cb(ok ? 'added' : 'failed');
    });
  }
  return { ensure: ensure, missing: missing };
}
module.exports = { create: create, PERMS: PERMS };
