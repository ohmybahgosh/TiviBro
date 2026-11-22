/* Finding Windows and network shares (SMB servers) on the TV's network, for My media's Add a share.  Three
   ways in, asked at once, because each kind of machine answers a different one:

     mDNS (Bonjour)      _smb._tcp.local: Macs, Linux and Raspberry Pi boxes with Samba and Avahi, Synology
                         and QNAP with Bonjour on.  Gives a name, the host and the port.
     WS-Discovery        a Probe to 239.255.255.250:3702: Windows 10 and 11 with network discovery on, Samba
                         boxes running wsdd, Synology with Windows network discovery ticked.  Gives an address;
                         the name comes from asking that address for its metadata (pub:Computer).
     NetBIOS             a name query for "*" to the broadcast address, then a node status to each that
                         answers: older NAS boxes, routers with a USB drive, Windows with NetBIOS on.

   Printers and other devices answer WS-Discovery too, so every address found is checked for SMB itself: a
   TCP connection to its port (445) has to open within a second.  The answer is a list of
   { name, server, via }, server being what goes in the Add a share form (an address, with :port when not
   445).  Nothing is logged but the count.  Plain ES5 for Node 0.12 (webOS 4).

   The TV's own addresses are left out (an LG TV answers WS-Discovery and NetBIOS as LGTV).
   Tests point the three at local stand-ins with opts.targets ({ mdns, wsd, nbns }: { address, port }),
   can skip or redirect the SMB check with opts.port445, and set opts.own (the addresses to leave out). */
'use strict';
require('./compat');
var dgram = require('dgram'), net = require('net'), os = require('os'), http = require('http'), URL_ = require('url'), crypto = require('crypto');

var LISTEN_MS = 2500, NAME_MS = 1500, CHECK_MS = 1000;
var TARGETS = { mdns: { address: '224.0.0.251', port: 5353 }, wsd: { address: '239.255.255.250', port: 3702 }, nbns: { address: '255.255.255.255', port: 137 } };

function str(v) { return v == null ? '' : String(v); }
function uuid() { var h = crypto.randomBytes(16).toString('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); }
function isV4(a) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(str(a)); }
// The TV's own addresses: an LG TV answers WS-Discovery and NetBIOS itself (as LGTV), and isn't a share.
function ownAddresses() {
  var out = {}, all = {};
  try { all = os.networkInterfaces(); } catch (e) {}
  Object.keys(all).forEach(function (k) { (all[k] || []).forEach(function (a) { if (a && a.address) out[a.address] = 1; }); });
  return out;
}

/* ---------- mDNS ---------- */

// A DNS name as labels: "_smb._tcp.local" -> [5]_smb[4]_tcp[5]local[0].
function dnsName(name) {
  var parts = [];
  name.split('.').forEach(function (l) { var b = Buffer.from(l, 'utf8'); parts.push(Buffer.from([b.length]), b); });
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
// The question: PTR _smb._tcp.local, asking for a unicast answer (QU).
function mdnsQuery() {
  var head = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([head, dnsName('_smb._tcp.local'), Buffer.from([0, 12, 0x80, 1])]);
}
// Reads a (possibly compressed) name at off: { name, end }.  Bounded, so a bad packet can't loop.
function readName(b, off) {
  var labels = [], end = -1, hops = 0;
  while (off < b.length && hops < 40) {
    var len = b[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) { if (off + 1 >= b.length) break; if (end < 0) end = off + 2; off = ((len & 0x3f) << 8) | b[off + 1]; hops++; continue; }
    labels.push(b.toString('utf8', off + 1, Math.min(b.length, off + 1 + len)));
    off += 1 + len;
  }
  return { name: labels.join('.'), end: end < 0 ? off : end };
}
/* The records in one mDNS answer: { ptr: [instance names], srv: { instance: { host, port } }, a: { host: ip } }. */
function parseMdns(b) {
  var out = { ptr: [], srv: {}, a: {} };
  if (!b || b.length < 12) return out;
  var count = b.readUInt16BE(4) + b.readUInt16BE(6) + b.readUInt16BE(8) + b.readUInt16BE(10), off = 12, i;
  for (i = 0; i < b.readUInt16BE(4) && off < b.length; i++) off = readName(b, off).end + 4;   // skip questions
  count -= b.readUInt16BE(4);
  for (i = 0; i < count && off + 10 <= b.length; i++) {
    var n = readName(b, off), type = b.readUInt16BE(n.end), rlen = b.readUInt16BE(n.end + 8), data = n.end + 10;
    if (data + rlen > b.length) break;
    if (type === 12) out.ptr.push(readName(b, data).name);
    else if (type === 33 && rlen >= 7) out.srv[n.name.toLowerCase()] = { port: b.readUInt16BE(data + 4), host: readName(b, data + 6).name };
    else if (type === 1 && rlen === 4) out.a[n.name.toLowerCase()] = b[data] + '.' + b[data + 1] + '.' + b[data + 2] + '.' + b[data + 3];
    off = data + rlen;
  }
  return out;
}

/* ---------- WS-Discovery ---------- */

var NS = 'xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof"';
function wsdProbe() {
  return Buffer.from('<?xml version="1.0" encoding="utf-8"?><soap:Envelope ' + NS + '><soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>' +
    '<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action><wsa:MessageID>urn:uuid:' + uuid() + '</wsa:MessageID></soap:Header>' +
    '<soap:Body><wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe></soap:Body></soap:Envelope>', 'utf8');
}
// A ProbeMatch: the device's endpoint (urn:uuid:...) and its first http address, if it gave one.
function parseProbeMatch(text) {
  var addr = /<(?:\w+:)?Address>\s*([^<\s]+)\s*<\/(?:\w+:)?Address>/.exec(text), xaddrs = /<(?:\w+:)?XAddrs>\s*([^<]+)<\/(?:\w+:)?XAddrs>/.exec(text);
  var url = xaddrs ? xaddrs[1].trim().split(/\s+/).filter(function (u) { return /^http:\/\/\d{1,3}(\.\d{1,3}){3}[:/]/.test(u); })[0] : '';
  return { endpoint: addr ? addr[1] : '', url: url || '' };
}
/* The computer's name from its metadata (WS-Transfer Get): "DESKTOP-PC/Workgroup:WORKGROUP" -> DESKTOP-PC.
   cb(name or ''). */
function wsdName(match, cb) {
  if (!match.url) return cb('');
  var u = URL_.parse(match.url), done = false;
  var body = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope ' + NS + '><soap:Header><wsa:To>' + match.endpoint + '</wsa:To>' +
    '<wsa:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/Get</wsa:Action><wsa:MessageID>urn:uuid:' + uuid() + '</wsa:MessageID>' +
    '<wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo></soap:Header><soap:Body/></soap:Envelope>';
  function end(n) { if (!done) { done = true; cb(n); } }
  var req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.path, method: 'POST', agent: false, headers: { 'Content-Type': 'application/soap+xml', 'Content-Length': Buffer.byteLength(body) } }, function (res) {
    var text = '';
    res.setEncoding('utf8');
    res.on('data', function (d) { if (text.length < 65536) text += d; });
    res.on('end', function () {
      var m = /<(?:\w+:)?Computer>\s*([^<]+?)\s*<\/(?:\w+:)?Computer>/.exec(text) || /<(?:\w+:)?FriendlyName[^>]*>\s*([^<]+?)\s*<\//.exec(text);
      end(m ? m[1].split('/')[0].trim().slice(0, 80) : '');
    });
  });
  req.on('error', function () { end(''); });
  req.setTimeout(NAME_MS, function () { req.abort(); end(''); });
  req.end(body);
}

