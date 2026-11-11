// The login lines in the log never carry the username or the panel's own address (issue #76): a report sent
// while a new playlist was being added (not saved yet, so the report's masking didn't know it) showed both.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };

const src = fs.readFileSync(path.join(__dirname, '../../app/js/source.js'), 'utf8');
const ctx = { console, Log: { info() {}, warn() {}, error() {}, debug() {} }, Store: { settings: {} }, Net: { active: false, wrap: u => u } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('var U = { secretShape: function (v) { return String(v).length + " chars"; } };', ctx);
vm.runInContext('var PlShape = { parseM3U: function () {} };', ctx);
vm.runInContext(src + '\nthis.Source = Source;', ctx);
const S = ctx.Source;

const user = 'abcd1234wxyz';
const shown = S.userShape(user);
ok('the username is shown as its first two letters and its shape', shown === 'ab*** (12 chars)', shown);
ok('the rest of the username is not in it', shown.indexOf('cd1234') < 0);
ok('no username says so', S.userShape('') === 'no username');
ok('the panel naming the address we logged in to: "same"', S.panelHost('Panel.Example.org', 'http://panel.example.org:80') === 'same');
ok('the panel naming another address: never the name', S.panelHost('other.example.net', 'http://panel.example.org') === 'another address');
ok('no address from the panel: ?', S.panelHost('', 'http://panel.example.org') === '?');
ok('the login line uses the shape, not the username', /'Login to ' \+ clean\(p\.server\) \+ ' as ' \+ userShape\(p\.user\)/.test(src));
ok('the login answer line uses panelHost', /' server=' \+ panelHost\(si\.url, found\)/.test(src));

if (fail) { console.log(fail + ' login log test(s) failed'); process.exit(1); }
console.log('all login log tests passed');
