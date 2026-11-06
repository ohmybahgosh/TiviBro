// The TV's screensaver waits while something plays (issue #37, app/js/awake.js): the decision, the
// power service's messages (with and without webOS 4's missing "state"), the answers, and the log.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fail++; };
const SRC = fs.readFileSync(path.join(__dirname, '../../app/js/awake.js'), 'utf8');

function setup(opts) {
  opts = opts || {};
  const calls = [], logs = [], bridges = [];
  function PalmServiceBridge() { this.n = bridges.length; bridges.push(this); }
  PalmServiceBridge.prototype.call = function (uri, params) { calls.push({ uri, params: JSON.parse(params), bridge: this.n }); };
  const player = { current: null, state: 'idle', userPaused: false };
  const doc = { hidden: false };
  const clock = { t: 1700000000000 };
  const ctx = {
    console, JSON, Date: { now: () => clock.t }, document: doc,
    Log: { info: (t, m) => logs.push(['info', m]), warn: (t, m) => logs.push(['warn', m]) },
    Player: player
  };
  if (!opts.noBridge) ctx.PalmServiceBridge = PalmServiceBridge;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.Awake = Awake;', ctx);
  return { A: ctx.Awake, calls, logs, bridges, player, doc, clock };
}

// The decision on its own.
{
  const { A } = setup();
  const ch = { n: 'News' };
  ok('nothing playing: the screensaver may start', A.busy({ current: null, state: 'idle' }, false) === false);
  ok('live TV playing: it waits', A.busy({ current: ch, state: 'playing' }, false) === true);
  ok('loading and buffering count as playing', A.busy({ current: ch, state: 'loading' }, false) && A.busy({ current: ch, state: 'buffering' }, false));
  ok('paused by you: it may start', A.busy({ current: ch, state: 'playing', userPaused: true }, false) === false);
  ok('TiviBro in the background: it may start', A.busy({ current: ch, state: 'playing' }, true) === false);
  ok('a channel that would not play: it may start', A.busy({ current: ch, state: 'error' }, false) === false && A.busy({ current: ch, state: 'ended' }, false) === false);
  ok('no player at all: it may start', A.busy(null, false) === false);
}

// The grace periods (issue #58): a reconnect, a channel failing over, and the phone app as the remote.
{
  const { A } = setup();
  const ch = { n: 'News' }, now = 1700000000000;
  const idle = { current: null, state: 'idle' }, err = { current: ch, state: 'error' };
  ok('played 5 seconds ago (a reconnect): it waits', A.wait(idle, false, now, now - 5e3, 0) === true);
  ok('a channel that would not play, a moment after another played: it waits', A.wait(err, false, now, now - 20e3, 0) === true);
  ok('played 2 minutes ago, nothing since: it may start', A.wait(idle, false, now, now - 120e3, 0) === false);
  ok('a button 1 minute ago (the phone app as the remote), nothing playing: it waits', A.wait(idle, false, now, 0, now - 60e3) === true);
  ok('the last button 4 minutes ago: it may start', A.wait(idle, false, now, 0, now - 240e3) === false);
  ok('paused by you a moment after playing: it may start (no grace for a pause)', A.wait({ current: ch, state: 'playing', userPaused: true }, false, now, now - 5e3, 0) === false);
  ok('in the background, whatever happened: it may start', A.wait({ current: ch, state: 'playing' }, true, now, now, now) === false);
}
{
  const t = setup();
  t.A.start(); t.bridges[0].onservicecallback({ returnValue: true, subscribed: true });
  t.player.current = { n: 'Sports' }; t.player.state = 'playing'; t.A._player();
  t.clock.t += 60e3; t.player.state = 'loading'; t.A._player();          // reconnecting
  t.player.current = null; t.player.state = 'idle'; t.A._player();        // a moment between attempts
  t.clock.t += 4e3;
  t.bridges[0].onservicecallback({ returnValue: true, timestamp: 9 });
  const r = t.calls.filter(c => /responseScreenSaverRequest/.test(c.uri)).pop();
  ok('asked in the middle of a reconnect: it waits, and says why', r.params.ack === false && t.logs.some(l => /something played 4 s ago/.test(l[1])), [r, t.logs]);
  t.clock.t += 200e3; t.A.touch(); t.clock.t += 30e3;
  t.bridges[0].onservicecallback({ returnValue: true, timestamp: 10 });
  const r2 = t.calls.filter(c => /responseScreenSaverRequest/.test(c.uri)).pop();
  ok('browsing with the phone app, nothing playing: it waits, and says why', r2.params.ack === false && t.logs.some(l => /TiviBro is in use \(a button 30 s ago\)/.test(l[1])), [r2, t.logs.slice(-2)]);
  t.clock.t += 400e3;
  t.bridges[0].onservicecallback({ returnValue: true, timestamp: 11 });
  const r3 = t.calls.filter(c => /responseScreenSaverRequest/.test(c.uri)).pop();
  ok('and once it has all gone quiet: it may start, and that is logged too', r3.params.ack === true && t.logs.some(l => /Screensaver allowed/.test(l[1])), r3);
  ok('every button reaches it: the remote and the phone app both go through UI dispatch', /Awake\.touch\(\)/.test(fs.readFileSync(path.join(__dirname, '../../app/js/ui.js'), 'utf8')));
}

