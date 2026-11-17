/* What TiviBro is doing in the background, in a small chip under the clock on every screen (not over
   fullscreen video): loading the guide, scanning a My media source, fetching movie and show details from
   TMDB.  Several at once take turns every 4 seconds.  Each part says what it is doing with
   Activity.set(id, text), and Activity.set(id, '') when it is done. */
var Activity = (function () {
  'use strict';
  var items = {}, order = [], at = 0, el = null, timer = null;
  function box() {
    if (!el && typeof document !== 'undefined' && document.body) { el = document.createElement('div'); el.id = 'activity'; el.className = 'activity hidden'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    return el;
  }
  function draw() {
    var b = box(); if (!b) return;
    if (!order.length) { b.classList.add('hidden'); b.textContent = ''; return; }
    at = at % order.length;
    b.textContent = items[order[at]] + (order.length > 1 ? '   (' + (at + 1) + ' of ' + order.length + ')' : '');
    b.classList.remove('hidden');
  }
  function set(id, text) {
    text = String(text || '');
    if (text) { if (!items[id]) order.push(id); items[id] = text; }
    else if (items[id]) { delete items[id]; order.splice(order.indexOf(id), 1); }
    if (order.length > 1 && !timer) timer = setInterval(function () { at++; draw(); }, 4000);
    if (order.length < 2 && timer) { clearInterval(timer); timer = null; at = 0; }
    draw();
  }
  function list() { return order.map(function (k) { return items[k]; }); }
  return { set: set, list: list };
})();
