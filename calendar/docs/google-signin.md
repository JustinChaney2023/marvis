# Sign in with Google

"Continue with Google" appears on the Sign in and Sign up pages once
`GOOGLE_SIGNIN_ENABLED=1` is set (plus the `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` the Calendar connection already uses). It asks for
identity only: `openid email profile`. Set the flag only after the redirect URI
below is registered, or the button will error.

## One-time Google Cloud setup
In the OAuth client, add this **Authorized redirect URI** next to the existing
`/api/google/callback` one:

- `https://useseason.app/api/auth/google/callback`
- (local dev) `http://localhost:3000/api/auth/google/callback`

While the consent screen is in **Testing**, only listed test users can sign in;
**Publish app** lifts that (these scopes need no Google verification).

## How accounts are matched
1. By Google account id (`User.googleSub`) — the normal repeat sign-in.
2. By email, **only** if that Season account already has a connected Google
   Calendar for the same address (proof they own it). Signup is open and doesn't
   verify email, so matching on a bare email would let someone pre-register a
   victim's address and keep access after the victim signs in with Google.
   Anyone else with an existing password account signs in with the password,
   then connects Google in Settings.
3. Otherwise a new account is created (Google must report the email verified).
   While `SIGNUP_INVITE_CODE` is set, Google can't create accounts and the
   button is hidden on Sign up.

Accounts made this way have an unguessable password; "Forgot password" sets a
real one if wanted.
