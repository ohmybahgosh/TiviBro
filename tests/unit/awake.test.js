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
  const ctx = {
    console, JSON, Date, document: doc,
    Log: { info: (t, m) => logs.push(['info', m]), warn: (t, m) => logs.push(['warn', m]) },
    Player: player
  };
  if (!opts.noBridge) ctx.PalmServiceBridge = PalmServiceBridge;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.Awake = Awake;', ctx);
  return { A: ctx.Awake, calls, logs, bridges, player, doc };
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

// Registering, then the questions.
{
  const { A, calls, logs, bridges, player, doc } = setup();
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
