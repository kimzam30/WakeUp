'use strict';
/* global hub */
// Find-in-page bar, used in pane headers (index.html) and pop-out windows (pop.html).
// eslint-disable-next-line no-unused-vars
function FindBar(id, host, onToggle) {
  const icon = (d) => `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const el = document.createElement('div');
  el.className = 'findbar'; el.hidden = true;
  el.innerHTML = `<input type="text" placeholder="Find in page" aria-label="Find in page" spellcheck="false" autocomplete="off">
    <span class="count" aria-live="polite"></span>
    <button class="hbtn" data-f="prev" title="Previous (Shift+Enter)" aria-label="Previous match">${icon('M4 10l4-4 4 4')}</button>
    <button class="hbtn" data-f="next" title="Next (Enter)" aria-label="Next match">${icon('M4 6l4 4 4-4')}</button>
    <button class="hbtn" data-f="close" title="Close (Esc)" aria-label="Close find">${icon('M4.5 4.5l7 7M11.5 4.5l-7 7')}</button>`;
  host.append(el);
  const input = el.querySelector('input'); const count = el.querySelector('.count');
  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a pane drag
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  const step = (forward) => { if (input.value) hub.find(id, input.value, forward, false); };
  input.addEventListener('input', () => { if (!input.value) count.textContent = ''; hub.find(id, input.value, true, true); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(!e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.dataset.f === 'close') close(); else step(b.dataset.f === 'next');
  }));
  function open() {
    const was = !el.hidden;
    el.hidden = false;
    if (!was) onToggle?.(true);
    input.focus(); input.select();
    if (input.value) hub.find(id, input.value, true, true);
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true; count.textContent = '';
    hub.findBar(id, false);
    onToggle?.(false);
  }
  return {
    open, close, node: el,
    get isOpen() { return !el.hidden; },
    found({ active, matches }) { count.textContent = !input.value ? '' : matches ? `${active} of ${matches}` : 'No matches'; el.classList.toggle('none', !!input.value && !matches); },
  };
}
