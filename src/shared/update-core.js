'use strict';
// Update checks shared by the desktop app (main process) and the Android app. No dependencies.
//
// A release is published on GitHub when the version in package.json changes on `main` (see
// .github/workflows/release.yml). Each release carries the desktop build (a tarball of the unpacked app and an
// AppImage), the Android APK, and SHA256SUMS listing a checksum for every file. An app only installs a file whose
// checksum matches, and only from this repository's own release downloads.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.UpdateCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const REPO = 'kimzam30/WakeUp';
  const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
  const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

  // '2.10.1' → [2, 10, 1]; a leading 'v' and anything after '-' or '+' are ignored
  const parts = (v) => String(v || '').replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  function compare(a, b) {
    const x = parts(a); const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length, 3); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }
  const isNewer = (latest, current) => compare(latest, current) > 0;

  // Android versionCode from a version: 2.5.0 → 20500 (always grows with the version)
  const versionCode = (v) => { const [a, b, c] = parts(v); return a * 10000 + b * 100 + c; };

  // "hash  name" lines (sha256sum's format) → { name: hash }
  function parseSums(text) {
    const out = {};
    for (const line of String(text || '').split('\n')) {
      const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (m) out[m[2].trim()] = m[1].toLowerCase();
    }
    return out;
  }

  // The files of a GitHub release this app cares about. `kind`: 'tarball' (installed desktop app), 'appimage', 'apk'.
  const PATTERNS = { tarball: /^WakeUp-.+-linux-x64\.tar\.gz$/, appimage: /^WakeUp-.+\.AppImage$/, apk: /^WakeUp-.+\.apk$/ };
  const fromRepo = (url) => typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX);
  function pick(release, kind) {
    if (!release || release.draft || release.prerelease) return null;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const file = assets.find((a) => PATTERNS[kind]?.test(a?.name) && fromRepo(a.browser_download_url));
    const sums = assets.find((a) => a?.name === 'SHA256SUMS' && fromRepo(a.browser_download_url));
    if (!file || !sums) return null;
    return {
      version: String(release.tag_name || '').replace(/^v/i, ''),
      name: file.name, url: file.browser_download_url, size: Number(file.size) || 0, sumsUrl: sums.browser_download_url,
      notes: cleanNotes(release.body), page: typeof release.html_url === 'string' ? release.html_url : `https://github.com/${REPO}/releases`,
    };
  }
  // Release notes as a few plain lines: GitHub's markdown headings, links and the changelog footer dropped
  function cleanNotes(body) {
    return String(body || '').split('\n')
      .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
      .filter((l) => l && !/^full changelog/i.test(l) && !/^what's changed$/i.test(l))
      .slice(0, 12).join('\n');
  }

  return { REPO, LATEST, DOWNLOAD_PREFIX, compare, isNewer, versionCode, parseSums, pick, fromRepo };
}));
