/* webOS JS service wrapper for the relay.  The app subscribes to "start"; while that
   subscription is open (and an activity holds the service), the relay keeps running.
   When the app closes, the subscription drops and the service shuts down on its own, unless the
   phone app connection is on (companion.js): then the helper stays, with only that LAN server
   running, and an activity every 5 minutes brings it back after the TV restarts or webOS stops it.
   install.sh also adds one that isn't part of the package (an update removes the package's own); the
   wake call below ends either for good once the phone app connection is off. */
'use strict';
var Service = require('webos-service');
var proxy = require('./proxy');

var service = new Service('app.tivibro.tv.service');
process.on('uncaughtException', function (e) { proxy.log({ lv: 'error', event: 'uncaught exception', e: e && (e.stack || e.message) }); });
var crypto = require('crypto');
var relay = null, port = 0, subs = 0, activity = null, idleTimer = null;
// Only TiviBro may switch the web editor and the phone app connection (see proxy.js): it gets this with the start reply.
var CTL = crypto.randomBytes(16).toString('hex');
var PORTS = [47811, 47812, 47813, 47814, 47815];
// Reminders while TiviBro is closed (remind.js): the activity manager calls "fire" at reminder time.
var alertN = 0;
function lcallP(uri, params, cb) { try { service.call(uri, params, function (m) { cb(m && m.payload || {}); }); } catch (e) { cb({ returnValue: false, errorText: e.message }); } }
var reminders = require('./remind').create({
  call: lcallP,
  log: function (o) { proxy.log(o); },
  // Rooted TVs: the alert the TV refuses TiviBro, sent as root by alert.sh through the Homebrew Channel.
  // The alert goes in a file; the command line only ever carries a number.
  rootAlert: function (alert, cb) {
    var n = (Date.now() % 1e9) * 10 + (alertN++ % 10), f = require('path').join(__dirname, 'alert-' + n + '.json');
    try { require('fs').writeFileSync(f, JSON.stringify(alert)); } catch (e) { return cb(false, 'not written: ' + e.message); }
    lcallP('luna://org.webosbrew.hbchannel.service/exec', { command: 'sh ' + JSON.stringify(require('path').join(__dirname, 'alert.sh')) + ' ' + n }, function (res) {
      var out = String(res && (res.stdoutString || res.stdout) || '');
      try { require('fs').unlinkSync(f); } catch (e) {}
      var id = /"alertId"\s*:\s*"([A-Za-z0-9._\-]{1,80})"/.exec(out);
      cb(res && res.returnValue !== false && /"returnValue"\s*:\s*true/.test(out), (res && res.errorText) || out.slice(0, 200), id ? id[1] : '');
    });
  },
  // And closed again as root after a few seconds (an alert made as root may only be closed by root).
  rootClose: function (id, cb) {
    if (!/^[A-Za-z0-9._\-]{1,80}$/.test(id || '')) return cb(false);
    lcallP('luna://org.webosbrew.hbchannel.service/exec', { command: 'sh ' + JSON.stringify(require('path').join(__dirname, 'alert.sh')) + ' close ' + id }, function (res) { cb(res && res.returnValue !== false); });
  }
});

// Rooted TVs: the two permissions developer mode leaves out (grant.js), added once through the Homebrew Channel.
var grant = require('./grant').create({
  call: function (uri, params, cb) { try { service.call(uri, params, function (m) { cb(m && m.payload || {}); }); } catch (e) { cb({ returnValue: false, errorText: e.message }); } },
  log: function (o) { proxy.log(o); }
});

proxy.log({ lv: 'info', event: 'service loaded', node: process.version });

/* The TV's power changes (turned off, standby), kept in power.json, so the app can tell that its last
   session ended because the TV went off, not because it crashed.  Best effort: the call may be refused. */
var fs = require('fs'), path = require('path'), POWER = path.join(__dirname, 'power.json'), powerSub = null;
/* The TV's power state now ("Active", "Screen Off", "Active Standby"…), for the phone app: a TV kept on the network in
   standby (Quick Start+, a USB network adapter's Wi-Fi standby) still answers it, and is off to whoever holds the phone. */
var powerNow = '';
try { proxy.SYS.power = JSON.parse(fs.readFileSync(POWER, 'utf8')) || []; } catch (e) {}
function watchPower() {
  if (powerSub) return;
  try {
    powerSub = service.subscribe('luna://com.webos.service.tvpower/power/getPowerState', { subscribe: true });
    powerSub.on('response', function (m) {
      var st = m && m.payload && m.payload.state;
      if (st) powerNow = String(st).slice(0, 40);
      if (!st || st === 'Active' || st === 'Screen Off') return;
      proxy.SYS.power.push({ t: Date.now(), state: String(st).slice(0, 40) });
      proxy.SYS.power = proxy.SYS.power.slice(-10);
      try { fs.writeFileSync(POWER, JSON.stringify(proxy.SYS.power)); } catch (e) {}
    });
  } catch (e) { proxy.log({ lv: 'warn', event: 'power state not available', e: e.message }); }
}

