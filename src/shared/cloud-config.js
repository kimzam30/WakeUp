'use strict';
// Where WakeUp syncs. The publishable key only allows what Row Level Security permits (each user's own rows),
// so it is safe to ship inside the app.
(function (root, cfg) {
  if (typeof module === 'object' && module.exports) module.exports = cfg; else root.CloudConfig = cfg;
}(typeof self !== 'undefined' ? self : this, {
  url: 'https://iznnnsiojfcbncrdqzyh.supabase.co',
  key: 'sb_publishable_teb6hKc0AaIeyqviEVG8NA_wdItnv4U',
}));
