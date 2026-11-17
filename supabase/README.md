# Supabase (cloud sync)

WakeUp syncs through the **NhakoEcoDB** project (`iznnnsiojfcbncrdqzyh`, Tokyo `ap-northeast-1`), sharing it with NhakoEco.
Its tables are prefixed `wakeup_` in `public`, so no extra exposed schema is needed. Row Level Security keeps every
row to its owner; WakeUp shares the project's Auth users, so one Google account works for both apps.

- `migrations/` – applied with the Supabase MCP `apply_migration` (already applied: `wakeup_sync`).
- The client uses the project's **publishable** key, which is safe to ship in the app.

Manual setup still needed (dashboard → Authentication → Sign In / Providers → Google, and URL Configuration):
1. Google provider on, with the Web client ID + secret from Google Cloud Console.
2. "Authorized client IDs": add the Android client ID too (native sign-in on Android).
3. Redirect URLs: `wakeup://auth-callback` and `http://127.0.0.1/**`.
