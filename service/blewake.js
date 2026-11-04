/* Turning the TV on over Bluetooth (Wake on BLE), the way LG's ThinQ app does it.
   While the TV is on, a paired phone registers a made-up Bluetooth address of its own with the TV's
   asc service (luna://com.webos.service.asc/registerDevice, type "ThinQ").  When the TV is off and
   "Bluetooth advertising" (bleAdvertisingOnOff, network settings) is on, the TV listens for that
   address in an LG advertisement from the phone and turns itself on.  This module only does the TV
   side: registering, checking and removing a phone's address.  The phone sends the advertisement.
   Answered by the helper itself (POST /v1/blewake in companion.js), so TiviBro may be closed.
   Plain ES5 and callbacks for the old Node on webOS. */
'use strict';

var ASC = 'luna://com.webos.service.asc/';
var SETTINGS = 'luna://com.webos.settingsservice/getSystemSettings';
var ADDR = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/* The TV lists addresses with a colon in front and without leading zeros (":3a:7e:4b:5d:57:9f" is
   3a:7e:4b:5d:57:9f), so the colon in front goes and every octet is padded back to two hex digits
   before comparing.  Anything that isn't six octets comes back as ''. */
function norm(a) {
  var parts = String(a == null ? '' : a).trim().toLowerCase().replace(/^:(?=([0-9a-f]{0,2}:){5}[0-9a-f]{0,2}$)/, '').split(/[:-]/);
  if (parts.length !== 6) return '';
  for (var i = 0; i < 6; i++) {
    if (!/^[0-9a-f]{0,2}$/.test(parts[i])) return '';
    parts[i] = ('00' + parts[i]).slice(-2);
  }
  return parts.join(':');
}

// Is [want] in the TV's list (readBleDevices' devices)?
function listed(devices, want) {
  var w = norm(want);
  if (!w) return false;
  for (var i = 0; i < (devices || []).length; i++) if (norm(devices[i] && devices[i].address) === w) return true;
  return false;
}

/* opts: call(uri, params, cb(payload)): a luna call that always answers (errors as returnValue false),
   log(obj). */
function create(opts) {
  var call = opts.call, log = opts.log || function () {};

  function short(r) { return { returnValue: r && r.returnValue, errorCode: r && r.errorCode, errorText: r && r.errorText, count: r && r.count }; }

  function devices(cb) {
    call(ASC + 'readBleDevices', {}, function (r) {
      log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'blewake: readBleDevices', reply: short(r) });
      cb(r.returnValue === false ? null : (Array.isArray(r.devices) ? r.devices : []), r);
    });
  }
  // The TV's "Bluetooth advertising" setting: true, false, or undefined when the TV doesn't say.
  function woble(cb) {
    call(SETTINGS, { category: 'network', keys: ['bleAdvertisingOnOff'] }, function (r) {
      var v = r && r.settings && r.settings.bleAdvertisingOnOff;
      cb(v == null ? undefined : String(v) === 'on');
    });
  }

  function register(address, cb) {
    call(ASC + 'registerDevice', { type: 'ThinQ', address: address }, function (r) {
      log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'blewake: registerDevice', reply: short(r) });
      devices(function (list) {
        var yes = !!list && listed(list, address);
        var msg = yes ? 'This phone can turn the TV on over Bluetooth.'
          : r.returnValue === false ? 'The TV refused: ' + String(r.errorText || r.errorCode || 'no reason given').slice(0, 200)
          : 'The TV did not list this phone after registering it.';
        cb(null, { registered: yes, msg: msg });
      });
    });
  }

  function status(address, cb) {
    devices(function (list) {
      woble(function (on) { cb(null, { registered: !!list && listed(list, address), woble: on }); });
    });
  }

  /* The parameter name for unRegisterDevice isn't documented: { address } first, then the same shape as
     registerDevice.  Each reply is logged, and the list says whether it worked. */
  function unregister(address, cb) {
    call(ASC + 'unRegisterDevice', { address: address }, function (r) {
      log({ lv: r.returnValue === false ? 'warn' : 'info', event: 'blewake: unRegisterDevice { address }', reply: short(r) });
      function check() {
        devices(function (list) { cb(null, { ok: !!list && !listed(list, address) }); });
      }
      if (r.returnValue !== false) return check();
      call(ASC + 'unRegisterDevice', { type: 'ThinQ', address: address }, function (r2) {
        log({ lv: r2.returnValue === false ? 'warn' : 'info', event: 'blewake: unRegisterDevice { type, address }', reply: short(r2) });
        check();
      });
    });
  }

  /* A phone's request: { op: 'register' | 'status' | 'unregister', address }.  cb(err, answer); err only
     for a bad request. */
  function handle(j, cb) {
    var op = j && j.op, address = j && typeof j.address === 'string' ? j.address.trim().toLowerCase() : '';
    if (!ADDR.test(address)) return cb(new Error('bad address'));
    if (op === 'register') return register(address, cb);
    if (op === 'status') return status(address, cb);
    if (op === 'unregister') return unregister(address, cb);
    cb(new Error('unknown op'));
  }

  return { handle: handle, devices: devices };
}

module.exports = { create: create, norm: norm, listed: listed, ADDR: ADDR };
