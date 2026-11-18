/* The recording agent (rooted TVs): the jailed helper sees no USB drive, so it hands /record/ requests to the agent
   (record.js run as root outside the jail), started through the Homebrew Channel's root exec; with the agent's
   secret, and the file without it (the TV's player can't send one). */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-agent-'));
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
// The helper: no drive in its jail (an empty /tmp/usb), its storage for the agent's key.
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'jail-usb'); fs.mkdirSync(process.env.TIVIBRO_USB_DIR);
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'helper-list.json');
process.env.TIVIBRO_REC_AGENT_PORT = '47920';
const R = require('../../service/record');
function get(p, h) { return new Promise((f) => { http.get({ hostname: '127.0.0.1', port: 47930, path: p, headers: h || {} }, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => f({ code: res.statusCode, b })); }).on('error', (e) => f({ code: 0, b: e.message })); }); }
(async () => {
  // The helper's relay, with record.js as in the helper.
  const relay = http.createServer((req, res) => R.handle(req, res, {}, () => {}));
  await new Promise((f) => relay.listen(47930, '127.0.0.1', f));
  let launched = null, agent = null;
  // The Homebrew Channel's exec: starts the agent with the command's secret, outside the "jail" (a real USB folder).
  R.setCall((uri, params, cb) => {
    launched = { uri, cmd: params.command };
    const key = (/TIVIBRO_REC_CTL=([0-9a-f]+)/.exec(params.command) || [])[1];
    const usb = path.join(tmp, 'usb'); fs.mkdirSync(path.join(usb, 'sda', 'sda'), { recursive: true });
    agent = cp.spawn(process.execPath, [path.join(__dirname, '../../service/record-agent.js')], { env: Object.assign({}, process.env, { TIVIBRO_REC_CTL: key, TIVIBRO_USB_DIR: usb, TIVIBRO_REC_LIST: path.join(tmp, 'agent-list.json'), TIVIBRO_REC_AGENT_PORT: '47920' }), stdio: 'ignore' });
    cb({ returnValue: true });
  });
  let r = await get('/record/drives');
  const j = JSON.parse(r.b || '{}');
  ok('no drive in the jail: the agent is started through the Homebrew Channel', launched && /hbchannel\.service\/exec$/.test(launched.uri) && /nohup .*record-agent\.js/.test(launched.cmd), JSON.stringify(launched));
  ok('and answers for the helper: the drive it can reach', r.code === 200 && j.drives && j.drives.length === 1 && /usb\/sda\/sda$/.test(j.drives[0].dir), r.code + ' ' + r.b);
  r = await new Promise((f) => http.get({ hostname: '127.0.0.1', port: 47920, path: '/record/list' }, (res) => { res.resume(); f({ code: res.statusCode }); }).on('error', () => f({ code: 0 })));
  ok('the agent refuses a request without its secret', r.code === 403, r.code);
  r = await new Promise((f) => http.get({ hostname: '127.0.0.1', port: 47920, path: '/record/file/none' }, (res) => { res.resume(); f({ code: res.statusCode }); }).on('error', () => f({ code: 0 })));
  ok('but a file needs none (the TV\'s player can\'t send it)', r.code === 404, r.code);
  launched = null;
  r = await get('/record/list');
  ok('an agent already running is used, not started again', r.code === 200 && launched === null, r.code + ' ' + JSON.stringify(launched));
  if (agent) agent.kill();
  relay.close(); R._reset();
  await wait(100);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fail) { console.log(fail + ' agent test(s) failed'); process.exit(1); }
  console.log('all recording agent tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
