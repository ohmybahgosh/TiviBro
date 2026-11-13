/* Languages (app/js/i18n.js): which one, the TV's first; plural forms; text with numbers and names in it;
   and every dictionary's translations keep the {n} and {x} of their English.
     node tests/unit/i18n.test.js */
'use strict';
const fs = require('fs'), path = require('path');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const APP = path.join(__dirname, '../../app/js');
function load(nav, settings, extra) {
  const ctx = { navigator: nav, Store: { settings: settings || {}, saveSettings() {} }, console };
  Object.assign(ctx, extra || {});
  const vm = require('vm');
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(APP, 'i18n.js'), 'utf8') + ';this.I18n = I18n;', ctx);
  ['es', 'es-ES', 'pt-BR', 'ru'].forEach((l) => vm.runInContext(fs.readFileSync(path.join(APP, 'lang', l + '.js'), 'utf8'), ctx));
  return ctx.I18n;
}

// Which language
let I = load({ language: 'es-MX', languages: ['es-MX', 'en-US'] });
ok('Automatic: the browser\'s language when the TV hasn\'t said', I.lang() === 'es' && I.locale() === 'es-MX');
I._setTV('ru-RU');
ok('the TV menu\'s language (settingsservice) comes first', I.lang() === 'ru');
I._setTV('de-DE');
ok('a language TiviBro doesn\'t have is English', I.lang() === 'en' && I.detected().supported === false);
I = load({ language: 'en-US' }, {}, { webOSSystem: { locale: 'ru-RU' } });
ok('webOSSystem.locale before the browser\'s', I.lang() === 'ru');
I = load({ language: 'ru-RU' }, { lang: 'es' });
ok('one chosen in Settings wins over the TV', I.lang() === 'es' && I.setting() === 'es');
I.set('auto');
ok('Automatic again: the TV\'s', I.lang() === 'ru' && I.setting() === 'auto');
let heard = '';
I.onChange((l) => { heard = l; });
I.set('en');
ok('a change is told to the screens', heard === 'en' && I.t('Settings') === 'Settings');

// Translations
I = load({ language: 'es-ES' });
ok('a key', I.t('Settings') === 'Configuración');
ok('not translated yet: English', I.t('Some text nobody translated') === 'Some text nobody translated');
ok('a pattern with a number, plural', I.t('3 hours') === '3 horas' && I.t('1 hours') === '1 hora');
ok('a pattern with a name', I.t('Stopped following the Detroit Lions') === 'Ya no sigues a Detroit Lions');
ok('a name that is a key itself is translated in it', I.t('The TV is set to Spanish.') === 'La TV está en Español.');
ok('a short pattern only with its values given: no "Welcome to Paradise" in Spanish', I.t('Welcome to Paradise') === 'Welcome to Paradise' && I.t('{x} to {y}', { x: '19:00', y: '20:30' }) === '19:00 a 20:30');
ok('a name is never translated', I.t(I.raw('Sports')) === 'Sports' && I.t('Sports') === 'Deportes' && String(I.raw('News')) === 'News' && 'x' + I.raw('News') === 'xNews');
ok('vars fill the translation', I.t('Language: {x}', { x: 'Español' }) === 'Idioma: Español');
ok('vars fill English too', load({ language: 'en' }).t('Language: {x}', { x: 'English' }) === 'Language: English');
ok('Spain: TV set to es-ES gets Spain\'s Spanish', I.lang() === 'es-ES' && I.locale() === 'es-ES');
ok('Spain\'s words: ordenador, mando a distancia, en directo', I.t('Or open the address on a computer.') === 'O abre la dirección en un ordenador.' && /mando a distancia/i.test(I.t('Remote and buttons')) && I.t('LIVE') === 'EN DIRECTO');
ok('Spain: the rest is the same Spanish', I.t('3 hours') === '3 horas' && I._dicts['es-ES'].Guide === I._dicts.es.Guide);
ok('Mexico stays Latin American Spanish', load({ language: 'es-MX' }).lang() === 'es' && /computadora/.test(load({ language: 'es-MX' }).t('Or open the address on a computer.')));
ok('Spain\'s Spanish can be chosen in Settings', load({ language: 'en-US' }, { lang: 'es-ES' }).lang() === 'es-ES' && load({}, {}).langs().some((l) => l.code === 'es-ES'));
I = load({ language: 'pt-BR' });
ok('Portuguese (discussion #84): a Brazilian TV gets it', I.lang() === 'pt-BR' && I.t('Settings') === 'Configurações' && I.t('3 hours') === '3 horas' && I.t('1 hours') === '1 hora');
ok('Portugal\'s Portuguese gets it too, and 0 is singular', load({ language: 'pt-PT' }).lang() === 'pt-BR' && I.plural('pt-BR', 0) === 0 && I.plural('pt-BR', 2) === 1);
I = load({ language: 'ru' });
ok('Russian plurals: 1 час, 3 часа, 5 часов, 21 час, 12 часов', ['1 hours', '3 hours', '5 hours', '21 hours', '12 hours'].map((x) => I.t(x)).join(',') === '1 час,3 часа,5 часов,21 час,12 часов', ['1 hours', '3 hours', '5 hours', '21 hours', '12 hours'].map((x) => I.t(x)));
ok('Russian plural rule', [1, 2, 4, 5, 11, 14, 21, 22, 25, 111].map((n) => I.plural('ru', n)).join('') === '0112220122');
ok('Spanish plural rule', [0, 1, 2].map((n) => I.plural('es', n)).join('') === '101');

// Every translation keeps the placeholders of its English, and no key is an empty translation.
const dicts = {};
const fake = { add(code, d) { dicts[code] = Object.assign(dicts[code] || {}, d); } };
['es', 'pt-BR', 'ru'].forEach((l) => new Function('I18n', fs.readFileSync(path.join(APP, 'lang', l + '.js'), 'utf8'))(fake));
Object.keys(dicts).forEach((code) => {
  const bad = [];
  Object.keys(dicts[code]).forEach((k) => {
    const want = (k.match(/\{[nxyz]\}/g) || []).sort().join(), vals = [].concat(dicts[code][k]);
    vals.forEach((v) => { if (!v || (v.match(/\{[nxyz]\}/g) || []).sort().join() !== want) bad.push(k + ' -> ' + v); });
    if (Array.isArray(dicts[code][k]) && dicts[code][k].length !== (code === 'ru' ? 3 : 2)) bad.push(k + ': ' + dicts[code][k].length + ' plural forms');
  });
  ok(code + ': every translation keeps its {n} and {x}', !bad.length, bad.slice(0, 5));
});
console.log(fails ? fails + ' failures' : 'all language checks passed');
process.exit(fails ? 1 : 0);
