// Finding SMB servers on the network (service/smb-discover.js): mDNS (_smb._tcp), WS-Discovery with the
// computer's name from its metadata, NetBIOS (a name query, then node status), and only machines that
// really take SMB connections listed (a printer answering WS-Discovery is left out).  Stand-in responders
// on loopback addresses, no real network.
//   node tests/unit/smb-discover.test.js
'use strict';
const dgram = require('dgram'), net = require('net'), http = require('http');
const D = require('../../service/smb-discover.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fail++; };
const listen = (s, port, host) => new Promise((f) => s.bind ? s.bind(port, host, f) : s.listen(port, host, f));

// DNS records for the mDNS stand-in.
const name = (n) => Buffer.concat(n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])).concat([Buffer.from([0])]));
const u16 = (v) => Buffer.from([v >> 8, v & 255]);
const rr = (n, type, data) => Buffer.concat([name(n), u16(type), u16(1), Buffer.from([0, 0, 0, 120]), u16(data.length), data]);

(async () => {
  ok('the mDNS question asks for _smb._tcp.local PTR', D._mdnsQuery().indexOf(Buffer.from('_smb')) > 0 && D._mdnsQuery().slice(-4).equals(Buffer.from([0, 12, 0x80, 1])));
  ok('NetBIOS names are first-level encoded ("*" is CK then AA)', D._nbName('*').slice(1, 5).toString() === 'CKAA' && D._nbName('*').length === 34);
  ok('a ProbeMatch gives its endpoint and http address', D._parseProbeMatch('<wsa:Address>urn:uuid:1</wsa:Address><wsd:XAddrs>http://[fe80::1]:5357/x http://192.168.1.9:5357/x</wsd:XAddrs>').url === 'http://192.168.1.9:5357/x');

  // A TCP "SMB" port on every loopback address, and the port nothing listens on (the printer).
  const smb = net.createServer((c) => c.end()); await listen(smb, 0, '0.0.0.0');
  const smbPort = smb.address().port;
  const closed = net.createServer(); await listen(closed, 0, '127.0.0.1'); const deadPort = closed.address().port; closed.close();

  // mDNS: NAS on 127.0.0.1 with SMB on smbPort.
  const mdns = dgram.createSocket('udp4');
  mdns.on('message', (m, r) => {
    const ans = Buffer.concat([rr('_smb._tcp.local', 12, name('NAS._smb._tcp.local')), rr('NAS._smb._tcp.local', 33, Buffer.concat([u16(0), u16(0), u16(smbPort), name('nas.local')])), rr('nas.local', 1, Buffer.from([127, 0, 0, 1]))]);
    const pkt = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 0]), ans]);
    mdns.send(pkt, 0, pkt.length, r.port, r.address);
  });
  await listen(mdns, 0, '127.0.0.1');

  // WS-Discovery: a Windows PC on 127.0.0.2 (its metadata names it) and a printer on 127.0.0.4.
  const meta = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { res.end(/transfer\/Get/.test(b) ? '<pub:Computer>DESKTOP-PC/Workgroup:WORKGROUP</pub:Computer>' : ''); }); });
  await listen(meta, 0, '127.0.0.2');
  const wsd = dgram.createSocket('udp4');
  wsd.on('message', (m, r) => {
    if (!/Probe/.test(m.toString())) return;
    for (const [ip, url] of [['127.0.0.2', 'http://127.0.0.2:' + meta.address().port + '/pc'], ['127.0.0.4', 'http://127.0.0.4:1/printer']]) {
      const out = dgram.createSocket('udp4');
      out.bind(0, ip, () => { const b = Buffer.from('<wsd:ProbeMatches><wsa:Address>urn:uuid:' + ip + '</wsa:Address><wsd:XAddrs>' + url + '</wsd:XAddrs></wsd:ProbeMatches>'); out.send(b, 0, b.length, r.port, r.address, () => out.close()); });
    }
  });
  await listen(wsd, 0, '127.0.0.1');

  // NetBIOS: an old NAS on 127.0.0.3 answering the "*" query, then node status naming its file server.
  const nbns = dgram.createSocket('udp4');
  nbns.on('message', (m, r) => {
    const type = m.readUInt16BE(12 + 34);
    if (type === 0x20) { const b = Buffer.concat([m.slice(0, 2), Buffer.from([0x85, 0, 0, 0, 0, 1, 0, 0, 0, 0]), m.slice(12, 12 + 34), Buffer.from([0, 0x20, 0, 1, 0, 0, 0, 0, 0, 6, 0, 0, 127, 0, 0, 3])]); nbns.send(b, 0, b.length, r.port, r.address); }
    if (type === 0x21) {
      const entry = (n, suffix, flags) => Buffer.concat([Buffer.from(n.padEnd(15, ' ')), Buffer.from([suffix]), u16(flags)]);
      const names = Buffer.concat([Buffer.from([2]), entry('WORKGROUP', 0x00, 0x8400), entry('OLDNAS', 0x20, 0x0400)]);
      const b = Buffer.concat([m.slice(0, 2), Buffer.from([0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]), m.slice(12, 12 + 34), Buffer.from([0, 0x21, 0, 1, 0, 0, 0, 0]), u16(names.length), names]);
      nbns.send(b, 0, b.length, r.port, r.address);
    }
  });
  await listen(nbns, 0, '127.0.0.3');

  const t0 = Date.now();
  const r = await new Promise((f) => D.discover(f, {
    listenMs: 1200, own: { '127.0.0.9': 1 },
    targets: { mdns: { address: '127.0.0.1', port: mdns.address().port }, wsd: { address: '127.0.0.1', port: wsd.address().port }, nbns: { address: '127.0.0.3', port: nbns.address().port } },
    port445: (ip, port) => (port === smbPort ? smbPort : ip === '127.0.0.4' ? deadPort : smbPort)
  }));
  const by = {}; (r.servers || []).forEach((s) => { by[s.name] = s; });
  ok('mDNS: the NAS, by its name, with its port', by.NAS && by.NAS.server === '127.0.0.1:' + smbPort && by.NAS.via.indexOf('mdns') >= 0, r);
  ok('WS-Discovery: the PC, named from its metadata', by['DESKTOP-PC'] && by['DESKTOP-PC'].server === '127.0.0.2', r);
  ok('NetBIOS: the old NAS, by its file server name', by.OLDNAS && by.OLDNAS.server === '127.0.0.3', r);
  ok('the printer (no SMB) is left out', !(r.servers || []).some((s) => /127\.0\.0\.4/.test(s.server)), r);
  ok('sorted by name, in a few seconds', (r.servers || []).map((s) => s.name).join() === 'DESKTOP-PC,NAS,OLDNAS' && Date.now() - t0 < 6000, Date.now() - t0);

  const own = await new Promise((f) => D.discover(f, {
    listenMs: 900, own: { '127.0.0.3': 1 },
    targets: { mdns: { address: '127.0.0.1', port: 9 }, wsd: { address: '127.0.0.1', port: 9 }, nbns: { address: '127.0.0.3', port: nbns.address().port } },
    port445: () => smbPort
  }));
  ok('the TV\'s own addresses are left out (an LG TV answers as LGTV)', Array.isArray(own.servers) && own.servers.length === 0, own);
  const none = await new Promise((f) => D.discover(f, { listenMs: 300, targets: { mdns: { address: '127.0.0.1', port: 9 }, wsd: { address: '127.0.0.1', port: 9 }, nbns: { address: '127.0.0.1', port: 9 } } }));
  ok('nothing answering: an empty list, no error', Array.isArray(none.servers) && none.servers.length === 0, none);

  [smb, meta].forEach((s) => s.close()); [mdns, wsd, nbns].forEach((s) => s.close());
  console.log(fail ? fail + ' failed' : 'all smb discovery checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + e.stack); process.exit(1); });
