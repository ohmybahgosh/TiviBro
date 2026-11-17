/* Arrange shelves (My media, and the Movies and Shows homes): the shelves in a list, moved with the remote.
   OK picks the shelf up, Up and Down move it, OK (or Back) puts it down; Left or Right switches a shelf on or
   off.  Every change is saved at once.  The phone app gets a menu instead (media.js, vodhome.js), as its
   Settings can't show this board.
     Arrange.open({ title, rows: [{ key, name, sub, off }], save(order, offMap), reset(), done() }) */
var Arrange = (function () {
  'use strict';
  var box = null, list = null, opts = null, rows = [], at = 0, moving = false, prevHandler = null, VISIBLE = 11, top = 0;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function build() {
    if (box) return;
    box = el('div', 'arrange hidden'); box.setAttribute('role', 'dialog');
    var panel = el('div', 'arrange-panel');
    panel.appendChild(el('h2', 'arrange-title'));
    panel.appendChild(el('p', 'arrange-help'));
    panel.appendChild(el('div', 'arrange-more up'));
    list = el('ol', 'arrange-list'); panel.appendChild(list);
    panel.appendChild(el('div', 'arrange-more down'));   // "▼ 6 more below": a long list doesn't end at the panel's edge
    box.appendChild(panel);
    document.body.appendChild(box);
  }
  function save() {
    var off = {}; rows.forEach(function (r) { if (r.key) off[r.key] = !!r.off; });
    // (an action row, like Pin a category, has no key and isn't saved)
    opts.save(rows.filter(function (r) { return r.key; }).map(function (r) { return r.key; }), off);
  }
  function draw() {
    box.querySelector('.arrange-title').textContent = opts.title;
    box.querySelector('.arrange-help').textContent = moving ? '▲ ▼  move it    OK  put it here' : 'OK  pick up to move    ◀ ▶  on or off    Back  done';
    if (at < top) top = at; if (at >= top + VISIBLE) top = at - VISIBLE + 1;
    var above = top, below = Math.max(0, rows.length - top - VISIBLE), up = box.querySelector('.arrange-more.up'), dn = box.querySelector('.arrange-more.down');
    up.textContent = above ? '▲  ' + above + ' more above' : ''; up.classList.toggle('on', !!above);
    dn.textContent = below ? '▼  ' + below + ' more below' : ''; dn.classList.toggle('on', !!below);
    list.innerHTML = '';
    rows.slice(top, top + VISIBLE).forEach(function (r, n) {
      var i = top + n, li = el('li', 'arrange-row' + (i === at ? ' sel' : '') + (i === at && moving ? ' moving' : '') + (r.off ? ' off' : '') + (r.key ? '' : ' action'));
      li.appendChild(el('span', 'arrange-grip', r.key ? (i === at && moving ? '⇕' : '≡') : ''));
      var t = el('span', 'arrange-name', r.name); if (r.sub) t.appendChild(el('small', '', r.sub)); li.appendChild(t);
      if (r.key) { var sw = el('span', 'arrange-switch' + (r.off ? '' : ' on')); li.appendChild(sw); li.appendChild(el('span', 'arrange-pos', r.off ? 'Off' : String(rows.slice(0, i + 1).filter(function (x) { return x.key && !x.off; }).length))); }
      li.addEventListener('click', function () { at = i; key('ok'); });
      list.appendChild(li);
    });
    if (typeof UI !== 'undefined' && UI.hints) UI.hints(moving ? [['', '▲▼  move'], ['', 'OK  put it here', 'ok']] : [['', 'OK  move'], ['', '◀ ▶  on or off'], ['', 'Back  done', 'back']]);
  }
  function key(a) {
    var r = rows[at];
    if (moving) {
      if (a === 'up' || a === 'down') {
        var j = at + (a === 'up' ? -1 : 1);
        if (j >= 0 && j < rows.length && rows[j].key) { rows[at] = rows[j]; rows[j] = r; at = j; save(); }
      } else if (a === 'ok' || a === 'back' || a === 'left' || a === 'right') moving = false;
      draw(); return true;
    }
    if (a === 'up') at = Math.max(0, at - 1);
    else if (a === 'down') at = Math.min(rows.length - 1, at + 1);
    else if (a === 'chup') at = Math.max(0, at - VISIBLE);
    else if (a === 'chdown') at = Math.min(rows.length - 1, at + VISIBLE);
    else if (a === 'ok') { if (r && r.key) moving = true; else if (r && r.action) { close(); r.action(); return true; } }
    else if ((a === 'left' || a === 'right') && r && r.key) { r.off = !r.off; save(); }
    else if (a === 'back') { close(); return true; }
    draw(); return true;
  }
  function open(o) {
    build(); opts = o; rows = o.rows.map(function (r) { return { key: r.key, name: r.name, sub: r.sub, off: !!r.off, action: r.action }; });
    if (o.reset) rows.push({ name: 'Back to the way it was', sub: 'The first order, everything on that starts on', action: function () { o.reset(); } });
    at = o.focus ? Math.max(0, rows.map(function (r) { return r.key; }).indexOf(o.focus)) : 0; top = Math.max(0, at - 3); moving = false;
    box.classList.remove('hidden');
    prevHandler = typeof UI !== 'undefined' ? UI.handler : null;
    if (typeof UI !== 'undefined') { UI.setHandler(key); }
    draw();
  }
  function close() { box.classList.add('hidden'); moving = false; if (prevHandler && typeof UI !== 'undefined') UI.setHandler(prevHandler); if (opts && opts.done) opts.done(); }
  return { open: open, close: close, get open_() { return box && !box.classList.contains('hidden'); }, _test: { key: key, get rows() { return rows; }, get at() { return at; } } };
})();
