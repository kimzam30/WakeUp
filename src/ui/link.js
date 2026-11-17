'use strict';
/* global hub, btnSvg, svg, $ */
// The bar on top of a link window: back/forward/reload, the page's title, and two ways back into WakeUp:
// the Dock button, or dragging the title onto the WakeUp window (it shows where the page will go).
const bar = document.getElementById('linkbar');
const DOCK = svg('<path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3M8 2.5v7M5 6.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', '0 0 16 16', 'none');
for (const b of bar.querySelectorAll('[data-a]')) {
  const a = b.dataset.a;
  b.innerHTML = a === 'dock' ? `${DOCK}<span>Dock into WakeUp</span>` : btnSvg(a);
  b.addEventListener('click', () => hub.linkAction(a));
}
let token = null;
function show(info) {
  if (!info) return;
  token = info.token;
  $('.lb-title', bar).textContent = info.title || info.app;
  let host = ''; try { host = new URL(info.url).hostname.replace(/^www\./, ''); } catch { /* about:blank while loading */ }
  $('.lb-host', bar).textContent = host;
  bar.querySelector('[data-a="back"]').disabled = !info.back;
  bar.querySelector('[data-a="forward"]').disabled = !info.forward;
  bar.classList.toggle('loading', !!info.loading);
}
hub.linkInit().then(show);
hub.onLink(show);

const grip = $('.lb-grip', bar);
grip.addEventListener('dragstart', (e) => {
  if (!token) { e.preventDefault(); return; }
  e.dataTransfer.setData('application/x-wakeup-link', token);
  e.dataTransfer.setData('text/plain', $('.lb-title', bar).textContent);
  e.dataTransfer.effectAllowed = 'move';
  document.body.classList.add('dragging-out');
  hub.linkDrag(true);
});
grip.addEventListener('dragend', () => { document.body.classList.remove('dragging-out'); hub.linkDrag(false); });
grip.addEventListener('dblclick', () => hub.linkAction('dock'));