function listen(i, cb) {
  if (relay && port) return cb(null, port);
  if (i >= PORTS.length) { proxy.log({ lv: 'error', event: 'no free port', tried: PORTS }); return cb(new Error('no free port (tried ' + PORTS.join(', ') + ')')); }
  relay = proxy.create({ companion: companion, ctl: CTL });
  relay.server.once('error', function (e) {
    proxy.log({ lv: 'error', event: 'listen failed', port: PORTS[i], e: e.code || e.message });
    relay = null; listen(i + 1, cb);
  });
  relay.server.listen(PORTS[i], '127.0.0.1', function () { port = PORTS[i]; proxy.log({ lv: 'info', event: 'relay listening', port: port }); cb(null, port); });
}

/* The phone app connection.  TiviBro is opened with launch params when a phone asks for it. */
var APP = 'app.tivibro.tv', WAKE = 'tivibro-companion', AM = 'luna://com.palm.activitymanager';
function lcall(uri, params, cb) {
  try { service.call(uri, params, function (m) { cb((m && m.payload) || {}); }); } catch (e) { cb({ returnValue: false, errorText: e.message }); }
}
var companion = require('./companion').create({
  dir: __dirname, alt: function () { return require('./kv').sub('companion'); }, log: function (o) { proxy.log(o); }, version: require('./package.json').version,
  launch: function (params, cb) {
    lcall('luna://com.webos.applicationManager/launch', { id: APP, params: params }, function (r) {
      cb(r.returnValue === false ? new Error(r.errorText || 'the TV refused') : null);
    });
  },
  sysinfo: function (cb) {
    lcall('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'sdkVersion'] }, function (r) {
      var out = { model: r.modelName || '', webos: r.sdkVersion || '' };
      lcall('luna://com.webos.settingsservice/getSystemSettings', { category: 'network', keys: ['deviceName', 'wolwowlOnOff', 'bleAdvertisingOnOff'] }, function (n) {
        out.name = (n.settings && n.settings.deviceName) || '';
        // "Turn on via Wi-Fi" (Mobile TV On): what lets the phone wake the TV.
        out.wol = n.settings && n.settings.wolwowlOnOff != null ? String(n.settings.wolwowlOnOff) === 'true' : null;
        // Bluetooth advertising: what lets the phone wake the TV over Bluetooth (blewake.js).
        out.woble = n.settings && n.settings.bleAdvertisingOnOff != null ? String(n.settings.bleAdvertisingOnOff) === 'on' : null;
        // The built-in Wi-Fi and Ethernet cards, for Wake-on-LAN even when another card (a USB adapter) is in use.
        lcall('luna://com.webos.service.connectionmanager/getinfo', {}, function (c) {
          out.macs = [c.wiredInfo, c.wifiInfo].map(function (x) { return x && x.macAddress ? String(x.macAddress).toLowerCase() : ''; }).filter(Boolean);
          // The TV's own Bluetooth address, which the phone puts in its wake advertisement (as ThinQ does).
          lcall('luna://com.webos.service.bluetooth2/adapter/getStatus', {}, function (b) {
            var ad = Array.isArray(b.adapters) && b.adapters[0], bt = String(ad && ad.adapterAddress || '').toLowerCase();
            out.bt = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bt) ? bt : '';
            proxy.log({ lv: 'info', event: 'companion: this TV', model: out.model, webos: out.webos, name: out.name, wol: out.wol, cards: out.macs.length,
              bt: !!out.bt, woble: out.woble, btError: b.returnValue === false ? (b.errorText || b.errorCode) : undefined });
            cb(out);
          });
        });
      });
    });
  },
  app: function () { return { open: subs > 0, visible: reminders.visible }; },
  power: function () { return powerNow; },
  // The TV's own volume, for the phone's remote (works whether TiviBro is open or not).
  volume: function (dir, cb) {
    var A = 'luna://com.webos.service.audio/master/';
    function read() {
      lcall(A + 'getVolume', {}, function (v) {
        var s = v.volumeStatus || v;
        cb(null, v.returnValue === false ? null : { level: +(s.volume != null ? s.volume : -1), muted: !!(s.muteStatus != null ? s.muteStatus : s.muted) });
      });
    }
    if (dir === 'mute') {
      return lcall(A + 'getVolume', {}, function (v) {
        var s = v.volumeStatus || v, muted = !!(s.muteStatus != null ? s.muteStatus : s.muted);
        lcall(A + 'muteVolume', { muteVolume: !muted }, function (r) { if (r.returnValue === false) return cb(new Error(r.errorText || 'refused')); read(); });
      });
    }
    lcall(A + (dir === 'up' ? 'volumeUp' : 'volumeDown'), {}, function (r) { if (r.returnValue === false) return cb(new Error(r.errorText || 'refused')); read(); });
  },
  // Wake on BLE: the phone's made-up Bluetooth address, registered with the TV's asc service (blewake.js).
  blewake: require('./blewake').create({ call: lcall, log: function (o) { proxy.log(o); } }).handle,
  editor: function () { return relay ? relay.editor : null; },
  onSwitch: function (on) { if (on) { hold(); wake(true); watchPower(); } else { wake(false); if (!subs) release(); } }
});
/* Every 5 minutes the activity manager calls "wake", which starts the helper if it isn't running
   (after the TV restarted, or webOS stopped it).  Persistent, so it outlives a restart.  That alone left the
   phone app saying the TV was off for up to five minutes after it was turned on, until TiviBro was opened.  So a
   second one is called the moment the TV's power state says it is on: at start-up, and on waking from standby. */
