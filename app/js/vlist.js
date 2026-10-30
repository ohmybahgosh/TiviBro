/* Virtual list: a fixed pool of row elements repositioned with transforms.
   A 20,000 channel group costs the same DOM as a 12 channel one. */
function VList(host, opts) {
  'use strict';
  this.host = host;
  this.rowH = opts.rowH || 76;
  this.renderRow = opts.render;
  this.onSel = opts.onSel || function () {};
  this.empty = opts.empty || 'Nothing here';
  this.items = [];
  this.sel = 0;
  this.top = 0;
  this.pool = [];
  this.visible = Math.max(1, Math.floor(host.clientHeight / this.rowH) || opts.visible || 10);
  for (var i = 0; i < this.visible + 1; i++) {
    var r = document.createElement('div');
    r.className = 'row';
    r.style.display = 'none';
    host.appendChild(r);
    this.pool.push({ el: r, idx: -1, hidden: true, y: null, on: null });
  }
  this.emptyEl = U.el('div', 'empty hidden');
  host.appendChild(this.emptyEl);
  // Magic Remote: hovering a row focuses it, clicking it is OK.  opts.onHover lets the owner
  // move its own focus to this list first; opts.onClick(item, index) runs the OK action.
  var self = this;
  function rowIndex(e) {
    var el = e.target && e.target.closest ? e.target.closest('.row') : null;
    for (var i = 0; el && i < self.pool.length; i++) if (self.pool[i].el === el) return self.pool[i].idx;
    return -1;
  }
  host.addEventListener('mousemove', function (e) {
    if (!UI.pointer) return;
    var i = rowIndex(e); if (i < 0) return;
    if (opts.onHover) opts.onHover(self);
    if (i !== self.sel) { self.sel = i; self.draw(false); self.onSel(i, self.items[i]); }
  });
  host.addEventListener('click', function (e) {
    var i = rowIndex(e); if (i < 0) return;
    if (opts.onHover) opts.onHover(self);
    if (i !== self.sel) { self.sel = i; self.draw(false); self.onSel(i, self.items[i]); }
    if (opts.onClick) opts.onClick(self.items[i], i);
  });
}
VList.prototype.setItems = function (items, sel) {
  this.items = items || [];
  this.sel = U.clamp(sel || 0, 0, Math.max(0, this.items.length - 1));
  this.top = -1;
  this.ensure(true);
  this.draw(true);
};
VList.prototype.ensure = function (center) {
  var v = this.visible, n = this.items.length, top = this.top;
  if (center || top < 0) top = this.sel - Math.floor(v / 2);
  else if (this.sel < top + 1) top = this.sel - 1;
  else if (this.sel > top + v - 2) top = this.sel - v + 2;
  this.top = U.clamp(top, 0, Math.max(0, n - v));
};
VList.prototype.draw = function (force) {
  // Ring buffer: index i always lives in slot i % P, so scrolling one row re-renders
  // exactly one element and only moves the rest.
  var n = this.items.length, P = this.pool.length, i, slot;
  this.emptyEl.textContent = this.empty;
  this.emptyEl.classList.toggle('hidden', n > 0);
  var used = {};
  for (var idx = this.top; idx < Math.min(n, this.top + P); idx++) {
    slot = this.pool[idx % P];
    used[idx % P] = 1;
    if (force || slot.idx !== idx) {
      this.renderRow(slot.el, this.items[idx], idx);
      slot.idx = idx;
      if (slot.hidden) { slot.el.style.display = ''; slot.hidden = false; }
    }
    var y = (idx - this.top) * this.rowH;
    if (slot.y !== y) { slot.el.style.transform = 'translateY(' + y + 'px)'; slot.y = y; }
    var on = idx === this.sel;
    if (slot.on !== on) { slot.el.classList.toggle('sel', on); slot.on = on; }
  }
  for (i = 0; i < P; i++) if (!used[i] && !this.pool[i].hidden) { this.pool[i].el.style.display = 'none'; this.pool[i].hidden = true; this.pool[i].idx = -1; }
};
// wrap: one press past either end goes round to the other end, like a TV channel list.  Never
// while an arrow is held down, so holding Down stops at the bottom instead of racing round.
// Holding Up or Down speeds up the longer it is held: 2 rows a step after a second, 5 after
// two and a half, 15 after four, so the bottom of a 5,000 channel group is a few seconds away.
VList.prototype.move = function (d, wrap) {
  var n = this.items.length;
  if (!n) return false;
  if (Math.abs(d) === 1 && UI.repeating) {
    var now = Date.now();
    if (!this._held || now - this._lastRep > 400) this._held = now;
    this._lastRep = now;
    var t = now - this._held;
    d *= t > 4000 ? 15 : t > 2500 ? 5 : t > 1000 ? 2 : 1;
  } else this._held = 0;
  var s = this.sel + d;
  if (wrap && n > 2 && Math.abs(d) === 1 && !UI.repeating && (s < 0 || s >= n)) s = s < 0 ? n - 1 : 0;
  s = U.clamp(s, 0, n - 1);
  if (s === this.sel) return false;
  this.sel = s;
  this.ensure(false);
  this.draw(false);
  this.onSel(this.sel, this.items[this.sel]);
  return true;
};
VList.prototype.page = function (dir) { return this.move(dir * (this.visible - 1)); };
VList.prototype.current = function () { return this.items[this.sel]; };
VList.prototype.select = function (i) { this.sel = U.clamp(i, 0, Math.max(0, this.items.length - 1)); this.ensure(true); this.draw(false); };
VList.prototype.refresh = function () { this.draw(true); };
VList.prototype.refreshWhere = function (test) {
  for (var i = 0; i < this.pool.length; i++) {
    var s = this.pool[i];
    if (s.idx >= 0 && test(this.items[s.idx])) this.renderRow(s.el, this.items[s.idx], s.idx);
  }
};
VList.prototype.setActive = function (on) { this.host.classList.toggle('active', !!on); };
