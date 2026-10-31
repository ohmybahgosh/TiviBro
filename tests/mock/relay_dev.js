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
  app: () => ({ open: true, visible: true }),
  editor: () => (relay ? relay.editor : null)
});
relay = proxy.create({ companion });
relay.server.listen(47811, '127.0.0.1', () => console.log('dev relay on 47811'));
if (companion.on) companion.start(() => console.log('phone app connection on port ' + companion.port));
