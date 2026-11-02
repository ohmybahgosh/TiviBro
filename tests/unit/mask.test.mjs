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
for (const keep of ['https://github.com/ohmybahgosh/TiviBro/issues/25', 'https://raw.githubusercontent.com/a/b/refs/heads/master/list.m3u8', 'https://www.reddit.com/r/IPTV/12345', 'Fixed in 0.6.0-alpha.58, see #24', 'https://tivibro.app/apk/'])
  same(keep, keep, 'left alone: ' + keep);
ok('masking twice changes nothing more', m(m('http://prov.example:80/u1/p1/5.ts')) === m('http://prov.example:80/u1/p1/5.ts'));
console.log(fails ? fails + ' FAILED' : 'all masking checks passed');
process.exit(fails ? 1 : 0);
