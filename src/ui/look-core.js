'use strict';
// How WakeUp looks, shared by the desktop app (main process and pages) and the Android app. No dependencies.
// - ACCENTS: the accent colour presets. Each was checked for contrast: white text on `accent` and `text`
//   on the page background are both at least 4.5:1, in light and in dark.
// - TODAY: the sections of the Today page. The order and hidden list sync; each app draws them its own way
//   and skips sections it doesn't have.
// - Icons for your own apps: which of a site's icons to try, best first.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LookCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  // [id, name, light {accent, text, soft}, dark {accent, text, soft}]
  const ACCENTS = [
    ['blue', 'Blue', ['#2b63d9', '#1f4fb8', '#eaf0fc'], ['#2b63d9', '#7fa6f5', '#1b2740']],
    ['violet', 'Violet', ['#6a45d1', '#5935b8', '#f0ecfb'], ['#6a45d1', '#b4a0f5', '#251f3d']],
    ['green', 'Green', ['#1d7a4c', '#17663f', '#e3f2ea'], ['#1d7a4c', '#7dd3a8', '#18301f']],
    ['teal', 'Teal', ['#0e7580', '#0b636b', '#e0f2f3'], ['#0e7580', '#6fcfd6', '#152e30']],
    ['orange', 'Orange', ['#b8520c', '#9c450a', '#fcefe3'], ['#b8520c', '#f2a66b', '#36261a']],
    ['red', 'Red', ['#c0352b', '#a3291f', '#fdecea'], ['#c0352b', '#f59a92', '#3a1e1c']],
    ['pink', 'Pink', ['#bb2f74', '#a02662', '#fbe9f2'], ['#bb2f74', '#f29cc8', '#381c2b']],
    ['graphite', 'Graphite', ['#454543', '#30302e', '#ececea'], ['#5c5c59', '#d2d2ce', '#2c2c2b']],
  ];
  const ACCENT_IDS = ACCENTS.map((a) => a[0]);
  // {accent, accentText, accentSoft} for a preset in light or dark
  function accent(id, dark) {
    const a = ACCENTS.find((x) => x[0] === id) || ACCENTS[0];
    const [accentColor, accentText, accentSoft] = dark ? a[3] : a[2];
    return { accent: accentColor, accentText, accentSoft };
  }

  // [id, name, what it shows]
  const TODAY = [
    ['next', 'Next class', 'The class that’s on now or next, with its venue, notes and Join button'],
    ['classes', 'Today’s classes', 'Every class today, with changes and notes'],
    ['tasks', 'Tasks due', 'What’s due today or late, and a quick add on the computer'],
    ['week', 'Coming up this week', 'Tasks due in the next 7 days (phone and tablet)'],
    ['apps', 'Your apps', 'Your apps, and your saved splits on the computer'],
    ['recent', 'Recent files', 'Downloads and screenshots (computer)'],
  ];
  const TODAY_IDS = TODAY.map((t) => t[0]);
  const todayDefault = () => ({ order: [...TODAY_IDS], hidden: [] });
  // Keeps known ids once each; sections missing from the order go back where they are by default
  function cleanToday(v) {
    const r = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const order = [...new Set((Array.isArray(r.order) ? r.order : []).filter((id) => TODAY_IDS.includes(id)))];
    TODAY_IDS.forEach((id, i) => {
      if (order.includes(id)) return;
      const before = TODAY_IDS.slice(0, i).reverse().find((x) => order.includes(x));
      order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
    });
    const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter((id) => TODAY_IDS.includes(id)))];
    return { order, hidden };
  }
  // The sections to draw, in order, of the ones this app has
  const todaySections = (v, has = TODAY_IDS) => { const t = cleanToday(v); return t.order.filter((id) => has.includes(id) && !t.hidden.includes(id)); };
  function moveToday(v, id, dir) {
    const t = cleanToday(v); const i = t.order.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= t.order.length) return t;
    [t.order[i], t.order[j]] = [t.order[j], t.order[i]];
    return t;
  }
  const showToday = (v, id, on) => { const t = cleanToday(v); t.hidden = on ? t.hidden.filter((x) => x !== id) : [...new Set([...t.hidden, id])]; return t; };

  // ---- icons for your own apps
  const ICON_MAX = 90000; // characters in the data: URL; it syncs inside settings
  const ICON_RE = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;
  const isIcon = (s) => typeof s === 'string' && s.length < ICON_MAX && ICON_RE.test(s);
  // Raster icons only: Android can't draw SVG, and SVG can carry scripts
  const RASTER = /^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|webp|gif)$/i;
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
  const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#x2f;/gi, '/').replace(/&quot;/g, '"');
  // A page's icons, best first: apple-touch-icon (180px), then the largest PNG icon, other icons, /favicon.ico.
  // Only https addresses; SVG is skipped.
  function iconCandidates(html, pageUrl) {
    let base; try { base = new URL(pageUrl); } catch { return []; }
    const head = String(html || '').slice(0, 200000);
    const baseTag = head.match(/<base\s[^>]*>/i);
    if (baseTag) { try { base = new URL(unescape(attr(baseTag[0], 'href')), base); } catch { /* keep the page address */ } }
    const found = [];
    for (const tag of head.match(/<link\s[^>]*>/gi) || []) {
      const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
      const href = attr(tag, 'href');
      if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))) continue;
      const type = attr(tag, 'type').toLowerCase();
      if (type.includes('svg') || /\.svg(\?|#|$)/i.test(href) || rel.includes('mask-icon')) continue;
      let u; try { u = new URL(unescape(href), base); } catch { continue; }
      if (u.protocol !== 'https:') continue;
      const size = Math.max(0, ...attr(tag, 'sizes').split(/\s+/).map((s) => parseInt(s, 10) || 0));
      const touch = rel.some((r) => r.startsWith('apple-touch-icon'));
      // best around 96–192px: big enough to be sharp, small enough to sync
      const fit = touch ? 1000 + Math.min(size || 180, 192) : size > 256 ? 300 - size / 100 : size || 16;
      found.push({ url: u.href, fit });
    }
    found.sort((a, b) => b.fit - a.fit);
    const urls = [...new Set(found.map((f) => f.url))];
    if (base.protocol === 'https:') { const fav = new URL('/favicon.ico', base).href; if (!urls.includes(fav)) urls.push(fav); }
    return urls.slice(0, 6);
  }

  return { ACCENTS, ACCENT_IDS, accent, TODAY, TODAY_IDS, todayDefault, cleanToday, todaySections, moveToday, showToday, ICON_MAX, isIcon, RASTER, iconCandidates };
}));
