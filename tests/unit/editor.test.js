// Web editor server: password, lockout, auth on every API call, and the save -> app -> snapshot loop.
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
function req(url, method, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(url), data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Token': token } : {}) }, (resp) => {
      let b = ''; resp.on('data', d => b += d); resp.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} res({ status: resp.statusCode, json: j, text: b }); });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
(async () => {
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const C = 'http://127.0.0.1:' + r.server.address().port;
  let a = await req(C + '/editor/start', 'POST', { port: 0, password: 'ABCD-EFGH' });
  ok('editor starts', a.status === 200 && a.json.running, a.text);
  const port = (await req(C + '/editor/status')).json.port;
  ok('listens on a port', port > 0, port);
  a = await req(C + '/editor/start', 'POST', { port: 47811, password: 'ABCD-EFGH' });
  ok("refuses the helper's own ports", a.status === 400 && /cannot be used/.test(a.json.error), a.text);
  a = await req(C + '/editor/start', 'POST', { port: 80, password: 'ABCD-EFGH' });
  ok('refuses ports below 1024', a.status === 400, a.text);
  ok('and keeps running where it was', (await req(C + '/editor/status')).json.port === port);
  const L = 'http://127.0.0.1:' + port;
  a = await req(L + '/');
  ok('serves the editor page', a.status === 200 && /TiviBro Editor/.test(a.text));
  a = await req(L + '/api/state');
  ok('API refuses without login', a.status === 401);
  a = await req(L + '/api/login', 'POST', { password: 'abcdefgh' });
  ok('accepts the password without dash, any case', a.status === 200 && a.json.token);
  const T = a.json.token;
  a = await req(L + '/api/state', 'GET', null, T);
  ok('no data until the TV sends it', a.status === 503);
  await req(C + '/editor/snapshot', 'POST', { playlist: { name: 'P' }, groups: [{ id: 'g1', name: 'News' }], channels: [{ k: 'x1', n: 'CNN', g: 'g1' }], edits: { hiddenGroups: {} } });
  a = await req(L + '/api/state', 'GET', null, T);
  ok('browser gets the snapshot', a.status === 200 && a.json.data.channels.length === 1);
  ok('snapshot holds no stream links or logins', !/password|server|url/i.test(JSON.stringify(a.json.data)));
  a = await req(L + '/api/save', 'POST', { edits: { hiddenGroups: { g1: 1 } } }, T);
  ok('browser save accepted', a.status === 200 && a.json.pendingRev === 1);
  a = await req(C + '/editor/pending?since=0');
  ok('app receives the save', a.json.rev === 1 && a.json.edits.hiddenGroups.g1 === 1);
  a = await req(C + '/editor/pending?since=1');
  ok('nothing new after applying', a.json.none === true);
  await req(C + '/editor/snapshot', 'POST', { playlist: { name: 'P' }, groups: [], channels: [], edits: {}, appliedRev: 1 });
  a = await req(L + '/api/rev', 'GET', null, T);
  ok('browser sees the TV applied it', a.json.appliedRev === 1);
  // draft autosave: the browser posts unsent work, the app stores it and says so with dsince
  a = await req(L + '/api/draft', 'POST', { state: '{"E":{}}' }, null);
  ok('drafts need a login', a.status === 401);
  a = await req(L + '/api/draft', 'POST', { state: '{"E":{"hiddenGroups":{"g1":1}}}', playlist: 'p1', changes: 1, label: 'Hide News', kind: 'weird' }, T);
  ok('draft accepted', a.status === 200 && a.json.seq === 1, a.text);
  a = await req(C + '/editor/pending?since=1&csince=0&dsince=0');
  ok('app receives the draft', a.json.draft && a.json.draft.seq === 1 && a.json.draft.kind === 'auto' && a.json.draft.label === 'Hide News' && a.json.draft.playlist === 'p1', JSON.stringify(a.json.draft));
  a = await req(L + '/api/rev', 'GET', null, T);
  ok('not yet stored on the TV', a.json.draftSeq === 1 && a.json.draftAck === 0);
  a = await req(C + '/editor/pending?since=1&csince=0&dsince=1');
  ok('once stored, it is not sent again', !a.json.draft);
  a = await req(L + '/api/rev', 'GET', null, T);
  ok('and the browser sees it is safe on the TV', a.json.draftAck === 1);
  a = await req(L + '/api/draft', 'POST', { changes: 1 }, T);
  ok('a draft needs its state', a.status === 400);
  // commands: browser asks, app picks up, app answers, browser reads the answer
  a = await req(L + '/api/command', 'POST', { type: 'refreshPlaylist', args: {} }, T);
  ok('browser can queue an action', a.status === 200 && a.json.id === 1);
  a = await req(C + '/editor/pending?since=1&csince=0');
  ok('app sees the queued action', a.json.commands.length === 1 && a.json.commands[0].type === 'refreshPlaylist');
  a = await req(L + '/api/result?id=1', 'GET', null, T);
  ok('no answer before the app replies', a.json.done === false);
  await req(C + '/editor/result', 'POST', { id: 1, ok: true, msg: 'Reloaded', data: { n: 5 } });
  a = await req(L + '/api/result?id=1', 'GET', null, T);
  ok('browser gets the answer and data', a.json.done && a.json.ok && a.json.data.n === 5);
  a = await req(C + '/editor/pending?since=1&csince=0');
  ok('answered actions leave the queue', a.json.commands.length === 0);
  // backups are locked with a passphrase before the browser sees them
  a = await req(L + '/api/command', 'POST', { type: 'backup', args: {} }, T);
  ok('backup needs a passphrase', a.status === 400);
  a = await req(L + '/api/command', 'POST', { type: 'backup', args: { passphrase: 'correct horse battery' } }, T);
  const bid = a.json.id;
  a = await req(C + '/editor/pending?since=1&csince=1');
  ok('the app never sees the passphrase', a.json.commands[0].type === 'backup' && !JSON.stringify(a.json.commands).includes('horse'));
  const backup = { app: 'TiviBro', kind: 'backup', format: 2, version: '0.6.0', created: new Date().toISOString(), settings: { playlists: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://prov.example:8080', user: 'viewer42', pass: 'SECRETPASS' }] }, edits: {}, snaps: { p1: [{ id: 's1' }] } };
  await req(C + '/editor/result', 'POST', { id: bid, ok: true, msg: 'Backup ready', data: backup });
  for (let i = 0; i < 40; i++) { a = await req(L + '/api/result?id=' + bid, 'GET', null, T); if (a.json.done) break; await new Promise(f => setTimeout(f, 100)); }
  ok('browser gets a locked file', a.json.done && a.json.ok && a.json.data.kind === 'backup-encrypted');
  ok('the locked file holds no readable login', !/SECRETPASS|viewer42|prov\.example/.test(JSON.stringify(a.json.data)));
  const file = a.json.data;
  a = await req(L + '/api/restore', 'POST', { file, passphrase: 'wrong passphrase', check: true }, T);
  ok('wrong passphrase is refused', a.status === 400 && /passphrase/i.test(a.json.error));
  const tampered = Object.assign({}, file, { data: file.data.slice(0, -4) + 'AAAA' });
  a = await req(L + '/api/restore', 'POST', { file: tampered, passphrase: 'correct horse battery', check: true }, T);
  ok('a changed file is refused', a.status === 400);
  a = await req(L + '/api/restore', 'POST', { file, passphrase: 'correct horse battery', check: true }, T);
  ok('right passphrase unlocks and describes it', a.status === 200 && a.json.summary.playlists[0].host === 'prov.example' && a.json.summary.restorePoints === 1);
  ok('the description holds no login', !/SECRETPASS|"viewer42"/.test(JSON.stringify(a.json)));
  a = await req(L + '/api/restore', 'POST', { file, passphrase: 'correct horse battery' }, T);
  const rid = a.json.id;
  a = await req(C + '/editor/pending?since=1&csince=' + bid);
  const rc = a.json.commands.filter(c => c.id === rid)[0];
  ok('restore reaches the app unlocked', rc && rc.type === 'restore' && rc.args.data.settings.playlists[0].pass === 'SECRETPASS');
  a = await req(L + '/api/command', 'POST', { type: 'restore', args: { data: backup } }, T);
  ok('restore cannot skip the unlock step', a.status === 400);
  // guide download progress: app posts it, browser reads it with the revision poll
  await req(C + '/editor/progress', 'POST', { active: true, phase: 'download', bytes: 5, total: 10 });
  a = await req(L + '/api/rev', 'GET', null, T);
  ok('browser sees guide progress', a.json.progress && a.json.progress.bytes === 5 && a.json.progress.at > 0);
  ok('browser sees when the TV last checked in', a.json.tvSeen > 0 && a.json.now >= a.json.tvSeen);
  a = await req(L + '/api/command', 'POST', { type: 'backup' });
  ok('actions need a login', a.status === 401);
  for (let i = 0; i < 5; i++) a = await req(L + '/api/login', 'POST', { password: 'WRONG' });
  a = await req(L + '/api/login', 'POST', { password: 'ABCD-EFGH' });
  ok('locks out after 5 wrong passwords, even the right one', a.status === 429, a.status);
  await req(C + '/editor/stop', 'POST', {});
  a = await req(L + '/').catch(() => ({ status: 0 }));
  ok('stops when switched off', a.status === 0);
  // Nothing from a stopped session may reach a TiviBro that starts counting from zero again.
  a = await req(C + '/editor/pending?since=0&csince=0');
  ok('stopping drops unapplied saves and actions', a.json.none === true && !(a.json.commands || []).length, JSON.stringify(a.json).slice(0, 120));
  a = await req(C + '/editor/status');
  ok('and reports them as applied, so a new start skips them', a.json.appliedRev === a.json.pendingRev, a.json.appliedRev + ' / ' + a.json.pendingRev);
  r.server.close();
  console.log(fail ? fail + ' failures' : 'all web editor tests passed');
  process.exit(fail ? 1 : 0);
})();
