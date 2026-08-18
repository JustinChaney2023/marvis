import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export function getRedirectUri(): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/api/google/callback`;
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

/**
 * Returns an OAuth2 client with valid (refreshed if needed) credentials
 * for the single connected GoogleAccount, or null if none is connected.
 */
export async function getAuthorizedClient() {
  const account = await prisma.googleAccount.findFirst();
  if (!account) return null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.expiresAt.getTime(),
  });

  if (account.expiresAt.getTime() <= Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        accessToken: credentials.access_token ?? account.accessToken,
        expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
      },
    });
    client.setCredentials(credentials);
  }

  return { client, account };
}
