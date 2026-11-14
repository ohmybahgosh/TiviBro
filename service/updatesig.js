/* Update signatures.  The in-app updater installs the IPK a release's manifest names, after the Homebrew Channel
   checks its SHA-256 against the manifest.  The manifest is read through the relay, which can't check a server's
   certificate (providers' are often broken), so on its own it could be swapped by someone on the network: a
   different IPK with a matching checksum.  So each release build signs what matters in its manifest with a key
   only the build has (scripts/gen-manifest.js, the UPDATE_SIGNING_KEY secret), and the app installs an update only
   when this public key verifies it.  RSA-SHA256, which every webOS Node has (0.12 on).
     POST /update/verify  { version, ipkUrl, sha256, sig }  ->  { ok: true|false } */
'use strict';
var crypto = require('crypto');
var PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAr7+8y7TZvF8n5Nim9A3x',
  'rTb6GgjM03KizYPsOCNcFnfizRYURWnBM2IRAuwd2WQL+xU1/kJZlQNpDlUEJ99x',
  'wFZk5WhUbFd9L/ttX/o5VoKHskHK0VVbCpamgL8gYIKSGBtioX7epLNZPQgPO5Cy',
  'OTjJgFAOh1RCDgNH/1qFoqIwj3P/BnEDgwXVZJ2w9eIKC/k1vETMIEfqmp+rCoxW',
  'rw+CrAom08FlMi2W7rIW85r4sfuZDESLFa9nmHGLgVH5BEBKTmVLPIoz07aPoLL7',
  'HaW7R0PLaPHBnO+tjBsVCZ0wbanqYsEwlL8z5/izbkfGq4m1Nmo3NAAzDq0U65pP',
  'tOKXxQ5cGBh7YdSzvSsYa0fEPF59XCicOUsi9t0c54BXsOzISJ6aQSkDu/U+uzqy',
  'JJCLKeLh2dS8cBSEQ+yTbtAdGYZr6eHlI6jvlywrNfG6SPG93tmuvyHGNvEs3I7Z',
  'V+cnWxuHXhihtOjr9Zcq6kQJc41jBtxlC6U866jW3pNLAgMBAAE=',
  '-----END PUBLIC KEY-----', ''].join('\n');

/* A second key, kept offline for one purpose: if the build's key is ever lost or has to be replaced, releases
   signed with this one still install on every TV that has this version or later.  Its private half is not in
   the repository or the build. */
var BACKUP_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA15h18CzhnI0AsH0ozzoH',
  'va8WFeqDhvZawKVeCsWlx3HnNWuP+5P4Jm6ODDbhfJ+KwnV2bpqMR6Ww8PFy2KTU',
  'fjcf1jyWGkXJ7W7q23yi0fvbJENdFX9MyFLznmZuJVzwHYNouOu/AOmvQ7ItsvLG',
  'c+Tr+2kNHKtZx0EnIvQ4TrqxETpUhNl3UDbRpLMcsZVKYh1BiNvEbd/0t1/OmpWT',
  '0nyn3gaTXbJh/JeV1JHNVow6dF8H8QM3C21rB3UYrLWLlwv1VeKs5K+MdIp3bSpb',
  'qjdvrHqlz7njjpvnLbTBxN4ZXrBCaT346QPNKygd2ecKMTSafBBjIaCq7dk7tILc',
  'ngLkaupSFAq7Kk8CHtXceT49TG4hJk7cd3JEijIvnNPXpOuj52/LrgZhp7PARPXB',
  'eG+usen5YfM9UA0P3Dzj5wENrkdR+zbE3EAAd4362tb4303yvZ+W8Jdc71XEYhaY',
  'qbw6ZYBqeMDFBcODmFAsa5LH36arF50wa9pMCvnhMK8fAgMBAAE=',
  '-----END PUBLIC KEY-----', ''].join('\n');

// What is signed: the package version, the IPK's address and its SHA-256, one per line.
function message(m) { return 'tivibro-update-v1\n' + String(m.version || '') + '\n' + String(m.ipkUrl || '') + '\n' + String(m.sha256 || '').toLowerCase(); }
function verifyWith(m, key) {
  try { var v = crypto.createVerify('RSA-SHA256'); v.update(message(m), 'utf8'); return v.verify(key, m.sig, 'base64'); } catch (e) { return false; }
}
// Either key will do (the build's, or the backup); a key given is the only one tried (tests, the build's check).
function verify(m, key) {
  if (!m || typeof m.sig !== 'string' || !/^[A-Za-z0-9+/=]{100,2000}$/.test(m.sig) || !/^[0-9a-f]{64}$/i.test(String(m.sha256 || ''))) return false;
  if (key) return verifyWith(m, key);
  return verifyWith(m, PUBLIC_KEY) || verifyWith(m, BACKUP_KEY);
}
function sign(m, privateKeyPem) { var s = crypto.createSign('RSA-SHA256'); s.update(message(m), 'utf8'); return s.sign(privateKeyPem, 'base64'); }

function handle(req, res, ALLOW) {
  var body = '', over = false;
  req.on('data', function (c) { if (over) return; body += c; if (body.length > 16384) { over = true; reply(413, { ok: false }); req.destroy(); } });
  req.on('end', function () {
    if (over) return;
    var j = null; try { j = JSON.parse(body); } catch (e) {}
    reply(200, { ok: verify(j) });
  });
  function reply(code, o) { var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; for (var k in ALLOW) h[k] = ALLOW[k]; res.writeHead(code, h); res.end(JSON.stringify(o)); }
}
module.exports = { verify: verify, sign: sign, message: message, handle: handle, PUBLIC_KEY: PUBLIC_KEY, BACKUP_KEY: BACKUP_KEY };