/* ---------- NetBIOS ---------- */

// "*" or a name, first-level encoded (each nibble + 'A'), as the 34-byte question name.
function nbName(name) {
  var out = [32], i, c;
  for (i = 0; i < 16; i++) {
    c = i < name.length ? name.charCodeAt(i) & 0xff : (name === '*' ? 0 : 0x20);
    out.push(0x41 + (c >> 4), 0x41 + (c & 15));
  }
  out.push(0);
  return Buffer.from(out);
}
// A name query for "*" (broadcast), or a node status (NBSTAT, type 0x21) to one address.
function nbQuery(status) {
  var id = crypto.randomBytes(2);
  return Buffer.concat([id, Buffer.from([status ? 0x00 : 0x01, status ? 0x00 : 0x10, 0, 1, 0, 0, 0, 0, 0, 0]), nbName('*'), Buffer.from([0, status ? 0x21 : 0x20, 0, 1])]);
}
// The server name in a node status answer: the unique name with suffix 0x20 (the file server service).
function parseNodeStatus(b) {
  if (!b || b.length < 57) return '';
  var off = 12 + 34 + 10, n = b[off], i;           // header, name, type/class/ttl/rdlength
  for (i = 0; i < n && off + 1 + (i + 1) * 18 <= b.length; i++) {
    var at = off + 1 + i * 18, suffix = b[at + 15], flags = b.readUInt16BE(at + 16);
    if (suffix === 0x20 && !(flags & 0x8000)) return b.toString('ascii', at, at + 15).replace(/\s+$/, '');
  }
  return '';
}

/* ---------- is it SMB? ---------- */
function smbOpen(host, port, cb) {
  var s, done = false;
  function end(ok) { if (done) return; done = true; try { s.destroy(); } catch (e) {} cb(ok); }
  try { s = net.connect(port, host); } catch (e) { return cb(false); }
  s.on('connect', function () { end(true); });
  s.on('error', function () { end(false); });
  s.setTimeout(CHECK_MS, function () { end(false); });
}

/* ---------- all of it ---------- */
/* cb({ servers: [{ name, server, via }] }), sorted by name.  Each address once, the friendliest name
   kept (mDNS, then WS-Discovery's computer name, then NetBIOS, then the address). */
