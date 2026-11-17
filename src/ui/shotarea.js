'use strict';
/* global hub, $, btnSvg, esc, clamp, showOverlay, closeOverlay, closePopover, toggleMenu, menuOpen, dlOpen, toggleDownloads, settingsOpen, toggleSettings,
   render, composeShot, showShotResult, showNotice, R, box */
/* eslint-disable no-unused-vars */
// Screenshot of an area you choose: WakeUp freezes the window (web pages included), you drag a box, then move it or
// drag its edges and corners to adjust. Enter or Capture saves it; Esc cancels. Started from a pane, the box starts on it.

async function pickArea(paneId = null) {
  closeOverlay(); closePopover(); if (menuOpen) toggleMenu(false); if (dlOpen) toggleDownloads(false); if (settingsOpen) toggleSettings(false);
  render();
  await new Promise((r) => setTimeout(r, 200)); // let the web views come back from under any menu
  const busy = showNotice({ id: 'shot', kind: 'busy', title: 'Getting the screen ready…' });
  const r = await hub.capture('all', null, null).catch(() => null);
  const full = r?.compose ? await composeShot(r.compose).catch(() => null) : null;
  if (!full) { showNotice({ id: busy, kind: 'error', title: 'The screenshot didn’t work', detail: 'Try again. If it keeps failing, the log folder (Settings, About) has details.' }); return; }
  showNotice({ id: busy, kind: 'info', title: 'Select an area', detail: 'Drag a box, then adjust it. Enter to capture, Esc to cancel.' });

  const H8 = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const o = showOverlay(`<div class="area-pick" tabindex="-1" aria-label="Select an area to capture">
    <img class="area-img" alt="">
    <div class="area-sel" hidden>${H8.map((k) => `<i class="ah ${k}" data-h="${k}"></i>`).join('')}</div>
    <div class="area-bar" hidden><span class="area-size"></span><button class="btn small" data-a="full">Whole window</button><button class="btn small" data-a="cancel">Cancel</button><button class="btn small primary" data-a="ok">${btnSvg('camera')}Capture</button></div>
    <p class="area-hint">Drag to select an area. Drag inside to move it, or its edges to resize. <kbd>Enter</kbd> captures, <kbd>Esc</kbd> cancels.</p></div>`);
  o.classList.add('area');
  const pick = $('.area-pick', o); const img = $('.area-img', o); const selEl = $('.area-sel', o); const bar = $('.area-bar', o);
  img.src = full;
  await img.decode().catch(() => {});
  const k = img.naturalWidth / innerWidth; // image pixels per CSS pixel
  const W = innerWidth; const Hh = innerHeight;
  let sel = null;
  const start = paneId && R[paneId] ? { x: box.left + R[paneId].x, y: box.top + R[paneId].y, w: R[paneId].w, h: R[paneId].h } : null;

  const draw = () => {
    selEl.hidden = !sel; bar.hidden = !sel; pick.classList.toggle('has-sel', !!sel);
    if (!sel) return;
    Object.assign(selEl.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
    $('.area-size', bar).textContent = `${Math.round(sel.w * k)} × ${Math.round(sel.h * k)}`;
    const bw = bar.offsetWidth; const bh = bar.offsetHeight;
    const below = sel.y + sel.h + 8 + bh < Hh; const above = sel.y - 8 - bh > 0;
    bar.style.left = `${clamp(sel.x + sel.w - bw, 8, W - bw - 8)}px`;
    bar.style.top = `${below ? sel.y + sel.h + 8 : above ? sel.y - 8 - bh : sel.y + sel.h - bh - 8}px`;
  };
  const norm = (a) => { // keep it on screen and at least 8px
    const x = clamp(Math.min(a.x, a.x + a.w), 0, W); const y = clamp(Math.min(a.y, a.y + a.h), 0, Hh);
    return { x, y, w: clamp(Math.abs(a.w), 8, W - x), h: clamp(Math.abs(a.h), 8, Hh - y) };
  };

  pick.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.area-bar')) return;
    e.preventDefault(); pick.setPointerCapture(e.pointerId);
    const hdl = e.target.dataset.h; const x0 = e.clientX; const y0 = e.clientY; const s0 = sel && { ...sel };
    const inside = s0 && !hdl && x0 >= s0.x && x0 <= s0.x + s0.w && y0 >= s0.y && y0 <= s0.y + s0.h;
    const move = (ev) => {
      const dx = ev.clientX - x0; const dy = ev.clientY - y0;
      if (hdl) { // resize from an edge or corner
        let { x, y, w, h } = s0;
        if (hdl.includes('w')) { x += dx; w -= dx; } if (hdl.includes('e')) w += dx;
        if (hdl.includes('n')) { y += dy; h -= dy; } if (hdl.includes('s')) h += dy;
        sel = norm({ x, y, w, h });
      } else if (inside) sel = { ...s0, x: clamp(s0.x + dx, 0, W - s0.w), y: clamp(s0.y + dy, 0, Hh - s0.h) }; // move
      else if (Math.abs(dx) + Math.abs(dy) > 3) sel = norm({ x: x0, y: y0, w: dx, h: dy }); // draw a new box
      draw();
    };
    const up = () => { pick.removeEventListener('pointermove', move); pick.removeEventListener('pointerup', up); pick.removeEventListener('pointercancel', up); };
    pick.addEventListener('pointermove', move); pick.addEventListener('pointerup', up); pick.addEventListener('pointercancel', up);
  });
  pick.addEventListener('dblclick', (e) => { if (sel && !e.target.closest('.area-bar')) capture(); });
  pick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && sel) { e.preventDefault(); capture(); }
    const step = e.shiftKey ? 10 : 1; const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && sel) { e.preventDefault(); sel = { ...sel, x: clamp(sel.x + d[0], 0, W - sel.w), y: clamp(sel.y + d[1], 0, Hh - sel.h) }; draw(); }
  });
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') { closeOverlay(); showNotice({ id: busy, kind: 'info', title: 'Screenshot cancelled' }); }
    else if (a === 'full') { sel = { x: 0, y: 0, w: W, h: Hh }; draw(); }
    else if (a === 'ok') capture();
  });

  async function capture() {
    const c = document.createElement('canvas'); c.width = Math.round(sel.w * k); c.height = Math.round(sel.h * k);
    c.getContext('2d').drawImage(img, sel.x * k, sel.y * k, sel.w * k, sel.h * k, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    closeOverlay();
    showNotice({ id: busy, kind: 'busy', title: 'Saving screenshot…' });
    const res = await hub.saveShot(url).catch(() => null);
    showShotResult(res || { error: 'The screenshot couldn’t be saved.' }, url);
  }

  sel = start; draw(); pick.focus();
}
