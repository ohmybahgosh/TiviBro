/* A provider's full link, split into what TiviBro needs (issue #11).  Shared by the TV's set-up screen
   and the web editor (copied to service/editor/links.js by the build).
     Links.parse('http://host:8080/get.php?username=a&password=b&type=m3u_plus&output=ts')
       -> { type: 'xtream', server: 'http://host:8080', user: 'a', pass: 'b', from: 'get.php' }
   Any link with a username and password is an Xtream Codes login: get.php, player_api.php, xmltv.php
   and panel_api.php links, and stream links (/live/user/pass/123.ts, /movie/..., /series/...).  A panel
   under a folder keeps it (http://host/tv/get.php?... -> http://host/tv).  Anything else is an M3U
   playlist address: { type: 'm3u', m3u: link }.  null for an empty or unreadable link. */
var Links = (function () {
  'use strict';
  function param(q, k) {
    var m = new RegExp('[?&]' + k + '=([^&#]*)', 'i').exec(q);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; }
  }
  function seg(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function parse(link) {
    var s = String(link || '').trim();
    if (!s || /\s/.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
    var m = /^(https?):\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?/i.exec(s);
    if (!m) return null;
    var origin = m[1].toLowerCase() + '://' + m[2], path = m[3] || '', q = m[4] || '';
    var user = param(q, 'username'), pass = param(q, 'password'), from = '';
    var api = /^(.*?)\/(get|player_api|xmltv|panel_api)\.php$/i.exec(path);
    var base = '';
    if (api) { base = api[1]; from = api[2].toLowerCase() + '.php'; }
    if (!(user && pass)) {
      // Stream links: /live/user/pass/123.ts, /movie/user/pass/9.mkv, /series/....  (The short form
      // /user/pass/123 is left out: plain M3U addresses can look the same.)
      var st = /^(.*?)\/(?:live|movie|series)\/([^\/]+)\/([^\/]+)\/[^\/]+$/i.exec(path);
      if (st) { base = st[1]; user = seg(st[2]); pass = seg(st[3]); from = 'stream link'; }
    }
    if (user && pass) return { type: 'xtream', server: origin + (base && base !== '/' ? base : ''), user: user, pass: pass, from: from || 'link' };
    // A server address alone (no path, no login) is not a playlist: the caller asks for the login.
    return { type: 'm3u', m3u: s, bare: !q && (!path || path === '/') };
  }
  return { parse: parse };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Links;