function discover(cb, opts) {
  opts = opts || {};
  var targets = opts.targets || TARGETS, listenMs = opts.listenMs || LISTEN_MS;
  var hosts = {}, wsdMatches = [], nbAnswered = [], socks = [], finished = false, own = opts.own || ownAddresses();
  function note(ip, port, name, via) {
    if (!isV4(ip) || (own[ip] && !opts.keepOwn)) return;
    var k = ip + ':' + (port || 445), h = hosts[k] || (hosts[k] = { ip: ip, port: port || 445, names: {}, via: [] });
    if (name && !h.names[via]) h.names[via] = name;
    if (h.via.indexOf(via) < 0) h.via.push(via);
  }
  function sock(onMessage, broadcast) {
    var s; try { s = dgram.createSocket('udp4'); } catch (e) { return null; }
    s.on('error', function () {});
    s.on('message', function (m, r) { try { onMessage(m, r); } catch (e) {} });
    socks.push(s);
    s.bind(0, function () { if (broadcast) { try { s.setBroadcast(true); } catch (e) {} } });
    return s;
  }
  function send(s, b, t) { if (s) setTimeout(function () { try { s.send(b, 0, b.length, t.port, t.address); } catch (e) {} }, 50); }
  // mDNS: names come with the answer; an instance's host and port from SRV, its address from A (or the sender).
  var m = sock(function (msg, r) {
    var p = parseMdns(msg);
    p.ptr.forEach(function (inst) {
      var srv = p.srv[inst.toLowerCase()] || {}, ip = (srv.host && p.a[srv.host.toLowerCase()]) || r.address;
      note(ip, srv.port || 445, inst.split('._smb')[0].slice(0, 80), 'mdns');
    });
  });
  // WS-Discovery: an address now, the name asked for afterwards.
  var w = sock(function (msg, r) {
    var pm = parseProbeMatch(msg.toString('utf8'));
    var ip = pm.url ? URL_.parse(pm.url).hostname : r.address;
    wsdMatches.push({ ip: ip, match: pm });
    note(ip, 445, '', 'wsd');
  });
  // NetBIOS: who answers "*", then each one's server name.
  var n = sock(function (msg, r) {
    if (msg.length > 3 && (msg[3] & 0x0f) === 0 && msg.length >= 57 && msg.readUInt16BE(12 + 34) === 0x21) { note(r.address, 445, parseNodeStatus(msg), 'netbios'); return; }
    if (nbAnswered.indexOf(r.address) < 0) { nbAnswered.push(r.address); note(r.address, 445, '', 'netbios'); send(n, nbQuery(true), { address: r.address, port: targets.nbns.port }); }
  }, true);
  send(m, mdnsQuery(), targets.mdns); send(w, wsdProbe(), targets.wsd); send(n, nbQuery(false), targets.nbns);
  // Asked again twice: a reply can be lost, and a responder that has just started takes a moment.
  setTimeout(function () { send(m, mdnsQuery(), targets.mdns); send(w, wsdProbe(), targets.wsd); }, 700);
  setTimeout(function () { send(m, mdnsQuery(), targets.mdns); }, 1500);
  setTimeout(function () {
    // WS-Discovery names, then (all at once) the SMB check of every address.
    var left = wsdMatches.length;
    function names() {
      if (finished) return; finished = true;
      socks.forEach(function (s) { try { s.close(); } catch (e) {} });
      check();
    }
    if (!left) return names();
    var cut = setTimeout(names, NAME_MS + 200);
    wsdMatches.forEach(function (x) {
      wsdName(x.match, function (name) {
        if (name) note(x.ip, 445, name, 'wsd');
        if (--left === 0) { clearTimeout(cut); names(); }
      });
    });
  }, listenMs);
  function check() {
    var list = Object.keys(hosts).map(function (k) { return hosts[k]; }), left = list.length, out = [];
    if (!left) return cb({ servers: [] });
    list.forEach(function (h) {
      var p = opts.port445 ? opts.port445(h.ip, h.port) : h.port;
      if (p === false) return add(true);
      smbOpen(h.ip, p, add);
      function add(ok) {
        if (ok) out.push({ name: h.names.mdns || h.names.wsd || h.names.netbios || h.ip, server: h.ip + (h.port !== 445 ? ':' + h.port : ''), via: h.via });
        if (--left === 0) cb({ servers: out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }) });
      }
    });
  }
}

/* Where a server answers now, by its name (a share whose address changed, or a Windows name the TV's DNS
   doesn't know): cb(server or '').  Names match without case, .local or a domain after the first dot. */
function locate(name, cb, opts) {
  var want = str(name).toLowerCase().replace(/\.local\.?$/, '').split('.')[0];
  if (!want) return cb('');
  discover(function (r) {
    var hit = (r.servers || []).filter(function (s) { return s.name.toLowerCase().replace(/\.local\.?$/, '').split('.')[0] === want; })[0];
    cb(hit ? hit.server : '');
  }, opts);
}

module.exports = { discover: discover, locate: locate, _parseMdns: parseMdns, _mdnsQuery: mdnsQuery, _parseProbeMatch: parseProbeMatch, _parseNodeStatus: parseNodeStatus, _nbName: nbName };
