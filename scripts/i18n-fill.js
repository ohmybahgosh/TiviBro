#!/usr/bin/env node
/* Fills in what's missing in one language with Claude (the Anthropic API), checked like any import.
     ANTHROPIC_API_KEY=... node scripts/i18n-fill.js de              everything missing, 80 texts a request
     ANTHROPIC_API_KEY=... node scripts/i18n-fill.js de --max 200    at most 200 this time
   I18N_MODEL picks the model (default claude-sonnet-4-5).  Each batch has the rules and the glossary's words
   (scripts/i18n-todo.js); what comes back goes through scripts/i18n-lib.js problem() and is written where each
   text shows.  A text that fails the checks is asked once more on its own with what was wrong, then left
   for a person.  Run it on a computer with the key in the environment: never commit a key.
   Without a key, the same work by hand: i18n-todo.js, translate, i18n-import.js. */
'use strict';
const cp = require('child_process'), path = require('path');
const L = require('./i18n-lib.js');
const code = process.argv[2], mi = process.argv.indexOf('--max'), max = mi > 0 ? +process.argv[mi + 1] : Infinity;
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.I18N_MODEL || 'claude-sonnet-4-5', BATCH = 80;
if (!code || !L.lang(code)) { console.error('node scripts/i18n-fill.js <code> [--max N]'); process.exit(1); }
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set.  Without it: node scripts/i18n-todo.js ' + code + ' > todo.json, translate, node scripts/i18n-import.js ' + code + ' done.json'); process.exit(1); }

// One request: the rules, the glossary words for these texts, and the texts; back, one JSON object.
async function ask(todo, items, fixes) {
  const prompt = 'Translate these English texts from TiviBro, an IPTV app for LG TVs (with a phone app and a web editor), into ' + todo.name + '.\n\n' +
    'Rules:\n- ' + todo.rules.join('\n- ') + '\n\nPlural forms in ' + todo.name + ': ' + todo.forms.count + ' (' + todo.forms.order.join('; ') + ').  ' + todo.forms.note + '\n\n' +
    (fixes ? 'These were translated before but failed a check; the reason is given with each.  Fix them.\n\n' : '') +
    'Texts (JSON; "terms" are the words this app already uses for its own names, "where" says where the text shows):\n' +
    JSON.stringify(items.map((x) => Object.assign({ key: x.key, where: x.where.join('; ').slice(0, 120) }, x.plural ? { plural: x.plural } : {}, x.terms ? { terms: x.terms } : {}, x.note ? { note: x.note } : {}, fixes ? { problem: fixes[x.key] } : {})), null, 1) +
    '\n\nAnswer with only the JSON object, no other text.';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('Anthropic API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json(), text = (j.content || []).map((c) => c.text || '').join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('no JSON in the answer');
  return JSON.parse(m[0]);
}

(async () => {
  const todo = JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'i18n-todo.js'), code], { maxBuffer: 64 << 20 }).toString());
  const items = todo.items.slice(0, max);
  console.log(items.length + ' of ' + todo.items.length + ' texts into ' + todo.name + ' with ' + MODEL);
  let written = 0, left = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    let got = await ask(todo, batch);
    let res = L.importAll(code, got, false);
    // Once more for the ones that failed a check, told what was wrong.
    if (res.bad.length) {
      const fixes = {}; res.bad.forEach((b) => { fixes[b.key] = b.why + ' (was ' + JSON.stringify(got[b.key]).slice(0, 200) + ')'; });
      const again = L.importAll(code, await ask(todo, batch.filter((x) => x.key in fixes), fixes), false);
      res = { tv: res.tv + again.tv, ed: res.ed + again.ed, bad: again.bad, unknown: res.unknown };
    }
    written += res.tv + res.ed;
    left = left.concat(res.bad);
    console.log('  ' + Math.min(i + BATCH, items.length) + '/' + items.length + ': written ' + (res.tv + res.ed) + (res.bad.length ? ', ' + res.bad.length + ' left for a person' : ''));
  }
  console.log('Done: ' + written + ' written.' + (left.length ? '  Left (fix by hand, then i18n-import.js):' : ''));
  left.forEach((b) => console.log('  ' + JSON.stringify(b.key).slice(0, 90) + ': ' + b.why));
  process.exitCode = left.length ? 1 : 0;
})().catch((e) => { console.error(e.message); process.exit(1); });
