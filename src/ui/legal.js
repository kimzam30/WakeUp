'use strict';
// The privacy policy and legal notes, shared by the desktop app, the Android app and PRIVACY.md (written from
// this file by `node scripts/legal.js`; a test fails if they differ). Plain text only: each app draws it.
// A section is { h, p: [paragraph], list: [[label, text]] }; label may be ''.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Legal = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const OWNER = 'nhako';
  const REPO = 'https://github.com/kimzam30/WakeUp';
  const UPDATED = '19 November 2026';
  const CONTACT = `${REPO}/issues`;
  const NOTICES = `${REPO}/blob/main/THIRD_PARTY_NOTICES.md`;
  const LICENSE = `${REPO}/blob/main/LICENSE`;
  const COPYRIGHT = `© 2026 ${OWNER}. All rights reserved.`;
  const DISCLAIMER = 'WakeUp is an independent project. It is not affiliated with, endorsed by or sponsored by Multimedia University (MMU), Microsoft, Google, Anthropic, OpenAI or any other organisation whose website or service it opens. Product names, logos and trademarks belong to their owners and are used only to identify those services.';

  const PRIVACY = [
    { h: '', p: [`WakeUp is a personal class app made by ${OWNER}. It has no ads, no analytics and no tracking. This page says what leaves your device and why.`] },
    { h: 'Without signing in', p: ['Everything stays on your device: your timetable, tasks, settings, open apps and layout. Nothing is sent to WakeUp’s servers.'] },
    {
      h: 'When you sign in to sync',
      p: ['You sign in with Google through Supabase, which hosts WakeUp’s database. Supabase receives your Google account’s email address, name and profile picture link, as Google shares them with any sign-in.',
        'To keep your devices in step, WakeUp stores this in that database:'],
      list: [
        ['Timetable and tasks', 'your classes, class changes (replacements, cancellations), tasks and semester dates, with any notes you wrote on them.'],
        ['Settings', 'theme, accent colour, week start, nickname, reminder choices, the class label, the Today layout and the apps you added (their name, address, colour and logo).'],
        ['A random device id', 'so a device can tell its own changes from another’s. It is not your device’s name or any hardware id.'],
      ],
    },
    { h: '', p: ['Only you can read or change these rows: the database refuses every other account. WakeUp never stores your passwords for MMU, Microsoft or any other site.'] },
    {
      h: 'What else WakeUp contacts',
      list: [
        ['GitHub', 'to check for and download updates. GitHub sees your IP address, as with any download.'],
        ['The sites of apps you add', 'once, to fetch their own logo.'],
        ['Google', 'to show your profile picture.'],
        ['The apps you open', 'Ebwise, Outlook, Teams, AI assistants and the rest are those websites themselves, under their own privacy policies. Their sign-ins stay on your device.'],
      ],
    },
    {
      h: 'Your choices',
      list: [
        ['Sign out', 'stops syncing on that device.'],
        ['Sign out everywhere', 'ends the sign-in on every device at once.'],
        ['Delete my cloud data', 'removes your timetable, tasks and settings from the database and signs out every device. Each device keeps its own copy.'],
        ['Delete your account', `to also remove the sign-in account itself, ask ${OWNER} on GitHub.`],
      ],
    },
    { h: 'Changes', p: ['If this policy changes, the new version ships with the app and shows here.'] },
  ];

  // PRIVACY.md
  function markdown() {
    const out = ['# WakeUp privacy policy', '', `Last updated: ${UPDATED}`, ''];
    for (const s of PRIVACY) {
      if (s.h) out.push(`## ${s.h}`, '');
      for (const p of s.p || []) out.push(p, '');
      if (s.list) out.push(...s.list.map(([l, t]) => (l ? `- **${l}:** ${t}` : `- ${t}`)), '');
    }
    out.push('## Contact', '', `Questions or requests: ${CONTACT}`, '', '## Legal', '', COPYRIGHT, '', DISCLAIMER, '',
      'Licence: LICENSE. Open-source components: THIRD_PARTY_NOTICES.md.', '');
    return out.join('\n');
  }

  return { OWNER, REPO, UPDATED, CONTACT, NOTICES, LICENSE, COPYRIGHT, DISCLAIMER, PRIVACY, markdown };
}));
