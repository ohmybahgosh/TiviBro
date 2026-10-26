/* webOS JS service wrapper for the relay.  The app subscribes to "start"; while that
   subscription is open (and an activity holds the service), the relay keeps running.
   When the app closes, the subscription drops and the service shuts down on its own. */
'use strict';
var Service = require('webos-service');
var proxy = require('./proxy');

var service = new Service('app.tivibro.tv.service');
process.on('uncaughtException', function (e) { proxy.log({ lv: 'error', event: 'uncaught exception', e: e && (e.stack || e.message) }); });
var relay = null, port = 0, subs = 0, activity = null, idleTimer = null;
var PORTS = [47811, 47812, 47813, 47814, 47815];

proxy.log({ lv: 'info', event: 'service loaded', node: process.version });

function listen(i, cb) {
  if (relay && port) return cb(null, port);
  if (i >= PORTS.length) { proxy.log({ lv: 'error', event: 'no free port', tried: PORTS }); return cb(new Error('no free port (tried ' + PORTS.join(', ') + ')')); }
  relay = proxy.create({});
  relay.server.once('error', function (e) {
    proxy.log({ lv: 'error', event: 'listen failed', port: PORTS[i], e: e.code || e.message });
    relay = null; listen(i + 1, cb);
  });
  relay.server.listen(PORTS[i], '127.0.0.1', function () { port = PORTS[i]; proxy.log({ lv: 'info', event: 'relay listening', port: port }); cb(null, port); });
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
    if (message.isSubscription) { subs++; hold(); }
    proxy.log({ lv: 'info', event: 'start', subscribers: subs, port: p });
    message.respond({ returnValue: true, port: p, subscribed: !!message.isSubscription });
  });
}, function cancel() {
  subs = Math.max(0, subs - 1);
  proxy.log({ lv: 'info', event: 'subscriber left', subscribers: subs });
  if (!subs) idleTimer = setTimeout(function () {
    if (relay) { relay.server.close(); relay = null; port = 0; }
    release();
  }, 5000);
});

service.register('status', function (message) {
  message.respond({ returnValue: true, port: port, subscribers: subs, node: process.version, stats: relay ? relay.stats : null, log: proxy.LOG.slice(-50) });
});
