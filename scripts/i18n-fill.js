#!/usr/bin/env node
/* Fills in what's missing in one language with Claude (the Anthropic API), checked like any import.
     node scripts/i18n-fill.js --test               which key this is, its organization, and that the model answers
     node scripts/i18n-fill.js de                   everything missing, through the Message Batches API
     node scripts/i18n-fill.js de --now             the same, one request after another (no waiting for a batch)
     node scripts/i18n-fill.js de --max 200         at most 200 texts this time
     node scripts/i18n-fill.js de --results r.jsonl  a finished batch's results file (its results_url), not asked again
   The key comes from ANTHROPIC_API_KEY (never commit it); I18N_MODEL picks the model (claude-sonnet-5-5).

   Cost: the rules, plural forms and the whole glossary go first as the system prompt, marked for prompt
   caching, so every request after the first reads them from the cache (a tenth of the price).  The batch
   way (the default) runs every request at once at half price, usually done within minutes (up to a day at
   the most); --now asks them one by one at full price.
   What comes back goes through scripts/i18n-lib.js problem() and is written where each text shows.  A text
   that fails a check is asked once more on its own (one by one), told what was wrong, then left for a person.
   Without a key, the same work by hand: i18n-todo.js, translate, i18n-import.js. */
'use strict';
const cp = require('child_process'), path = require('path');
const L = require('./i18n-lib.js');
const argv = process.argv.slice(2), code = argv[0], mi = argv.indexOf('--max'), max = mi > 0 ? +argv[mi + 1] : Infinity;
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.I18N_MODEL || 'claude-sonnet-5-5', BATCH = 80, API = 'https://api.anthropic.com/v1';
const HEAD = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' };
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set.  Without it: node scripts/i18n-todo.js <code> > todo.json, translate, node scripts/i18n-import.js <code> done.json'); process.exit(1); }

async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: HEAD, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('Anthropic API ' + r.status + ' on ' + url + ': ' + (await r.text()).slice(0, 300));
  return r;
}

// The key: which one (its last characters), its organization, the models it can use, and a one-word answer.
async function test() {
  const r = await api('GET', '/models?limit=50'), j = await r.json();
  console.log('Key   sk-ant-…' + KEY.slice(-6));
  console.log('Org   ' + (r.headers.get('anthropic-organization-id') || 'not said'));
  console.log('Models  ' + (j.data || []).map((m) => m.id).join(', '));
  const m = await (await api('POST', '/messages', { model: MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'Say OK.' }] })).json();
  console.log(MODEL + ' answers: ' + (m.content || []).map((c) => c.text).join('').trim() + '  (' + m.usage.input_tokens + ' in, ' + m.usage.output_tokens + ' out)');
}

/* The part every request shares, cached: the rules, the plural forms and every glossary word in this language.
   Then each request has only its own texts. */
function system(todo, g) {
  return [{ type: 'text', cache_control: { type: 'ephemeral' }, text:
    'You translate TiviBro, an IPTV app for LG TVs with a phone app and a web editor, from English into ' + todo.name + '.\n\n' +
    'Rules:\n- ' + todo.rules.join('\n- ') + '\n\nPlural forms in ' + todo.name + ': ' + todo.forms.count + ' (' + todo.forms.order.join('; ') + ').  ' + todo.forms.note + '\n\n' +
    'Glossary: TiviBro\'s own words and how they are translated here.  Use them every time:\n' +
    Object.keys(g.words).map((t) => '- ' + t + ' = ' + g.words[t] + (g.notes[t] ? '  (' + g.notes[t] + ')' : '')).join('\n') +
    '\n\nEach message gives texts as JSON ("where" says where the text shows; "plural" how many forms a list needs; "problem" what was wrong with an earlier try).  Answer with only one JSON object, English text to translation, nothing else.' }];
}
function params(sys, items, fixes) {
  return { model: MODEL, max_tokens: 16000, system: sys, messages: [{ role: 'user', content: (fixes ? 'These failed a check before; fix them.\n' : '') +
    JSON.stringify(items.map((x) => Object.assign({ key: x.key, where: x.where.join('; ').slice(0, 120) }, x.plural ? { plural: x.plural } : {}, x.note ? { note: x.note } : {}, fixes ? { problem: fixes[x.key] } : {})), null, 1) }] };
}
function parse(msg) {
  const text = (msg.content || []).map((c) => c.text || '').join(''), m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('no JSON in the answer');
  return JSON.parse(m[0]);
}
const usage = { in: 0, cached: 0, out: 0 };
function count(msg) { const u = msg.usage || {}; usage.in += u.input_tokens || 0; usage.cached += u.cache_read_input_tokens || 0; usage.out += u.output_tokens || 0; }
async function now(p) { const m = await (await api('POST', '/messages', p)).json(); count(m); return parse(m); }

