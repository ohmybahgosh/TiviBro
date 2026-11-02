// The helper's reminders (service/remind.js): scheduling with the activity manager, cancelling,
// and what happens at reminder time (alert, toast fallback, staying quiet while the app is on screen).
const fs = require('fs'), path = require('path'), os = require('os');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbrem-')), file = path.join(dir, 'r.json');
let now = Date.UTC(2026, 9, 30, 22, 0, 0), calls = [], answer = {};
const make = () => require('../../service/remind.js').create({ files: [file], now: () => now, log() {},
  call: (uri, params, cb) => { calls.push({ uri, params }); cb(answer[uri.split('/').pop()] || { returnValue: true }); } });
let R = make();
const H = 3600e3;
const list = [{ k: 'x1', s: now + 2 * H, e: now + 3 * H, t: 'Lions <b>at</b> Packers', ch: 'FOX 2' }, { k: 'x2', s: now + 5 * H, e: now + 6 * H, t: 'News', ch: 'CNN' }, { k: 'x3', s: now - 2 * H, e: now - H, t: 'Old' }];
let r = R.set({ pid: 'p1', before: 2, list, visible: true });
const creates = calls.filter(c => /create$/.test(c.uri));
ok('two future reminders scheduled, the past one dropped', r.count === 2 && creates.length === 2, JSON.stringify(r));
const a = creates[0].params.activity;
ok('scheduled 2 minutes early, in UTC', a.schedule.start === new Date(now + 2 * H - 120000).toISOString().replace('T', ' ').slice(0, 19) + 'Z', a.schedule.start);
ok('persists across restarts, calls the helper back', a.type.persist && a.callback.method === 'luna://app.tivibro.tv.service/fire' && a.callback.params.k === 'x1' && creates[0].params.replace === true);
ok('no markup from titles reaches the TV', a.callback.params.t === 'Lions at Packers', a.callback.params.t);
calls = []; R.set({ pid: 'p1', before: 2, list });
ok('the same list again schedules nothing', !calls.some(c => /create$/.test(c.uri)), calls.length);
calls = []; R.set({ pid: 'p1', before: 2, list: list.slice(1) });
ok('a removed reminder is cancelled', calls.some(c => /cancel$/.test(c.uri) && c.params.activityName === R.nameOf(R.idOf('p1', list[0]))));
calls = []; R.set({ pid: 'p1', before: 5, list: list.slice(1) });
ok('changing how early reschedules', calls.filter(c => /create$/.test(c.uri)).length === 1);
calls = []; R.set({ pid: 'p2', before: 5, list: [{ k: 'y', s: now + H, e: now + 2 * H, t: 'Other' }] });
ok('another playlist\'s reminders are kept', !calls.some(c => /cancel$/.test(c.uri)) && Object.keys(R.state.lists).length === 2);

