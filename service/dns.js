/* Finding the provider's server: the TV's own DNS (the default), or one picked in Settings > Playlists > DNS
   (discussion #60): a public DNS server (Cloudflare, Google, Quad9 or one you type), or DNS over HTTPS (Cloudflare
   or Google), for a provider whose name the TV's DNS doesn't find or blocks.  Every request the helper makes looks
   names up through dns.lookup, so that is what is replaced; addresses, local names and IPv6-only asks go to the
   TV's DNS as before, and so does a name the chosen DNS can't answer (better a blocked answer than none).
   Answers are kept for their TTL (1 to 30 minutes).
     POST /net/dns  { mode, server }   (with TiviBro's secret)   ->  { mode, server }
     GET  /net/dns                                               ->  { mode, server, ok, failed, last }
   Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var dns = require('dns'), https = require('https');
var orig = dns.lookup;
var PRESET = { cloudflare: ['1.1.1.1', '1.0.0.1'], google: ['8.8.8.8', '8.8.4.4'], quad9: ['9.9.9.9', '149.112.112.112'] };
var DOH = { 'doh-cloudflare': { host: '1.1.1.1', path: '/dns-query' }, 'doh-google': { host: '8.8.8.8', path: '/resolve' } };
var mode = 'tv', custom = '', cache = {}, stats = { ok: 0, failed: 0, last: '' };
var IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isAddress(h) { return IPV4.test(h) || h.indexOf(':') >= 0; }
function isLocal(h) { return h === 'localhost' || !/\./.test(h) || /\.(?:local|lan|home|internal)$/i.test(h); }
var testServers = null;        // tests: a DNS server on another port
function servers() { return testServers || (mode === 'custom' ? (IPV4.test(custom) ? [custom] : []) : PRESET[mode] || []); }

// A plain DNS server: dns.Resolver (Node 8 on), or on Node 0.12 the module's own servers, which dns.lookup doesn't use.
var resolver = null;
function viaServer(host, cb) {
  var list = servers();
  if (!list.length) return cb(new Error('no DNS server'));
  try {
    if (dns.Resolver) { if (!resolver) resolver = new dns.Resolver(); resolver.setServers(list); return resolver.resolve4(host, done); }
    dns.setServers(list); dns.resolve4(host, done);
  } catch (e) { cb(e); }
  function done(e, ips) { if (e || !ips || !ips.length) return cb(e || new Error('no answer')); cb(null, ips[0], 300); }
}
// DNS over HTTPS: the JSON form both services answer, asked at their address (no name to look up first).
function viaHttps(host, cb) {
  var d = DOH[mode], finished = false;
  function end(e, ip, ttl) { if (!finished) { finished = true; cb(e, ip, ttl); } }
  var req = https.get({ host: d.host, path: d.path + '?name=' + encodeURIComponent(host) + '&type=A', headers: { Accept: 'application/dns-json' }, rejectUnauthorized: true }, function (res) {
    var body = '';
    res.on('data', function (c) { if (body.length < 65536) body += c; });
    res.on('end', function () {
      var j = null; try { j = JSON.parse(body); } catch (e) {}
      var a = j && Array.isArray(j.Answer) ? j.Answer.filter(function (x) { return x && x.type === 1 && IPV4.test(String(x.data)); }) : [];
      if (!a.length) return end(new Error('no answer'));
      end(null, String(a[0].data), +a[0].TTL || 300);
    });
  });
  req.on('error', end);
  req.setTimeout(6000, function () { req.abort(); end(new Error('timed out')); });
}
function resolve(host, cb) {
  var k = host.toLowerCase(), hit = cache[k];
  if (hit && hit.until > Date.now()) return cb(null, hit.ip);
  (DOH[mode] ? viaHttps : viaServer)(k, function (e, ip, ttl) {
    if (e) return cb(e);
    var keys = Object.keys(cache); if (keys.length > 500) cache = {};
    cache[k] = { ip: ip, until: Date.now() + Math.max(60, Math.min(1800, ttl || 300)) * 1000 };
    cb(null, ip);
  });
}
function lookup(host, opts, cb) {
  var args = arguments;
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (typeof opts === 'number') opts = { family: opts };
  opts = opts || {};
  if (mode === 'tv' || typeof host !== 'string' || !host || isAddress(host) || isLocal(host) || opts.family === 6) return orig.apply(dns, args);
  resolve(host, function (e, ip) {
    if (e) { stats.failed++; stats.last = host + ': ' + (e.code || e.message) + ', the TV\'s DNS instead'; return orig.call(dns, host, opts, cb); }
    stats.ok++;
    if (opts.all) return cb(null, [{ address: ip, family: 4 }]);
    cb(null, ip, 4);
  });
}
function set(m, server) {
  m = String(m || 'tv');
  if (m !== 'tv' && m !== 'custom' && !PRESET[m] && !DOH[m]) m = 'tv';
  mode = m; custom = m === 'custom' && IPV4.test(String(server || '').trim()) ? String(server).trim() : '';
  if (m === 'custom' && !custom) mode = 'tv';
  cache = {};
  dns.lookup = mode === 'tv' ? orig : lookup;
  return { mode: mode, server: custom };
}
function send(res, ALLOW, code, o) { var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; for (var k in ALLOW) h[k] = ALLOW[k]; res.writeHead(code, h); res.end(JSON.stringify(o)); }
function handle(req, res, ALLOW, log) {
  if (req.method !== 'POST') return send(res, ALLOW, 200, { mode: mode, server: custom, ok: stats.ok, failed: stats.failed, last: stats.last });
  var body = '';
  req.on('data', function (c) { if (body.length < 4096) body += c; });
  req.on('end', function () {
    var j = {}; try { j = JSON.parse(body); } catch (e) {}
    var was = mode, r = set(j.mode, j.server);
    if (log && r.mode !== was) log({ lv: 'info', event: 'dns', mode: r.mode, server: r.server });
    send(res, ALLOW, 200, r);
  });
}
module.exports = { set: set, handle: handle, lookup: lookup, _resolve: resolve, _servers: function (l) { testServers = l; cache = {}; }, get mode() { return mode; } };
