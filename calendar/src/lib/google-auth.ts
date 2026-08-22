import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/tokenCrypto";

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

/** Every Google account a user has connected (personal, work, etc.), default first. */
export async function listGoogleAccounts(userId: string) {
  return prisma.googleAccount.findMany({
    where: { userId },
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