// Every batch of texts as one Message Batch; back, { batch number: translations } as each request ended.
async function batched(sys, batches) {
  const b = await (await api('POST', '/messages/batches', { requests: batches.map((items, i) => ({ custom_id: 'b' + i, params: params(sys, items) })) })).json();
  console.log('Batch ' + b.id + ': ' + batches.length + ' requests sent, waiting for them');
  let s = b;
  while (s.processing_status !== 'ended') {
    await new Promise((r) => setTimeout(r, 20000));
    s = await (await api('GET', '/messages/batches/' + b.id)).json();
    const c = s.request_counts || {};
    console.log('  ' + (c.succeeded || 0) + ' done, ' + (c.processing || 0) + ' working, ' + ((c.errored || 0) + (c.expired || 0)) + ' failed');
  }
  return results((await (await fetch(s.results_url, { headers: HEAD })).text()));
}
// A batch's results (JSON lines): { batch number: translations }.
function results(text) {
  const out = {};
  for (const line of text.split('\n').filter(Boolean)) {
    const r = JSON.parse(line), i = +r.custom_id.slice(1);
    if (r.result.type !== 'succeeded') { console.log('  request ' + i + ': ' + r.result.type); continue; }
    count(r.result.message);
    try { out[i] = parse(r.result.message); } catch (e) { console.log('  request ' + i + ': ' + e.message); }
  }
  return out;
}

(async () => {
  if (code === '--test') return test();
  if (!code || !L.lang(code)) { console.error('node scripts/i18n-fill.js <code> [--now] [--max N]  |  --test'); process.exit(1); }
  const todo = JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'i18n-todo.js'), code], { maxBuffer: 64 << 20 }).toString());
  const items = todo.items.slice(0, max), g = L.glossary(code), sys = system(todo, g), batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  console.log(items.length + ' of ' + todo.items.length + ' texts into ' + todo.name + ' with ' + MODEL + ', ' + batches.length + ' requests' + (argv.includes('--now') ? ', one by one' : ', as one batch'));
  let written = 0, left = [], retry = [];
  // The answers: written, and what failed a check kept to ask again.
  function take(batch, got) {
    const res = L.importAll(code, got, false), fixes = {};
    written += res.tv + res.ed;
    res.bad.forEach((b) => { fixes[b.key] = b.why + ' (was ' + JSON.stringify(got[b.key]).slice(0, 200) + ')'; });
    batch.forEach((x) => { if (!(x.key in got)) fixes[x.key] = 'missing from the answer'; });
    if (Object.keys(fixes).length) retry.push({ items: batch.filter((x) => x.key in fixes), fixes });
  }
  if (argv.includes('--now')) for (let i = 0; i < batches.length; i++) { take(batches[i], await now(params(sys, batches[i]))); console.log('  ' + (i + 1) + '/' + batches.length + ', ' + written + ' written'); }
  else {
    // A finished batch's results kept in a file (the same texts in the same order): read, not asked again.
    const ri = argv.indexOf('--results');
    const got = ri > 0 ? results(require('fs').readFileSync(argv[ri + 1], 'utf8')) : await batched(sys, batches);
    batches.forEach((b, i) => take(b, got[i] || {}));
  }
  // Once more, one by one, for what failed: then it's left for a person.
  for (const r of retry) {
    const got = await now(params(sys, r.items, r.fixes)), res = L.importAll(code, got, false);
    written += res.tv + res.ed;
    left = left.concat(res.bad, r.items.filter((x) => !(x.key in got)).map((x) => ({ key: x.key, why: 'missing from the answer twice' })));
  }
  console.log('Done: ' + written + ' written.  Tokens: ' + usage.in + ' in, ' + usage.cached + ' more read from the cache, ' + usage.out + ' out.' + (left.length ? '  Left (fix by hand, then i18n-import.js):' : ''));
  left.forEach((b) => console.log('  ' + JSON.stringify(b.key).slice(0, 90) + ': ' + b.why));
  process.exitCode = left.length ? 1 : 0;
})().catch((e) => { console.error(e.message); process.exit(1); });
