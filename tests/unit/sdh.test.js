/* Leave out sound notes (Settings > Audio and subtitles, discussion #100): [notes], (notes) and speakers' names in
   capitals go from the lines TiviBro draws, and only with the setting on.
     node tests/unit/sdh.test.js */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const ctx = { console, Math, JSON, Date, window: {}, Store: { settings: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/util.js'), 'utf8') + ';this.U = U;', ctx);
const U = ctx.U;
ok('a note on its own line goes', U.sdh('[door slams]\nHello.') === 'Hello.', U.sdh('[door slams]\nHello.'));
ok('a note inside a line goes', U.sdh('I said (quietly) no.') === 'I said no.');
ok('a speaker in capitals goes, a dash stays', U.sdh('- JOHN: Where are you?') === '- Where are you?', U.sdh('- JOHN: Where are you?'));
ok('a line left with only a dash goes', U.sdh('- (sighs)\n- Fine.') === '- Fine.', U.sdh('- (sighs)\n- Fine.'));
ok('ordinary words and names in other case stay', U.sdh('Dr. Smith: hi') === 'Dr. Smith: hi');
const el = { t: '', set textContent(v) { this.t = v; }, get textContent() { return this.t; } };
U.lines(el, '[music]\nHi.');
ok('off: the lines are drawn as they are', el.t === '[music]\nHi.', el.t);
ctx.Store.settings.subSdh = true; U.lines(el, '[music]\nHi.');
ok('on: drawn without the note', el.t === 'Hi.', el.t);
console.log(fails ? fails + ' FAILED' : 'all sound note checks passed');
process.exit(fails ? 1 : 0);