// The name still held by a start a second earlier (webOS starts the app twice): asked again under its own name.
{
  const t = setup();
  t.A.start();
  t.A._message(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'The client is already registered' }));
  const regs = t.calls.filter(c => /registerScreenSaverRequest/.test(c.uri));
  ok('already registered: asks again under a name of its own', regs.length === 2 && regs[0].params.clientName === 'tivibro' && /^tivibro\.[a-z0-9]+$/.test(regs[1].params.clientName) && !t.logs.some(l => l[0] === 'warn'), [regs, t.logs]);
  t.A._message(JSON.stringify({ returnValue: true, subscribed: true }));
  ok('and then holds the screensaver off as usual', t.A.status.state === 'on');
  t.A._message(JSON.stringify({ returnValue: false, errorText: 'The client is already registered' }));
  ok('only once: a second refusal is reported', t.A.status.state === 'refused' && t.logs.some(l => l[0] === 'warn'));
}

// Registering, then the questions.
{
  const { A, calls, logs, bridges, player, doc, clock } = setup();
  A.start();
  ok('registers with the TV power service, subscribed, as tivibro', calls.length === 1 && calls[0].uri === 'luna://com.webos.service.tvpower/power/registerScreenSaverRequest' && calls[0].params.subscribe === true && calls[0].params.clientName === 'tivibro', calls);
  A.start();
  ok('only once', calls.length === 1);
  const sub = bridges[0];
  sub.onservicecallback(JSON.stringify({ returnValue: true, subscribed: true }));
  ok('the first answer (no timestamp) asks nothing', calls.length === 1 && A.status.state === 'on', A.status);

  // A movie plays (My media, a VOD movie and catch-up all go through Player).
  player.current = { n: 'Film of the Night' }; player.state = 'playing';
  sub.onservicecallback(JSON.stringify({ returnValue: true, timestamp: '1388518297', state: 'Active', instantBoot: 'on' }));
  let r = calls[1];
  ok('while something plays: answers ack false with the same timestamp', r && r.uri === 'luna://com.webos.service.tvpower/power/responseScreenSaverRequest' && r.params.ack === false && r.params.timestamp === '1388518297' && r.params.clientName === 'tivibro', r);
  ok('on a bridge of its own (the subscription keeps going)', r && r.bridge !== 0);
  ok('the refusal is logged with what plays', logs.some(l => l[0] === 'info' && /held off/.test(l[1]) && /Film of the Night/.test(l[1])), logs);

  // webOS 4 leaves out "state" (Kodi found this): still a question.
  sub.onservicecallback(JSON.stringify({ returnValue: true, timestamp: '3787724643', instantBoot: 'on' }));
  r = calls[2];
  ok('webOS 4 message without state is answered too', r && r.params.ack === false && r.params.timestamp === '3787724643', r);

  // Paused, then stopped, then playing in the background.
  player.userPaused = true;
  sub.onservicecallback({ returnValue: true, timestamp: 5 });
  ok('paused: ack true', calls[3].params.ack === true && calls[3].params.timestamp === 5, calls[3]);
  player.userPaused = false; player.current = null; player.state = 'idle';
  clock.t += 100e3;                                   // stopped a while ago (90 seconds of grace after playing)
  sub.onservicecallback({ returnValue: true, timestamp: 6 });
  ok('nothing playing: ack true', calls[4].params.ack === true);
  player.current = { n: 'News' }; player.state = 'buffering'; doc.hidden = true;
  sub.onservicecallback({ returnValue: true, timestamp: 7 });
  ok('in the background: ack true', calls[5].params.ack === true);
  doc.hidden = false;
  sub.onservicecallback({ returnValue: true, timestamp: 8 });
  ok('buffering in front: ack false', calls[6].params.ack === false);
  ok('counts what it answered', A.status.refused === 3 && A.status.allowed === 3, A.status);
  ok('answers that came back free their bridge', (bridges[1].onservicecallback('{"returnValue":true}'), true));
}

// The TV says no, or there is no TV.
{
  const { A, logs, bridges } = setup();
  A.start();
  bridges[0].onservicecallback(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Denied method call' }));
  ok('a refused registration is logged as a warning and shown in the status', A.status.state === 'refused' && /Denied/.test(A.status.why) && logs.some(l => l[0] === 'warn' && /screensaver/.test(l[1])), A.status);
  const d = setup({ noBridge: true });
  d.A.start();
  ok('a desktop browser: nothing to do, nothing breaks', d.A.status.state === 'unavailable' && d.calls.length === 0);
  ok('the app starts it at boot', /Awake\.start\(\)/.test(fs.readFileSync(path.join(__dirname, '../../app/js/app.js'), 'utf8')) &&
    /js\/awake\.js/.test(fs.readFileSync(path.join(__dirname, '../../app/index.html'), 'utf8')));
}

console.log(fail ? fail + ' failures' : 'all screensaver tests passed');
process.exit(fail ? 1 : 0);
