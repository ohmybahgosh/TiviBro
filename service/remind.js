/* Reminders that work while TiviBro is closed.
   The app sends its reminders (per playlist) whenever they change.  For each one the helper asks
   webOS's activity manager to call it back at reminder time ("fire"), which starts the helper even
   when nothing of TiviBro is running.  At that moment it shows a webOS alert (Watch / Dismiss)
   over whatever is on screen, or a toast if the TV refuses alerts; Watch or the toast opens
   TiviBro straight on the channel.  If TiviBro is open and on screen, it shows its own question
   instead and the helper stays quiet.
   The list is also kept in a small file, so a reminder removed in the app never fires; the
   callback carries everything needed in case that file can't be written. */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os');

var APP = 'app.tivibro.tv', SELF = 'luna://app.tivibro.tv.service';
var AM = 'luna://com.palm.activitymanager';
var RETRY = 2 * 60000;
// Guide placeholders, not programmes: "Next game: …", "Future events … not found", "No events
// scheduled".  Earlier versions could set reminders on them (My teams); never schedule or show one.
var PLACEHOLDER = /^\s*next (?:game|event|match)\b|not found|no (?:future |upcoming |more |scheduled )?(?:games?|events?|matches)\b|not scheduled|nothing scheduled/i;
// What's in front when nobody is watching: the screensaver, Gallery / art and Always Ready.  The ids
// differ by model and year, so names are matched loosely; the helper log records the real one.
// Seen on a 2022 C2 (webOS 10.3): com.webos.app.screensaver, com.webos.app.lifeonscreen ("LG
// Gallery+"), com.webos.app.atelier ("Line View"), and homebrew screensavers such as
// org.aabytt.webos.custom-screensaver-aerial.
var AMBIENT = /screensaver|screen\.saver|gallery|lifeonscreen|atelier|ambient|always\.?ready|artmode|art\.mode|\.art$|standby|clock/i;

