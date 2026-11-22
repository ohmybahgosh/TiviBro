#!/usr/bin/env node
/* A stand-in for tivibro-smb (scripts/smb/tivibro-smb.c) for the helper's tests: the same commands, output
   and errors, reading a local folder instead of a share.  FAKE_SMB_ROOT holds one folder per share;
   the login (stdin: user, password, domain) must be tv / pw, except on a share named "guest" (any login).
   FAKE_SMB_SLOW=ms waits that long before each answer; FAKE_SMB_LOG appends each command line to a file;
   FAKE_SMB_DOWN=a,b makes those servers unreachable (a server whose address changed).
     tivibro-smb check|shares|ls|stat|tree|cat <server[:port]> [share] [path] [depth | offset length] */
'use strict';
const fs = require('fs'), path = require('path');
const [cmd, server, share, rel, from, count] = process.argv.slice(2);
if (cmd === '-version') { console.log('tivibro-smb 2 (fake)'); process.exit(0); }
function fail(kind, status) { process.stderr.write(JSON.stringify({ error: kind, status: status || '0x00000000', step: cmd, detail: kind }) + '\n'); process.exit(2); }
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => setTimeout(main, +process.env.FAKE_SMB_SLOW || 0));
function main() {
  if (process.env.FAKE_SMB_LOG) fs.appendFileSync(process.env.FAKE_SMB_LOG, [cmd, server, share, rel, from, count].filter((x) => x !== undefined).join(' ') + '\n');
  const [user, pass] = input.split('\n');
  if (/^nohost|:1$/.test(server) || String(process.env.FAKE_SMB_DOWN || '').split(',').indexOf(server) >= 0) return fail('unreachable');
  const root = process.env.FAKE_SMB_ROOT;
  if (cmd === 'shares') {
    if (user !== 'tv' || pass !== 'pw') return fail('login', '0xc000006d');
    fs.readdirSync(root).forEach((n) => console.log(JSON.stringify({ name: n, comment: '' })));
    return;
  }
  const dir = path.join(root, share || '');
  if (!share || !fs.existsSync(dir)) return fail('noshare', '0xc00000cc');
  if (share !== 'guest' && (user !== 'tv' || pass !== 'pw')) return fail('login', '0xc000006d');
  const p = path.join(dir, String(rel || '').replace(/^\/+/, ''));
  if (cmd === 'check') return console.log(JSON.stringify({ ok: true, dialect: '3.1.1', maxRead: 8388608 }));
  if (!fs.existsSync(p)) return fail('notfound', '0xc0000034');
  const st = fs.statSync(p);
  const row = (name, s) => JSON.stringify({ name, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: Math.floor(s.mtimeMs / 1000) });
  if (cmd === 'ls') return fs.readdirSync(p).forEach((n) => console.log(row(n, fs.statSync(path.join(p, n)))));
  if (cmd === 'stat') return console.log(row(rel, st));
  if (cmd === 'tree') {
    const walk = (dirRel, depth) => {
      const full = path.join(dir, dirRel), names = fs.readdirSync(full), subs = names.filter((n) => fs.statSync(path.join(full, n)).isDirectory());
      console.log(JSON.stringify({ path: dirRel, mtime: Math.floor(fs.statSync(full).mtimeMs / 1000), files: names.length - subs.length }));
      if (depth > 0) subs.forEach((n) => walk(dirRel ? dirRel + '/' + n : n, depth - 1));
    };
    return walk(String(rel || '').replace(/^\/+|\/+$/g, ''), +from);
  }
  if (cmd === 'cat') {
    const at = +from, len = +count, end = len < 0 ? st.size : Math.min(st.size, at + len);
    if (at >= end) return;
    return fs.createReadStream(p, { start: at, end: end - 1 }).pipe(process.stdout);
  }
  fail('other');
}
