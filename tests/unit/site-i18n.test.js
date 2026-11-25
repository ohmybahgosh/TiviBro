/* tivibro.app in other languages (scripts/site/i18n-site.js): what counts as one text, the checks on a
   translation, and a page rebuilt in a language (texts, attributes, links, paths, lang, alternates, picker).
     node tests/unit/site-i18n.test.js */
'use strict';
const assert = require('assert');
const S = require('../../scripts/site/i18n-site.js');

const page = '<!doctype html><html lang="en"><head><title>TiviBro: Free IPTV</title><meta name="description" content="A free player.">' +
  '<link rel="canonical" href="https://tivibro.app/how-to-install/"><link rel="stylesheet" href="/style.css"></head><body>' +
  '<header><nav><a href="/">Home</a> <a href="/how-to-install/">Install</a></nav></header>' +
  '<p>Open the <b>Homebrew Channel</b>, then <code>curl -fsSL x | sh</code> runs.</p>' +
  '<img src="img/a.webp" alt="The guide"><script>var s = "Not this";</script><svg><text>Nor this</text></svg>' +
  '<a href="/videos/">Videos</a> <a href="https://github.com/x">GitHub</a></body></html>';

const keys = S.pieces(page).map((p) => p.key);
assert.ok(keys.indexOf('Open the <b>Homebrew Channel</b>, then <code>curl -fsSL x | sh</code> runs.') >= 0, 'a sentence with its inline tags is one text: ' + JSON.stringify(keys));
assert.ok(keys.indexOf('TiviBro: Free IPTV') >= 0 && keys.indexOf('A free player.') >= 0 && keys.indexOf('The guide') >= 0, 'title, description and alt');
assert.ok(!keys.some((k) => /Not this|Nor this/.test(k)), 'never scripts or drawings');

assert.equal(S.problem('Open the <b>Channel</b>.', 'Öffne den <b>Channel</b>.'), '');
assert.ok(S.problem('Open the <b>Channel</b>.', 'Öffne den Channel.'), 'a lost tag is refused');
assert.ok(S.problem('A', 'B — C'), 'no em dash');
assert.ok(S.problem('A', ''), 'nothing empty');

const de = S.LANGS.find((l) => l.code === 'de');
const dict = { 'Open the <b>Homebrew Channel</b>, then <code>curl -fsSL x | sh</code> runs.': 'Öffne den <b>Homebrew Channel</b>, dann läuft <code>curl -fsSL x | sh</code>.',
  'TiviBro: Free IPTV': 'TiviBro: Kostenloses IPTV', 'The guide': 'Der Guide', 'A free player.': 'Ein kostenloser Player.' };
const out = S.translatePage(page, 'how-to-install/index.html', de, dict);
assert.ok(/<html lang="de"/.test(out), 'the language');
assert.ok(out.indexOf('Öffne den <b>Homebrew Channel</b>') >= 0 && out.indexOf('<title>TiviBro: Kostenloses IPTV</title>') >= 0 && out.indexOf('alt="Der Guide"') >= 0 && out.indexOf('content="Ein kostenloser Player."') >= 0, 'texts, title, alt and description');
assert.ok(out.indexOf('href="/de/how-to-install/"') >= 0 && out.indexOf('href="/de/"') >= 0, 'links to translated pages stay in the language');
assert.ok(out.indexOf('href="/videos/"') < 0 && out.indexOf('href="/de/videos/"') >= 0 && out.indexOf('href="https://github.com/x"') >= 0, 'other sites are left alone');
assert.ok(out.indexOf('src="../../img/a.webp"') >= 0 && out.indexOf('href="/style.css"') >= 0, 'relative files one folder deeper; absolute ones as they were');
assert.ok(out.indexOf('<link rel="canonical" href="https://tivibro.app/de/how-to-install/">') >= 0, 'its own canonical address');
assert.ok(/hreflang="x-default" href="https:\/\/tivibro\.app\/how-to-install\/"/.test(out) && /hreflang="pt" href="https:\/\/tivibro\.app\/pt\/how-to-install\/"/.test(out), 'every language named for search engines');
assert.ok(/class="lang-pick"[\s\S]*aria-current="true">🇩🇪 Deutsch/.test(out), 'the picker, with this language marked');
assert.ok(out.indexOf('var s = "Not this"') >= 0, 'scripts untouched');

const en = S.translatePage(page, 'how-to-install/index.html', { code: 'en', dir: '', flag: '🇺🇸', name: 'English' }, {});
assert.ok(/<html lang="en"/.test(en) && en.indexOf('href="/how-to-install/"') >= 0 && /class="lang-pick"/.test(en), 'English keeps its text and links, and gets the picker');
console.log('PASS tivibro.app in other languages: texts with their tags, checks, links, paths, lang, alternates and the picker');
