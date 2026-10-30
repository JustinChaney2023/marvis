# Google Calendar OAuth setup

Do this when we're ready to build Phase 1 (Google Calendar sync). Takes
about 5 minutes.

1. Go to https://console.cloud.google.com/ and create a new project (or
   pick an existing one you're fine using for this).
2. In the left sidebar: **APIs & Services → Library**. Search for
   "Google Calendar API" and click **Enable**.
3. **APIs & Services → OAuth consent screen**. Choose **External** (unless
   you have a Google Workspace account and want Internal). Fill in an app
   name (e.g. "Marvis Calendar") and your email for support/developer
   contact. You can leave scopes/test users minimal — add your own Google
   account as a test user if prompted, since the app won't be published.
4. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID**. Application type: **Web application**. Add an authorized
   redirect URI:
   - `http://localhost:3000/api/google/callback` (for local dev)
   - add your production URL's equivalent later if you deploy this
     somewhere.
5. Save, then copy the **Client ID** and **Client Secret** it shows you.
6. Paste them to me (or straight into `calendar/.env` as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`) and I'll wire up the
   connect flow.

Nothing is billed for this — the Calendar API free tier is far beyond
personal-use volume.

## Production checklist

- **`APP_URL`** must be your public https address (no trailing slash needed).
  The redirect URI Google gets is `${APP_URL}/api/google/callback` — add
  exactly that under *Authorized redirect URIs*.
- **`TOKEN_ENCRYPTION_KEY`** — set any long random string so stored Google
  tokens are encrypted at rest.
- **Testing vs. In production:** while the OAuth consent screen is in
  *Testing*, Google expires refresh tokens after **7 days** and sync stops
  (Season now shows a "Google Calendar sync had a problem" notice). Either
  reconnect weekly, or publish the app (*In production*) — for personal use
  you can publish without verification and click through the "unverified
  app" warning once.

## What syncs

- Two-way for Season's own events and your Google events in the chosen
  calendar (7 days back, 90 days ahead, every ~10 minutes while Season is
  open, or Settings → Sync now).
- Auto-scheduled task blocks are pushed to Google, and removed there when
  they're rescheduled or the task is deleted.
- Recurring series: exclusions ("delete this occurrence") and "this and
  following" splits sync both ways. A single occurrence that was *moved* on
  Google still shows at its original time in Season (known limitation).
- Not synced: subscribed ICS feeds and Apple calendars (they stay
  Season-only), and invites you didn't organize can't be edited on Google.