function create(opts) {
  var call = opts.call, log = opts.log || function () {}, now = opts.now || Date.now;
  var files = (opts.files || [path.join(__dirname, 'reminders.json'), path.join(os.tmpdir(), 'tivibro-reminders.json')]);
  var state = { lists: {}, names: {} };      // lists: pid -> [reminder]; names: activity name -> 1
  var visible = false;

  function load() {
    for (var i = 0; i < files.length; i++) {
      try { var j = JSON.parse(fs.readFileSync(files[i], 'utf8')); if (j && j.lists) { state = j; state.names = state.names || {}; return files[i]; } } catch (e) {}
    }
    return null;
  }
  function save() {
    for (var i = 0; i < files.length; i++) { try { fs.writeFileSync(files[i], JSON.stringify(state)); return true; } catch (e) {} }
    log({ lv: 'warn', event: 'reminders not saved', e: 'no writable place' });
    return false;
  }
  load();

  function idOf(pid, r) { return String(pid) + '|' + r.k + '|' + r.s; }
  // Activity names: letters, digits, dots and dashes, short enough for any webOS.
  function nameOf(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return 'tivibro-rem-' + h.toString(36) + '-' + String(id.split('|')[2] || '').slice(-9); }
  function utc(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z'; }
  // Titles go into the TV's alert, which reads HTML: no tags, and & < > shown as text.
  function clean(s, n) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[<>]/g, '').slice(0, n || 120); }
  function html(s) { return String(s).replace(/&/g, '&amp;'); }

  // One activity per reminder: the activity manager calls "fire" with these details at that time.
  function schedule(p, at) {
    var id = p.id || idOf(p.pid, p), name = nameOf(id);
    call(AM + '/create', {
      activity: {
        name: name, description: 'TiviBro reminder: ' + p.t,
        type: { foreground: true, persist: true },
        schedule: { start: utc(at) },
        callback: { method: SELF + '/fire', params: { id: id, pid: p.pid, k: p.k, s: +p.s, e: +p.e, t: p.t, ch: p.ch } }
      },
      start: true, replace: true
    }, function (res) {
      if (res && res.returnValue === false) log({ lv: 'error', event: 'reminder not scheduled', e: res.errorText || res.errorCode, t: p.t });
    });
    state.names[name] = 1;
  }

  // The app's whole list for one playlist: schedule new ones, cancel ones that went away.
  function set(p) {
    var pid = clean(p.pid, 40), before = Math.max(0, Math.min(60, +p.before || 0)) * 60000, t = now();
    if (typeof p.visible === 'boolean') visible = p.visible;
    var list = (Array.isArray(p.list) ? p.list : []).filter(function (r) { return r && r.k && +r.s && +r.e > t && !PLACEHOLDER.test(r.t || ''); }).slice(0, 200).map(function (r) {
      return { k: clean(r.k, 80), s: +r.s, e: +r.e, t: clean(r.t), ch: clean(r.ch, 80), at: +r.s - before };
    });
    var want = {};
    Object.keys(state.lists).forEach(function (q) { if (q !== pid) (state.lists[q] || []).forEach(function (r) { if (r.e > t) want[nameOf(idOf(q, r))] = 1; }); });
    list.forEach(function (r) { want[nameOf(idOf(pid, r))] = 1; });
    var gone = Object.keys(state.names).filter(function (n) { return !want[n]; });
    var old = {}; (state.lists[pid] || []).forEach(function (r) { old[nameOf(idOf(pid, r))] = r.at; });
    state.lists[pid] = list;
    var made = 0;
    list.forEach(function (r) {
      var id = idOf(pid, r), name = nameOf(id);
      if (state.names[name] && old[name] === r.at) return;          // already scheduled for this time
      made++;
      schedule({ id: id, pid: pid, k: r.k, s: r.s, e: r.e, t: r.t, ch: r.ch }, Math.max(r.at, t + 5000));
    });
    gone.forEach(function (n) { delete state.names[n]; call(AM + '/cancel', { activityName: n }, function () {}); });
    // Lists of playlists whose reminders have all passed.
    Object.keys(state.lists).forEach(function (q) { state.lists[q] = state.lists[q].filter(function (r) { return r.e > t; }); if (!state.lists[q].length && q !== pid) delete state.lists[q]; });
    save();
    log({ lv: 'info', event: 'reminders', pid: pid, count: list.length, scheduled: made, cancelled: gone.length, visible: visible });
    return { count: list.length, scheduled: made, cancelled: gone.length };
  }

  function still(p) {
    var l = state.lists[p.pid];
    if (!l) return !Object.keys(state.lists).length;      // nothing known (file lost): trust the callback
    return l.some(function (r) { return r.k === p.k && r.s === +p.s; });
  }
  function when(ms) { var d = new Date(ms), h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? 'pm' : 'am'); }

  // Called by the activity manager at reminder time.
  function fire(p, done) {
    var t = now(), act = p && p.$activity && p.$activity.activityId;
    function finish(what) {
      if (act) call(AM + '/complete', { activityId: act }, function () {});
      var name = nameOf(String(p.id || idOf(p.pid, p))); delete state.names[name]; save();
      log({ lv: 'info', event: 'reminder ' + what, t: p.t });
      if (done) done(what);
    }
    if (!p || !p.k) return finish('ignored (no channel)');
    if (PLACEHOLDER.test(p.t || '')) return finish('skipped (not a programme)');
    if (!still(p)) return finish('skipped (removed in the app)');
    if (+p.e <= t) return finish('skipped (already over)');
    if (visible) return finish('left to the app (it is on screen)');
    // Only for someone using the TV.  Screensaver, Gallery, Always Ready or a dark screen: look again
    // in a couple of minutes while the programme is still on; the app asks when it is next opened.
    inUse(function (yes, why) {
      if (yes) return show();
      if (t + RETRY < +p.e - 60000) {
        if (act) call(AM + '/complete', { activityId: act }, function () {});
        act = 0;
        schedule(p, t + RETRY);
        log({ lv: 'info', event: 'reminder waiting: TV not in use (' + why + ')', t: p.t });
        if (done) done('waiting (' + why + ')');
        return;
      }
      finish('not shown: TV not in use (' + why + ')');
    });
    function show() {
    var started = +p.s <= t - 60000;
    var title = started ? 'Started at ' + when(+p.s) : +p.s > t + 30000 ? 'Starts at ' + when(+p.s) : 'Starting now';
    var msg = '<h3>' + title + ': ' + html(clean(p.t)) + '</h3>' + (p.ch ? 'On ' + html(clean(p.ch, 80)) + ' in TiviBro' : 'In TiviBro');
    var launch = { id: APP, params: { reminder: { pid: p.pid, k: p.k, s: +p.s } } };
    call('luna://com.webos.notification/createAlert', {
      sourceId: APP, message: msg,
      buttons: [{ label: 'Watch', onclick: 'luna://com.webos.applicationManager/launch', params: launch }, { label: 'Dismiss' }]
    }, function (res) {
      if (res && res.returnValue !== false) return finish('shown');
      log({ lv: 'warn', event: 'alert refused, using a toast', e: res && (res.errorText || res.errorCode) });
      call('luna://com.webos.notification/createToast', { sourceId: APP, message: msg + '<br>Select to watch', onclick: { appId: APP, params: launch.params }, noaction: false, persistent: true }, function (r2) {
        if (r2 && r2.returnValue === false) log({ lv: 'error', event: 'toast refused', e: r2.errorText || r2.errorCode });
        finish(r2 && r2.returnValue === false ? 'not shown' : 'shown as a toast');
      });
    });
    }
  }

  /* Is someone using the TV?  The screen must be on (not the screensaver, Always Ready or off) and
     the app in front not an ambient one.  If the TV won't say, assume yes. */
  function inUse(cb) {
    call('luna://com.webos.service.tvpower/power/getPowerState', {}, function (ps) {
      var st = ps && ps.returnValue !== false ? String(ps.state || '') : '';
      if (st && !/^active$/i.test(st)) return cb(false, 'power state ' + st + (ps.processing ? ', ' + ps.processing : ''));
      call('luna://com.webos.applicationManager/getForegroundAppInfo', {}, function (fg) {
        var id = fg && fg.returnValue !== false ? String(fg.appId || '') : '';
        log({ lv: 'info', event: 'reminder check', power: st || 'unknown', foreground: id || 'unknown' });
        if (id && AMBIENT.test(id)) return cb(false, id + ' in front');
        cb(true, id);
      });
    });
  }

  return { set: set, fire: fire, setVisible: function (v) { visible = !!v; }, get visible() { return visible; }, get state() { return state; }, nameOf: nameOf, idOf: idOf };
}

module.exports = { create: create };
