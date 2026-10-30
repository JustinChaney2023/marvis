import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/tokenCrypto";

function getAppBaseUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export function getRedirectUri(): string {
  return `${getAppBaseUrl()}/api/google/callback`;
}

// Behind a reverse proxy, request.nextUrl.origin reflects the app's local
// bind address, not the public host Google actually redirects back to —
// building the post-OAuth redirect from it sends the browser to
// http://localhost:3000 instead of the real APP_URL, which just hangs.
export function getAppOrigin(): string {
  return new URL(getAppBaseUrl()).origin;
}

export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — see docs/google-calendar-setup.md",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

/** Every Google account a user has connected (personal, work, etc.), default first. */
export async function listGoogleAccounts(userId: string) {
  return prisma.googleAccount.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Every Google calendar this user actually syncs, across every connected
 * account — one account can have several (see google-sync.ts, which
 * loops these independently rather than one-per-account).
 */
export async function listGoogleCalendarSubscriptions(userId: string) {
  return prisma.googleCalendar.findMany({
    where: { googleAccount: { userId } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Returns an OAuth2 client with valid (refreshed if needed) credentials
 * for one specific connected GoogleAccount, or null if it doesn't exist.
 */
export async function getAuthorizedClient(googleAccountId: string) {
  const account = await prisma.googleAccount.findUnique({ where: { id: googleAccountId } });
  if (!account) return null;

  const client = createOAuthClient();
  const accessToken = decryptSecret(account.accessToken);
  const refreshToken = decryptSecret(account.refreshToken);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.expiresAt.getTime(),
  });

  if (account.expiresAt.getTime() <= Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encryptSecret(credentials.access_token ?? accessToken),
        expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
      },
    });
    client.setCredentials(credentials);
  }

  return { client, account };
}

/**
 * Returns an OAuth2 client with valid credentials for one subscribed
 * GoogleCalendar row, plus that row and its parent account — the shape
 * google-sync.ts needs to both call the Calendar API (calendar.calendarId)
 * and authorize (the parent account's tokens).
 */
export async function getAuthorizedClientForCalendar(googleCalendarId: string) {
  const calendarRow = await prisma.googleCalendar.findUnique({
    where: { id: googleCalendarId },
    include: { googleAccount: true },
  });
  if (!calendarRow) return null;
  const auth = await getAuthorizedClient(calendarRow.googleAccountId);
  if (!auth) return null;
  return { client: auth.client, account: auth.account, calendar: calendarRow };
}

/**
 * The calendars visible inside one connected Google account (e.g. its
 * primary calendar plus a separate "Family" calendar) — lets someone
 * subscribe a non-primary calendar in addition to whatever's already
 * synced. Read-only listing call, no scope beyond the already-granted
 * full `calendar` scope.
 */
export async function listGoogleCalendars(googleAccountId: string) {
  const auth = await getAuthorizedClient(googleAccountId);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth: auth.client });
  const res = await calendar.calendarList.list();
  return (res.data.items ?? []).map((c) => ({
    id: c.id ?? "",
    summary: c.summary ?? c.id ?? "",
    primary: c.primary ?? false,
  }));
}
