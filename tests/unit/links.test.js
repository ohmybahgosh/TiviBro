// Full link parsing (issue #11): app/js/links.js, shared by the TV's set-up screen and the web editor.
const Links = require('../../app/js/links.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const x = (s) => Links.parse(s);
let r = x('http://host.tv:8080/get.php?username=bob&password=s3cret&type=m3u_plus&output=ts');
ok('get.php link: server, username, password', r.type === 'xtream' && r.server === 'http://host.tv:8080' && r.user === 'bob' && r.pass === 's3cret' && r.from === 'get.php', r);
r = x('https://host.tv/player_api.php?username=a%40b&password=p%26w');
ok('player_api.php, https, encoded characters', r.type === 'xtream' && r.server === 'https://host.tv' && r.user === 'a@b' && r.pass === 'p&w', r);
r = x('host.tv:25461/xmltv.php?username=u&password=p');
ok('xmltv.php without http://', r.type === 'xtream' && r.server === 'http://host.tv:25461', r);
r = x('http://host.tv/panel/get.php?username=u&password=p');
ok('a panel in a folder keeps the folder', r.server === 'http://host.tv/panel', r);
r = x('http://host.tv:8080/live/user1/pass1/12345.ts');
ok('live stream link', r.type === 'xtream' && r.server === 'http://host.tv:8080' && r.user === 'user1' && r.pass === 'pass1', r);
r = x('http://host.tv:8080/movie/user1/pass1/999.mkv');
ok('movie link', r.type === 'xtream' && r.user === 'user1', r);
r = x('http://cdn.example.com/lists/2024/12345');
ok('a plain address that looks like a short stream link stays M3U', r.type === 'm3u', r);
r = x('http://cdn.example.com/lists/my.m3u8');
ok('a plain M3U address stays M3U', r.type === 'm3u' && r.m3u === 'http://cdn.example.com/lists/my.m3u8' && !r.bare, r);
r = x('http://host.tv/get.php?type=m3u_plus');
ok('get.php without a login stays M3U', r.type === 'm3u', r);
r = x('http://host.tv:8080');
ok('a bare server address is flagged', r.type === 'm3u' && r.bare === true, r);
ok('empty or junk gives nothing', x('') === null && x('two words') === null);
if (fail) { console.log(fail + ' link test(s) failed'); process.exit(1); }
console.log('all full link tests passed');
