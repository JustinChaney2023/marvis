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
