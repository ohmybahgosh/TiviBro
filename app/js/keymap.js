/* Remote control remapping.
   Two contexts, like TiviMate: "player" (fullscreen live TV) and "list" (the channel list).
   Every button can have a short-press and a long-press action.  Buttons the app doesn't
   know (extra keys on some LG remotes) can be learned by pressing them once.
   Catch-up and movie playback keep fixed seek controls so they always behave the same. */
var Keymap = (function () {
  'use strict';

  var BUTTONS = [
    ['ok', 'OK'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'],
    ['chup', 'Channel +'], ['chdown', 'Channel −'], ['red', 'Red'], ['green', 'Green'], ['yellow', 'Yellow'], ['blue', 'Blue'],
    ['playpause', 'Play / Pause'], ['stop', 'Stop'], ['rew', 'Rewind'], ['ff', 'Fast forward'], ['info', 'Info'], ['back', 'Back']
  ];
  // Short presses that must stay put so you can always get around: Back in lists, arrows in lists.
  var FIXED = { list: { up: 1, down: 1, left: 1, right: 1, ok: 1, back: 1, chup: 1, chdown: 1 }, player: { back: 1 } };

  var ACTIONS = {
    none: 'Nothing',
    panel: 'Quick menu (actions and recent channels)', list: 'Channel list over the video', osd: 'Show info panel', menu: 'Options menu',
    chnext: 'Next channel', chprev: 'Previous channel', last: 'Last channel',
    rewind: 'Rewind (catch-up), else last channel', restart: 'Watch from start', playpause: 'Play / pause',
    guide: 'TV guide', search: 'Search', settings: 'Settings', editor: 'Edit on a phone or computer (QR code)', live: 'Channels screen', exit: 'Leave fullscreen',
    fav: 'Add or remove favorite', favorites: 'Open Favorites', recents: 'Open Recent channels',
    picture: 'Change picture mode', audio: 'Audio track', sleep: 'Sleep timer',
    movies: 'Movies', shows: 'Shows', reconnect: 'Reconnect stream'
  };
  // Short names for the on-screen button legend.
  var SHORT = {
    panel: 'Quick menu', list: 'Channel list', osd: 'Info', menu: 'Options', chnext: 'Next channel', chprev: 'Previous channel', last: 'Last channel',
    rewind: 'Rewind', restart: 'Watch from start', playpause: 'Pause', guide: 'Guide', search: 'Search', settings: 'Settings', editor: 'Phone editor',
    live: 'Channels', exit: 'Exit fullscreen', fav: 'Favorite', favorites: 'Favorites', recents: 'Recent',
    picture: 'Picture size', audio: 'Audio track', sleep: 'Sleep timer', movies: 'Movies', shows: 'Shows', reconnect: 'Reconnect'
  };
  var CONTEXT_ACTIONS = {
    player: ['none', 'panel', 'list', 'osd', 'menu', 'chnext', 'chprev', 'last', 'rewind', 'restart', 'playpause', 'guide', 'search', 'settings', 'editor', 'exit',
      'fav', 'favorites', 'recents', 'picture', 'audio', 'sleep', 'reconnect'],
    list: ['none', 'menu', 'last', 'guide', 'search', 'settings', 'editor', 'fav', 'favorites', 'recents', 'movies', 'shows', 'playpause']
  };

  var DEFAULTS = {
    player: {
      ok: 'panel', 'long:ok': 'list', up: 'chprev', down: 'chnext', chup: 'chnext', chdown: 'chprev',
      left: 'rewind', right: 'osd', red: 'menu', green: 'guide', yellow: 'last', blue: 'audio',
      playpause: 'playpause', stop: 'exit', rew: 'rewind', ff: 'none', info: 'osd'
    },
    list: { 'long:ok': 'menu', red: 'menu', green: 'guide', yellow: 'last', blue: 'settings', playpause: 'none', info: 'menu', stop: 'none', rew: 'none', ff: 'none' }
  };

  var ctx = 'list';

  function map() {
    var m = Store.settings.keymap;
    if (!m) { m = JSON.parse(JSON.stringify(DEFAULTS)); }
    // v2: OK in fullscreen opens the quick menu (was the channel list), unless you changed it.
    else if (!m.v2) { if (m.player && m.player.ok === 'list' && m.player['long:ok'] === 'menu') { m.player.ok = 'panel'; m.player['long:ok'] = 'list'; } m.v2 = 1; }
    // v3: Info in the channel list opens the channel's options (it did nothing before).
    if (m && !m.v3) { if (m.list && m.list.info === 'none') m.list.info = 'menu'; m.v3 = 1; }
    // v4: multiview is gone (webOS apps can play one video at a time).  A button set to it plays the
    // audio track choice instead, the new default for Blue.
    if (m && !m.v4) { ['player', 'list'].forEach(function (c) { var x = m[c]; if (x) Object.keys(x).forEach(function (b) { if (x[b] === 'multiview') x[b] = c === 'player' ? 'audio' : 'none'; }); }); m.v4 = 1; }
    return m;
  }
  function get(context, btn) {
    var m = map()[context] || {};
    if (Object.prototype.hasOwnProperty.call(m, btn)) return m[btn];
    var d = DEFAULTS[context] || {};
    return d[btn] || null;
  }
  function set(context, btn, action) {
    var m = map();
    if (!m[context]) m[context] = {};
    m[context][btn] = action;
    Store.settings.keymap = m;
    Store.saveSettings();
  }
  function reset(context) {
    var m = map();
    if (context) m[context] = JSON.parse(JSON.stringify(DEFAULTS[context])); else m = JSON.parse(JSON.stringify(DEFAULTS));
    Store.settings.keymap = m;
    Store.saveSettings();
  }

  function learned() {
    var a = Store.settings.keyAliases || {}, out = [];
    Object.keys(a).forEach(function (code) { out.push([a[code], 'Button ' + code]); });
    return out;
  }
  function allButtons() { return BUTTONS.concat(learned()); }
  function learn(code) {
    var a = Store.settings.keyAliases || (Store.settings.keyAliases = {});
    if (!a[code]) a[code] = 'k' + code;
    Store.saveSettings();
    return a[code];
  }
  function alias(code) { var a = Store.settings.keyAliases; return a && a[code]; }

  function label(btn) {
    var long = btn.indexOf('long:') === 0, b = long ? btn.slice(5) : btn;
    var f = allButtons().filter(function (x) { return x[0] === b; })[0];
    return (long ? 'Hold ' : '') + (f ? f[1] : b);
  }

  // Does this button have a long-press action right now?  The key layer asks this so a
  // short press is only delayed when holding the button would actually do something.
  function hasLong(btn) {
    var a = get(ctx, 'long:' + btn);
    return !!(a && a !== 'none');
  }
  function fixed(context, btn) { return !!(FIXED[context] && FIXED[context][btn]); }

  return {
    BUTTONS: BUTTONS, ACTIONS: ACTIONS, SHORT: SHORT, CONTEXT_ACTIONS: CONTEXT_ACTIONS, DEFAULTS: DEFAULTS,
    get: get, set: set, reset: reset, label: label, hasLong: hasLong, fixed: fixed,
    allButtons: allButtons, learn: learn, alias: alias,
    setContext: function (c) { ctx = c; }, get context() { return ctx; }
  };
})();
