/* Logins out of public reports and issues (relay/mask.js): what the relay and the Mask logins workflow
   take out, and what they leave alone.
     node --no-warnings tests/unit/mask.test.mjs */
import { maskSecrets as m } from '../../relay/mask.js';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const same = (a, b, n) => ok(n, m(a) === b, m(a));

same('Start "AB" with ts engine  http://<provider>:80/someuser/somepass/745415.ts', 'Start "AB" with ts engine  http://<provider>:80/***/***/745415.ts', 'the short Xtream link in a log the TV had already half masked (issue #25)');
same('http://dns.example-panel.com:80/632270679/F823j7133R/244074', 'http://<provider>/***/***/244074', 'the short link in an M3U line, with its port');
same('http://prov.example:8080/live/bob/secret/12.m3u8', 'http://<provider>/live/***/***/12.m3u8', '/live/ links');
same('http://prov.example/movie/bob/secret/77.mkv', 'http://<provider>/movie/***/***/77.mkv', '/movie/ links');
same('http://prov.example/get.php?username=bob&password=pw&type=m3u_plus', 'http://prov.example/get.php?username=***&password=***&type=m3u_plus', 'logins in a query');
same('http://bob:pw@prov.example/x', 'http://***:***@prov.example/x', 'user:pass@');
same('Helper replied  {"returnValue":true,"port":47811,"ctl":"197ba610decdd091e5d4a0c0634f6a65"}', 'Helper replied  {"returnValue":true,"port":47811,"ctl":"***"}', "the helper's control key (issue #26)");
same('body="relay error: getaddrinfo ENOTFOUND line.example-panel.top"', 'body="relay error: getaddrinfo ENOTFOUND <server>"', 'a server name in a DNS error from the helper (issue #93)');
same('helper: connect ECONNREFUSED 203.0.113.7:443  url=https://<provider>/get.php', 'helper: connect ECONNREFUSED <server>:443  url=https://<provider>/get.php', 'an address and port in a refused connection (issue #93)');
same("Hostname/IP does not match certificate's altnames: Host: tv.example.net. is not in the cert's altnames: DNS:*.cdn.example.org, DNS:cdn.example.org", "Hostname/IP does not match certificate's altnames: Host: <server>. is not in the cert's altnames: DNS:<server>, DNS:<server>", 'server names in a certificate error');
const rep = (s) => m(s, { addresses: true });
ok('a report: any public IPv4 address', rep('dns 198.51.100.23 answered nothing; tv at 203.0.113.9') === 'dns <address> answered nothing; tv at <address>', rep('dns 198.51.100.23 answered nothing; tv at 203.0.113.9'));
for (const keep of ['Mozilla/5.0 Chrome/87.0.4280.88 Safari/537.36', 'TV 192.168.1.20 on 10.0.0.1', 'webOS 6.3.1.2-x', 'DNS 1.1.1.1 / 8.8.8.8 / 9.9.9.9, ControlD 76.76.2.11'])
  ok('a report, left alone: ' + keep, rep(keep) === keep, rep(keep));
same('Cloudflare (203.0.113.9) works here', 'Cloudflare (203.0.113.9) works here', "someone's own post keeps an address (discussion #60)");
for (const keep of ['getaddrinfo ENOTFOUND <provider>', 'connect ECONNREFUSED 127.0.0.1:47811', 'ETIMEDOUT after 15001ms', 'getaddrinfo EAI_AGAIN api.github.com'])
  same(keep, keep, 'left alone: ' + keep);
for (const keep of ['https://github.com/ohmybahgosh/TiviBro/issues/25', 'https://raw.githubusercontent.com/a/b/refs/heads/master/list.m3u8', 'https://www.reddit.com/r/IPTV/12345', 'Fixed in 0.6.0-alpha.58, see #24', 'https://tivibro.app/apk/'])
  same(keep, keep, 'left alone: ' + keep);
const enc = m('http://127.0.0.1:47811/st***/***/449.ts?stb=***&cmd=ffmpeg%20http%3A%2F%2Fmag.portal.example%3A80%2Fplay%2Flive.php%3Fmac%3D00%3A1A%3A79%3AD3%3A5C%3A20%26stream%3D449%26play_token%3D28sQIO2Iz6');
ok('a Stalker portal link inside a link, percent-encoded: no MAC, play token or server (issue #91)', !/D3|5C|28sQIO2Iz6|portal\.example/.test(enc) && /stream=449/.test(enc), enc);
same('http://mag.portal.example/play/live.php?mac=00:1A:79:D3:5C:20&stream=449', 'http://<provider>/play/live.php?mac=***&stream=449', 'a plain portal link: no MAC or server');
same('MAC 00:1A:79:D3:5C:20 in a sentence', 'MAC 00:1A:79:**:**:** in a sentence', 'a MAC address on its own keeps only its first half');
ok('masking twice changes nothing more', m(m('http://prov.example:80/u1/p1/5.ts')) === m('http://prov.example:80/u1/p1/5.ts'));
console.log(fails ? fails + ' FAILED' : 'all masking checks passed');
process.exit(fails ? 1 : 0);
