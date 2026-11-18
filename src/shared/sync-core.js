'use strict';
// Cloud sync logic shared by the desktop app (main process) and the Android app. No dependencies.
//
// The planner is stored in the cloud as one row per entity: each class, one-off change and task, plus the
// semester. A device sends only the rows it changed; the server stamps every write with its own clock, and the
// newest row wins. Deleting something writes a tombstone (deleted = true) so devices that were offline drop it too.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SyncCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const LISTS = { class: 'classes', change: 'changes', task: 'tasks' };
  // settings that follow you between devices; window sizes, layouts, folders, sidebar and per-app notification
  // mutes stay on each device
  const SYNCED_SETTINGS = ['theme', 'weekStart', 'nickname', 'reminders', 'classLabel', 'customApps', 'taskReminder', 'accent', 'today'];

  const key = (kind, id) => `${kind}:${id}`;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // planner → Map("kind:id" → { kind, id, data })
  function explode(p) {
    const out = new Map();
    if (!p) return out;
    out.set(key('semester', 'current'), { kind: 'semester', id: 'current', data: p.semester });
    for (const [kind, list] of Object.entries(LISTS)) {
      for (const x of p[list] || []) if (x && typeof x.id === 'string') out.set(key(kind, x.id), { kind, id: x.id, data: x });
    }
    return out;
  }

  // What changed between two planners: rows to upsert and rows to tombstone.
  function diff(prev, next) {
    const a = explode(prev); const b = explode(next);
    const upserts = []; const deletes = [];
    for (const [k, row] of b) if (!a.has(k) || !same(a.get(k).data, row.data)) upserts.push(row);
    for (const [k, row] of a) if (!b.has(k) && row.kind !== 'semester') deletes.push({ kind: row.kind, id: row.id });
    return { upserts, deletes };
  }

  // Apply cloud rows ({ kind, id, data, deleted }) to a planner. Order is kept; new items go at the end.
  // `pending` (Set of "kind:id") are local edits not yet uploaded: they win over what the cloud sent.
  function apply(planner, rows, pending = new Set()) {
    const p = {
      semester: planner.semester,
      classes: [...(planner.classes || [])], changes: [...(planner.changes || [])], tasks: [...(planner.tasks || [])],
    };
    let changed = false;
    for (const r of rows) {
      if (!r || pending.has(key(r.kind, r.id))) continue;
      if (r.kind === 'semester') {
        if (!r.deleted && r.data && !same(p.semester, r.data)) { p.semester = r.data; changed = true; }
        continue;
      }
      const list = LISTS[r.kind]; if (!list) continue;
      const i = p[list].findIndex((x) => x.id === r.id);
      if (r.deleted) { if (i >= 0) { p[list].splice(i, 1); changed = true; } continue; }
      if (!r.data || r.data.id !== r.id) continue;
      if (i < 0) { p[list].push(r.data); changed = true; } else if (!same(p[list][i], r.data)) { p[list][i] = r.data; changed = true; }
    }
    return { planner: p, changed };
  }

  // Outbox: the rows this device still has to upload. Later edits to the same entity replace earlier ones.
  function queue(outbox, { upserts, deletes }) {
    const m = new Map((outbox || []).map((r) => [key(r.kind, r.id), r]));
    for (const r of upserts) m.set(key(r.kind, r.id), { kind: r.kind, id: r.id, data: r.data, deleted: false });
    for (const r of deletes) m.set(key(r.kind, r.id), { kind: r.kind, id: r.id, data: {}, deleted: true });
    return [...m.values()];
  }
  const pendingKeys = (outbox) => new Set((outbox || []).map((r) => key(r.kind, r.id)));

  const pickSettings = (s) => Object.fromEntries(SYNCED_SETTINGS.filter((k) => s && k in s).map((k) => [k, s[k]]));
  const settingsDiffer = (a, b) => !same(pickSettings(a), pickSettings(b));

  // Keys of synced settings whose values differ between two settings objects
  const settingsKeysChanged = (a, b) => SYNCED_SETTINGS.filter((k) => !same(a?.[k], b?.[k]));
  // Remote settings to take while this device still has unsent edits to `dirty` keys: everything else
  function remoteSettingsPatch(local, remote, dirty = []) {
    const out = {};
    for (const k of SYNCED_SETTINGS) if (remote && k in remote && !dirty.includes(k) && !same(local?.[k], remote[k])) out[k] = remote[k];
    return out;
  }

  // After uploading `body` for `sentKeys`: the keys that still need sending. A key stays dirty if it wasn't in this
  // upload, or if it was edited again while the upload was in flight (its value now differs from what was sent).
  function stillDirty(dirty, sentKeys, body, now) {
    return (dirty || []).filter((k) => !sentKeys.includes(k) || (now && k in now && !same(body?.[k], now[k])));
  }

  // Things deleted on this device while signed out ("kind:id" list). Re-adding an item takes it off the list.
  function trackOffline(list, { upserts, deletes }) {
    const s = new Set(list || []);
    for (const r of deletes) s.add(key(r.kind, r.id));
    for (const r of upserts) s.delete(key(r.kind, r.id));
    return [...s];
  }

  // Is there anything in the cloud worth calling "your timetable"? The empty semester every device writes isn't.
  const hasContent = (rows) => (rows || []).some((r) => !r.deleted && (r.kind === 'semester' ? !!r.data?.start : !!LISTS[r.kind]));
  // ...and on this device
  const plannerHasContent = (p) => !!p && (!!p.semester?.start || ['classes', 'changes', 'tasks'].some((l) => (p[l] || []).length));

  // First sign-in on a device that already has data: combine both sides, nothing is lost.
  // Cloud items win where both have the same id; the semester is kept from whichever side has dates.
  // `removed` ("kind:id") were deleted or edited here and not uploaded yet: the cloud's copy of those is ignored.
  function mergeFirst(local, cloudRows, removed = []) {
    const gone = new Set(removed);
    const { planner } = apply(local, cloudRows.filter((r) => !r.deleted && !gone.has(key(r.kind, r.id))));
    const cloudSem = cloudRows.find((r) => r.kind === 'semester' && !r.deleted)?.data;
    if (cloudSem && !cloudSem.start && local.semester?.start) planner.semester = local.semester;
    return planner;
  }
  // The outbox after a first sync: what the cloud lacks or has differently, plus tombstones for offline deletes
  function firstOutbox(cloudRows, merged, removed = []) {
    const cloud = apply({ semester: null, classes: [], changes: [], tasks: [] }, cloudRows).planner;
    const live = new Set(cloudRows.filter((r) => !r.deleted).map((r) => key(r.kind, r.id)));
    const deletes = (removed || []).filter((k) => live.has(k)).map((k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; });
    return queue([], { upserts: diff(cloud, merged).upserts, deletes });
  }

  return {
    SYNCED_SETTINGS, explode, diff, apply, queue, pendingKeys, pickSettings, settingsDiffer, settingsKeysChanged, remoteSettingsPatch, stillDirty,
    trackOffline, hasContent, plannerHasContent, mergeFirst, firstOutbox, key,
  };
}));
