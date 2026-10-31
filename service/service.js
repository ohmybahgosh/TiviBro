/* webOS JS service wrapper for the relay.  The app subscribes to "start"; while that
   subscription is open (and an activity holds the service), the relay keeps running.
   When the app closes, the subscription drops and the service shuts down on its own, unless the
   phone app connection is on (companion.js): then the helper stays, with only that LAN server
   running, and an activity every 15 minutes brings it back after the TV restarts. */
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
var reminders = require('./remind').create({
  call: function (uri, params, cb) { try { service.call(uri, params, function (m) { cb(m && m.payload || {}); }); } catch (e) { cb({ returnValue: false, errorText: e.message }); } },
  log: function (o) { proxy.log(o); }
});

proxy.log({ lv: 'info', event: 'service loaded', node: process.version });

/* The TV's power changes (turned off, standby), kept in power.json, so the app can tell that its last
   session ended because the TV went off, not because it crashed.  Best effort: the call may be refused. */
var fs = require('fs'), path = require('path'), POWER = path.join(__dirname, 'power.json'), powerSub = null;
try { proxy.SYS.power = JSON.parse(fs.readFileSync(POWER, 'utf8')) || []; } catch (e) {}
function watchPower() {
  if (powerSub) return;
  try {
    powerSub = service.subscribe('luna://com.webos.service.tvpower/power/getPowerState', { subscribe: true });
    powerSub.on('response', function (m) {
      var st = m && m.payload && m.payload.state;
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
  dir: __dirname, log: function (o) { proxy.log(o); }, version: require('./package.json').version,
  launch: function (params, cb) {
    lcall('luna://com.webos.applicationManager/launch', { id: APP, params: params }, function (r) {
      cb(r.returnValue === false ? new Error(r.errorText || 'the TV refused') : null);
    });
  },
  sysinfo: function (cb) {
    lcall('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'sdkVersion'] }, function (r) {
      var out = { model: r.modelName || '', webos: r.sdkVersion || '' };
      lcall('luna://com.webos.settingsservice/getSystemSettings', { category: 'network', keys: ['deviceName'] }, function (n) {
        out.name = (n.settings && n.settings.deviceName) || '';
        proxy.log({ lv: 'info', event: 'companion: this TV', model: out.model, webos: out.webos, name: out.name });
        cb(out);
      });
    });
  },
  app: function () { return { open: subs > 0, visible: reminders.visible }; },
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
  editor: function () { return relay ? relay.editor : null; },
  onSwitch: function (on) { if (on) { hold(); wake(true); } else { wake(false); if (!subs) release(); } }
});
/* Every 15 minutes the activity manager calls "wake", which starts the helper if it isn't running
   (after the TV restarted, or webOS stopped it).  Persistent, so it outlives a restart. */
function wake(on) {
  if (!on) return lcall(AM + '/cancel', { activityName: WAKE }, function () {});
  lcall(AM + '/create', {
    activity: {
      name: WAKE, description: 'TiviBro: keep the phone app connection available',
      type: { background: true, persist: true, explicit: true },
      schedule: { interval: '15m' },
      callback: { method: 'luna://app.tivibro.tv.service/wake', params: {} }
    },
    start: true, replace: true
  }, function (r) { proxy.log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'companion wake-up ' + (r.returnValue === false ? 'refused: ' + (r.errorText || r.errorCode) : 'scheduled') }); });
}
if (companion.on) {
  companion.start(function () {});
  hold(); wake(true);
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
    if (message.isSubscription) { subs++; hold(); watchPower(); }
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
// Called by the activity manager every 15 minutes while the phone app connection is on.
service.register('wake', function (message) {
  var act = message.payload && message.payload.$activity && message.payload.$activity.activityId;
  if (companion.on) { hold(); companion.start(function () {}); }
  if (act) lcall(AM + '/complete', { activityId: act, restart: companion.on }, function () {});
  message.respond({ returnValue: true, on: companion.on, running: companion.running });
});
