import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "marvis_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

// node:crypto's scrypt, not bcrypt — no dependency to add (stdlib covers
// this) and scrypt is a fine, still-recommended KDF for password storage.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  return hashBuffer.length === candidate.length && timingSafeEqual(hashBuffer, candidate);
}

/**
 * DB-backed session, not a signed/stateless cookie — logout and (future)
 * password-change flows need to actually revoke access, which a bare
 * signed JWT can't do without a separate revocation list anyway.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Cached per-request (React's cache()) so every page/action calling this
 * during one render only hits the DB once. This — not proxy.ts — is the
 * real security boundary: proxy.ts only does a cheap cookie-presence
 * check for redirect UX, since Proxy shouldn't do DB lookups (see
 * node_modules/next/dist/docs .../guides/authentication.md).
 */
export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Opportunistic cleanup — otherwise expired rows just accumulate in
    // the Session table forever with nothing else ever deleting them.
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return session.user;
});

/** For server actions/pages that require a signed-in user. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The current session's row id (not the token itself — nothing outside
 * this file should ever handle the raw token) — lets a "your other
 * sessions" list mark which row is "this device" and exclude it from a
 * bulk revoke.
 */
export const getCurrentSessionId = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, select: { id: true } });
  return session?.id ?? null;
});

/** Revokes every session for `userId` except `keepSessionId`. */
export async function revokeOtherSessions(userId: string, keepSessionId: string | null) {
  await prisma.session.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
}