// Reminder time.
const fire = p => new Promise(res => R.fire(p, res));
(async () => {
  R.setVisible(true); calls = []; now = list[1].s - 300000;
  let w = await fire(Object.assign({ pid: 'p1', $activity: { activityId: 7 } }, list[1]));
  ok('on screen: the app asks, the helper stays quiet', /left to the app/.test(w) && !calls.some(c => /notification/.test(c.uri)) && calls.some(c => /complete$/.test(c.uri) && c.params.activityId === 7), w);
  R.setVisible(false); calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  const al = calls.find(c => /createAlert$/.test(c.uri));
  ok('closed: an alert with Watch and Dismiss', w === 'shown' && al && al.params.buttons[0].label === 'Watch' && al.params.buttons[1].label === 'Dismiss', w);
  ok('Watch launches TiviBro on the channel', al.params.buttons[0].onclick === 'luna://com.webos.applicationManager/launch' && al.params.buttons[0].params.id === 'app.tivibro.tv' && al.params.buttons[0].params.params.reminder.k === 'x2');
  ok('it says when and where', /Starts at/.test(al.params.message) && /News/.test(al.params.message) && /CNN/.test(al.params.message), al.params.message);
  answer.createAlert = { returnValue: false, errorText: 'Denied method call' }; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  const to = calls.find(c => /createToast$/.test(c.uri));
  ok('alerts refused: a toast that opens the channel', /toast/.test(w) && to && to.params.onclick.appId === 'app.tivibro.tv' && to.params.onclick.params.reminder.k === 'x2', w);
  answer = {};
  w = await fire({ pid: 'p1', k: 'x1', s: list[0].s, e: list[0].e, t: 'Lions' });
  ok('a reminder removed in the app does not fire', /removed/.test(w), w);
  now = list[1].e + 1000;
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('one that is already over does not fire (TV was off)', /over/.test(w), w);
  now = list[1].s + 20 * 60000; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('a late one says when it started', /Started at/.test((calls.find(c => /createAlert$/.test(c.uri)) || { params: {} }).params.message || ''), w);
  // Only for someone using the TV: screensaver, Gallery, Always Ready or a dark screen wait.
  now = list[1].s; R.setVisible(false);
  answer.getPowerState = { returnValue: true, state: 'Screen Saver' }; calls = [];
  w = await fire(Object.assign({ pid: 'p1', $activity: { activityId: 9 } }, list[1]));
  const again = calls.find(c => /create$/.test(c.uri));
  ok('screensaver: nothing shown, looked at again in 2 minutes', /waiting/.test(w) && !calls.some(c => /notification/.test(c.uri)) && again && again.params.activity.schedule.start === new Date(now + 120000).toISOString().replace('T', ' ').slice(0, 19) + 'Z', w);
  ok('and the running activity is completed first', calls.findIndex(c => /complete$/.test(c.uri)) < calls.findIndex(c => /create$/.test(c.uri)));
  answer.getPowerState = { returnValue: true, state: 'Active Standby' }; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('Always Ready (Active Standby): waits', /waiting/.test(w) && /Active Standby/.test(w), w);
  answer.getPowerState = { returnValue: true, state: 'Active' }; answer.getForegroundAppInfo = { returnValue: true, appId: 'com.webos.app.gallery' }; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('Gallery in front: waits', /waiting/.test(w) && /gallery/.test(w), w);
  for (const id of ['com.webos.app.lifeonscreen', 'com.webos.app.atelier', 'org.aabytt.webos.custom-screensaver-aerial']) {
    answer.getForegroundAppInfo = { returnValue: true, appId: id }; calls = [];
    w = await fire(Object.assign({ pid: 'p1' }, list[1]));
    ok(id + ' in front (LG Gallery+, Line View, Aerial): waits', /waiting/.test(w), w);
  }
  answer.getForegroundAppInfo = { returnValue: true, appId: 'netflix' }; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('someone watching another app: the alert shows', w === 'shown' && calls.some(c => /createAlert$/.test(c.uri)), w);
  answer.getForegroundAppInfo = { returnValue: true, appId: 'com.webos.app.screensaver' }; now = list[1].e - 90000; calls = [];
  w = await fire(Object.assign({ pid: 'p1' }, list[1]));
  ok('nearly over and still nobody there: gives up (the app asks next time)', /not shown/.test(w) && !calls.some(c => /create$/.test(c.uri)), w);
  answer = {};
  // Guide placeholders left as reminders by earlier versions: never shown, and dropped from the list.
  now = list[1].s; calls = [];
  w = await fire({ pid: 'p1', k: 'x2', s: list[1].s, e: list[1].e, t: 'Next game: Detroit Lions at Miami Dolphins at 11/08/2026 01:00 PM', ch: 'NFL | MIAMI DOLPHINS' });
  ok('a "Next game:" placeholder is not shown', /not a programme/.test(w) && !calls.some(c => /notification/.test(c.uri)), w);
  w = await fire({ pid: 'p1', k: 'x2', s: list[1].s, e: list[1].e, t: 'Future Events for Detroit Tigers not found yet' });
  ok('"... not found" is not shown', /not a programme/.test(w), w);
  // A restarted helper reads the list back.
  R = make();
  ok('the list survives a helper restart', R.state.lists.p1 && R.state.lists.p1.length === 1 && R.state.lists.p2.length === 1);
  r = R.set({ pid: 'p3', list: [{ k: 'z1', s: now + H, e: now + 2 * H, t: 'No future events scheduled' }, { k: 'z2', s: now + H, e: now + 2 * H, t: 'Lions at Packers' }] });
  ok('placeholders are not scheduled', r.count === 1, JSON.stringify(r));
  // Rooted TVs: a refused alert goes out as root (rootAlert), and after one refusal straight away.
  let rooted = [], rootOk = true;
  const R2 = require('../../service/remind.js').create({ files: [path.join(dir, 'r2.json')], now: () => now, log() {},
    call: (uri, params, cb) => { calls.push({ uri, params }); cb(answer[uri.split('/').pop()] || { returnValue: true }); },
    rootAlert: (alert, cb) => { rooted.push(alert); cb(rootOk, rootOk ? '' : 'no Homebrew Channel'); } });
  now = Date.UTC(2026, 10, 2, 1, 0, 0);
  const rl = [{ k: 'r1', s: now + 60000, e: now + H, t: 'Lions at Packers', ch: 'FOX 2' }];
  R2.set({ pid: 'p9', list: rl });
  answer = { createAlert: { returnValue: false, errorText: 'Permission Denied' } }; calls = [];
  w = await new Promise(res => R2.fire(Object.assign({ pid: 'p9' }, rl[0]), res));
  ok('alert refused on a rooted TV: shown as root, with Watch', w === 'shown (as root)' && rooted.length === 1 && rooted[0].buttons[0].label === 'Watch' && rooted[0].buttons[0].params.params.reminder.k === 'r1' && !calls.some(c => /createToast$/.test(c.uri)), w);
  calls = [];
  w = await new Promise(res => R2.fire(Object.assign({ pid: 'p9' }, rl[0]), res));
  ok('next time straight to root, no refused call', w === 'shown (as root)' && !calls.some(c => /createAlert$/.test(c.uri)), w);
  rootOk = false; calls = [];
  w = await new Promise(res => R2.fire(Object.assign({ pid: 'p9' }, rl[0]), res));
  ok('root not available: a toast', /toast/.test(w) && calls.some(c => /createToast$/.test(c.uri)), w);
  answer = {};
  console.log(fail ? fail + ' failures' : 'all reminder helper tests passed');
  process.exit(fail ? 1 : 0);
})();
