/* Plex: sign in with a code (plex.tv/link), pick servers and libraries, and talk to them.  Calls go through the
   helper (service/plex.js); the sign-in is kept here, on this TV only (localStorage 'tivibro.plex', out of backups
   and logs, like Trakt's).  Nothing Plex shows in the menu, the phone app or the web editor until a server and a
   library are added in Settings > Plex (Plex.added()).  The Plex tab, its rows and playing come from plexview.js.
   Chromium 53-compatible. */
var Plex = (function () {
  'use strict';
  var KEY = 'tivibro.plex', CODE_POLL = 2000;
  var state = read(), pending = null, polling = 0, listeners = [], picking = {};

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } }
  function note(lv, m) { if (typeof Log !== 'undefined' && Log[lv]) Log[lv]('plex', m); }
  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); if (typeof Settings !== 'undefined' && Settings.live) Settings.live(); }
  function onChange(f) { listeners.push(f); }

  /* This TV's own Plex client id: made once, kept with the sign-in (Plex lists the TV as a device by it). */
  function cid() {
    if (!state.cid) { state.cid = 'tivibro-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); save(); }
    return state.cid;
  }
  function tvName() { var s = typeof Store !== 'undefined' && Store.settings; return (s && s.deviceName) || 'TiviBro on LG TV'; }

  /* One helper call.  A refused sign-in (error 'login') signs out of plex.tv here, so Settings asks again. */
  function req(q, ms) {
    q.cid = cid(); q.name = tvName();
    return Media.request('plex', q, ms || 25000).then(function (r) {
      if (r && r.error) {
        var e = new Error(message(r.error)); e.kind = r.error;
        if (r.error === 'login' && q.token && q.token === state.token) { note('warn', 'Plex refused the sign-in: signed out'); signOut(true); }
        throw e;
      }
      return r || {};
    });
  }
  function message(kind) {
    return kind === 'login' ? 'Plex signed this TV out.  Sign in again in Settings > Plex.' : kind === 'unreachable' ? 'Plex did not answer.  Check the TV\'s internet connection.' :
      kind === 'pin' ? 'That PIN isn\'t right.' : 'Plex said no to that.';
  }

  function signedIn() { return !!state.token; }
  function user() { return state.user || {}; }
  /* In the menu, the phone app and the web editor only once there's something to show. */
  function added() { return signedIn() && chosen().some(function (s) { return (state.libs && state.libs[s.id] || []).length > 0; }); }

  /* ---------- Signing in: the plex.tv/link code ---------- */
  function pendingCode() { return pending; }
  /* Asks plex.tv for a code and checks every 2 s until it's entered (a new code when one runs out).  draw() is
     called when the code changes so Settings shows it. */
  function connect(draw) {
    cancel();
    var run = ++polling;
    function fresh() {
      return req({ op: 'pin' }).then(function (p) { if (run !== polling) return; pending = { id: p.id, code: p.code, expires: p.expires, url: 'https://plex.tv/link' }; if (draw) draw(); return wait(); });
    }
    function wait() {
      return new Promise(function (ok) { setTimeout(ok, CODE_POLL); }).then(function () {
        if (run !== polling) throw new Error('Stopped.');
        if (Date.now() > pending.expires) return fresh();
        return req({ op: 'poll', id: pending.id }).then(function (r) { return r.token ? signedInWith(r.token) : wait(); }, function (e) { if (e.kind === 'unreachable') return wait(); throw e; });
      });
    }
    return fresh().then(function (u) { pending = null; return u; }, function (e) { if (run === polling) pending = null; throw e; });
  }
  function cancel() { polling++; pending = null; }
  // Signed in: who it is, then the servers (the first owned one that's on is picked for a start).
  function signedInWith(token) {
    state.token = token; save();
    return req({ op: 'user', token: token }).then(function (r) {
      state.user = r.user; save(); note('info', 'Signed in to Plex' + (r.user.pass ? ' (Plex Pass)' : ''));
      return loadServers().then(function () { changed(); return r.user.name; });
    });
  }
  /* Signing out forgets the sign-in, the servers and the libraries; Plex leaves the menu again. */
  function signOut(quiet) {
    var keep = state.cid; state = { cid: keep }; picking = {}; doorKeys = {}; save();
    if (!quiet) note('info', 'Signed out of Plex');
    changed();
  }

  /* ---------- Servers ---------- */
  function servers() { return state.servers || []; }
  function chosen() { var ids = state.chosen || []; return servers().filter(function (s) { return ids.indexOf(s.id) >= 0; }); }
  function server(id) { for (var i = 0; i < servers().length; i++) if (servers()[i].id === id) return servers()[i]; return null; }
  /* The servers this account can use, kept with how each was last reached.  A first sign-in picks the owned ones. */
  function loadServers() {
    return req({ op: 'servers', token: state.token }).then(function (r) {
      var old = {}; servers().forEach(function (s) { old[s.id] = s; });
      state.servers = r.servers.map(function (s) { var o = old[s.id]; if (o && o.uri) { s.uri = o.uri; s.local = o.local; s.relay = o.relay; } return s; });
      if (!state.chosen) state.chosen = r.servers.filter(function (s) { return s.owned; }).map(function (s) { return s.id; });
      save(); return state.servers;
    });
  }
  function choose(id, on) {
    var ids = (state.chosen || []).filter(function (x) { return x !== id; });
    if (on) ids.push(id);
    state.chosen = ids; save(); changed();
  }
  /* A server's address that answers now: the one that worked last time, checked again only when a call fails
     (reach(id, true)), else the first of its connections that answers (local first, relay last). */
  function reach(id, again) {
    var s = server(id); if (!s) return Promise.reject(new Error('That Plex server is gone from your account.'));
    if (s.uri && !again) return Promise.resolve(s);
    if (picking[id]) return picking[id];
    picking[id] = req({ op: 'pick', server: s }, 30000).then(function (r) {
      picking[id] = null; s.uri = r.uri; s.local = r.local; s.relay = r.relay; save(); return s;
    }, function (e) { picking[id] = null; throw e; });
    return picking[id];
  }
  /* A call to a server (GET unless said).  One failure tries the server's connections again, once. */
  function call(id, path, method) {
    function go(s) { return req({ op: method || 'get', base: s.uri, path: path, token: s.token }); }
    return reach(id).then(go).catch(function (e) {
      if (e.kind !== 'unreachable') throw e;
      return reach(id, true).then(go);
    }).then(function (r) { return r.data || {}; });
  }
  /* A door for pictures and video (service/plex.js): a random key in the link stands for the server and its token,
     since the TV's img and video tags can't send it.  One a server, asked for once. */
  var doorKeys = {};
  function door(id) {
    if (doorKeys[id]) return doorKeys[id];
    doorKeys[id] = reach(id).then(function (s) { return req({ op: 'door', base: s.uri, token: s.token }); }).then(function (r) { return r.key; }, function (e) { doorKeys[id] = null; throw e; });
    return doorKeys[id];
  }
  function container(j) { return (j && j.MediaContainer) || {}; }

  /* ---------- Libraries ---------- */
  /* A server's movie and TV libraries (music and photos aren't shown in TiviBro). */
  function sections(id) {
    return call(id, '/library/sections').then(function (j) {
      return (container(j).Directory || []).filter(function (d) { return d.type === 'movie' || d.type === 'show'; })
        .map(function (d) { return { key: String(d.key), title: d.title, type: d.type, server: id }; });
    });
  }
  function libs(id) { return (state.libs && state.libs[id]) || []; }
  function setLib(id, key, on) {
    var l = libs(id).filter(function (k) { return k !== key; });
    if (on) l.push(key);
    state.libs = state.libs || {}; state.libs[id] = l; save(); changed();
  }
  /* The libraries shown, with their titles as last read (Settings keeps them with the choice). */
  function shownLibraries() { return state.libInfo || []; }
  function rememberLibraries(list) { state.libInfo = list; save(); }

  /* ---------- Plex Home ---------- */
  function homeUsers() { return req({ op: 'home', token: state.token }).then(function (r) { return r.users; }); }
  /* Signing in as another Plex Home person: their own token, so their watched marks and limits apply. */
  function switchUser(uuid, pin) {
    var account = state.accountToken || state.token;
    return req({ op: 'switch', token: account, uuid: uuid, pin: pin }).then(function (r) {
      state.accountToken = account; state.token = r.token; save();
      return req({ op: 'user', token: r.token }).then(function (u) { state.user = u.user; picking = {}; doorKeys = {}; save(); return loadServers(); }).then(function () { changed(); return user().name; });
    });
  }

  /* Settings and the phone: one line on where things stand. */
  function describe() {
    if (!signedIn()) return pending ? 'Waiting for the code at plex.tv/link' : 'Not signed in';
    var n = chosen().length;
    return user().name + (user().pass ? ' · Plex Pass' : '') + ' · ' + (n === 1 ? chosen()[0].name : n + ' servers');
  }

  return {
    signedIn: signedIn, added: added, user: user, describe: describe, onChange: onChange,
    connect: connect, cancel: cancel, pendingCode: pendingCode, signOut: signOut,
    servers: servers, chosen: chosen, server: server, loadServers: loadServers, choose: choose, reach: reach, call: call, door: door,
    sections: sections, libs: libs, setLib: setLib, shownLibraries: shownLibraries, rememberLibraries: rememberLibraries,
    homeUsers: homeUsers, switchUser: switchUser,
    _test: { state: function () { return state; }, reset: function (s) { state = s || {}; } }
  };
})();