var WAKE_ON = 'tivibro-companion-on';
function wake(on) {
  if (!on) { lcall(AM + '/cancel', { activityName: WAKE_ON }, function () {}); return lcall(AM + '/cancel', { activityName: WAKE }, function () {}); }
  lcall(AM + '/create', {
    activity: {
      name: WAKE_ON, description: 'TiviBro: the phone app connection, as soon as the TV is on',
      type: { background: true, persist: true, explicit: true },
      trigger: { method: 'luna://com.webos.service.tvpower/power/getPowerState', params: { subscribe: true }, where: { prop: 'state', op: '=', val: 'Active' } },
      callback: { method: 'luna://app.tivibro.tv.service/wake', params: { on: true } }
    },
    start: true, replace: true
  }, function (r) { proxy.log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'companion wake at power-on ' + (r.returnValue === false ? 'refused: ' + (r.errorText || r.errorCode) : 'set') }); });
  lcall(AM + '/create', {
    activity: {
      name: WAKE, description: 'TiviBro: keep the phone app connection available',
      type: { background: true, persist: true, explicit: true },
      schedule: { interval: '5m' },
      callback: { method: 'luna://app.tivibro.tv.service/wake', params: {} }
    },
    start: true, replace: true
  }, function (r) { proxy.log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'companion wake-up ' + (r.returnValue === false ? 'refused: ' + (r.errorText || r.errorCode) : 'scheduled') }); });
}
if (companion.on) {
  companion.start(function () {});
  hold(); wake(true); watchPower();
}

function hold() {
  if (activity) return;
  try { service.activityManager.create('tivibro-relay', function (a) { activity = a; proxy.log({ lv: 'info', event: 'keep-alive activity created' }); }); }
  catch (e) { proxy.log({ lv: 'error', event: 'keep-alive activity failed', e: e.message }); }
}
function release() {
  if (activity) { try { service.activityManager.complete(activity); } catch (e) {} activity = null; }
}

service.register('start', function (message) {
  clearTimeout(idleTimer);
  listen(0, function (err, p) {
    if (err) return message.respond({ returnValue: false, errorText: err.message });
    if (message.isSubscription) { subs++; hold(); watchPower(); grant.ensure(); }
    proxy.log({ lv: 'info', event: 'start', subscribers: subs, port: p });
    message.respond({ returnValue: true, port: p, subscribed: !!message.isSubscription, ctl: CTL });
  });
}, function cancel() {
  subs = Math.max(0, subs - 1);
  proxy.log({ lv: 'info', event: 'subscriber left', subscribers: subs });
  if (!subs) { reminders.setVisible(false); companion.closePairing(); companion.appGone(); }      // the app closed
  if (!subs) idleTimer = setTimeout(function () {
    if (relay) { relay.server.close(); relay = null; port = 0; }
    if (!companion.on) release();
  }, 5000);
});

service.register('status', function (message) {
  message.respond({ returnValue: true, port: port, subscribers: subs, node: process.version, stats: relay ? relay.stats : null, companion: { on: companion.on, running: companion.running, port: companion.port }, log: proxy.LOG.slice(-50) });
});

// The app's reminders for one playlist, and whether TiviBro is on screen right now.
service.register('reminders', function (message) {
  try { message.respond(Object.assign({ returnValue: true }, reminders.set(message.payload || {}))); }
  catch (e) { proxy.log({ lv: 'error', event: 'reminders failed', e: e.message }); message.respond({ returnValue: false, errorText: e.message }); }
});
service.register('visible', function (message) {
  reminders.setVisible(!!(message.payload && message.payload.visible));
  message.respond({ returnValue: true });
});
// Called by the activity manager at reminder time, also when nothing of TiviBro was running.
service.register('fire', function (message) {
  reminders.fire(message.payload || {}, function (what) { message.respond({ returnValue: true, result: what }); });
});
// Called by the activity manager every 5 minutes while the phone app connection is on (and by install.sh).
service.register('wake', function (message) {
  var act = message.payload && message.payload.$activity && message.payload.$activity.activityId;
  if (companion.on) { hold(); companion.start(function () {}); watchPower(); }
  if (act) lcall(AM + '/complete', { activityId: act, restart: companion.on }, function () {});
  message.respond({ returnValue: true, on: companion.on, running: companion.running });
});
