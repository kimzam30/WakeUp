// Links that open the app from outside. The Google sign-in reply (wakeup://auth-callback?code=…) is read by the
// sign-in code itself (sync.ts); the browser also hands it to the app as an ordinary link, which must not turn
// into a page ("Unmatched route"). Ignore it, or start on Today if it's what launched the app.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (path.includes('auth-callback')) return initial ? '/' : null;
  return path;
}
