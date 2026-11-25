/* The helper on this computer, for the simulator and the browser tests: the relay on 47811, and the
   phone app connection (service/companion.js) with its state in service/companion.json (git-ignored)
   or COMPANION_DIR.  Opening TiviBro is only logged here. */
const path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let relay = null;
const companion = require(path.join(__dirname, '../../service/companion.js')).create({
  dir: process.env.COMPANION_DIR || path.join(__dirname, '../../service'),
  log: (o) => proxy.log(o),
  version: 'dev',
  launch: (params, cb) => { console.log('companion: would open TiviBro with ' + JSON.stringify(params)); cb(null); },
  sysinfo: (cb) => cb({ model: 'DEV', webos: 'dev', name: '' }),
  // TiviBro on screen, unless a test put it "behind another app" with the file dev-away beside companion.json.
  app: () => ({ open: true, visible: !require('fs').existsSync(path.join(process.env.COMPANION_DIR || path.join(__dirname, '../../service'), 'dev-away')) }),
  editor: () => (relay ? relay.editor : null)
});
relay = proxy.create({ companion });
relay.server.listen(47811, '127.0.0.1', () => console.log('dev relay on 47811'));
if (companion.on) companion.start(() => console.log('phone app connection on port ' + companion.port));

/* HELPER_BOX=<folder>: the real helper's lag timer and black box (service/lag.js, wired as service/service.js does),
   writing helper-state.json there, for tests/soak/helper-57k.js on the Node version a TV runs. */
if (process.env.HELPER_BOX) {
  const Lag = require(path.join(__dirname, '../../service/lag.js'));
  const doing = () => Object.assign(Lag.mem(), { requests: relay.stats.active });
  Lag.create({ log: (o) => proxy.log(o), doing });
  const box = Lag.blackbox({ file: path.join(process.env.HELPER_BOX, 'helper-state.json'), log: (o) => proxy.log(o), doing,
    recent: () => proxy.LOG.slice(-4).map((x) => x.event || ((x.s || '...') + ' ' + String(x.u || '').split('?')[0].split('/').pop())) });
  proxy.watchLog(() => box.mark());
  // The helper's own routes aren't in its request log: note the guide's and the lists', with the memory then.
  relay.server.on('request', (req) => { if (/^\/(guide|lists|vod|store)\//.test(req.url)) proxy.log({ lv: 'debug', event: 'route ' + req.url.split('?')[0], mem: Lag.mem() }); });
  process.on('SIGTERM', () => { box.close(); process.exit(0); });
}
