import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
};

export type GoogleSignInResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Maps a verified Google identity to a Season user: by Google id, else by
 * email, else a new account.
 *
 * An existing password account is only taken over by email when its owner
 * has already proven they hold that Google account (a connected calendar
 * for the same address). Signup is open and doesn't verify email, so
 * matching on a bare email would let someone pre-register a victim's
 * address with their own password and keep access after the victim signs
 * in with Google.
 */
export async function resolveGoogleSignIn(p: GoogleProfile): Promise<GoogleSignInResult> {
  if (!p.emailVerified) return { ok: false, error: "Google hasn't verified that email address." };
  const email = p.email.trim().toLowerCase();

  const bySub = await prisma.user.findUnique({ where: { googleSub: p.sub } });
  if (bySub) return { ok: true, userId: bySub.id, created: false };

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.googleSub) return { ok: false, error: "That email is linked to a different Google account." };
    const connected = await prisma.googleAccount.findMany({
      where: { userId: byEmail.id },
      select: { email: true },
    });
    if (!connected.some((a) => a.email.toLowerCase() === email)) {
      return {
        ok: false,
        error:
          "An account with that email already exists. Sign in with your password, then connect Google in Settings.",
      };
    }
    await prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: p.sub } });
    return { ok: true, userId: byEmail.id, created: false };
  }

  // The invite gate can't be answered from a Google redirect, so while it's
  // on, new accounts go through the Sign up form instead.
  if (process.env.SIGNUP_INVITE_CODE) {
    return { ok: false, error: "Sign-ups need an invite code — use the Sign up form." };
  }
  try {
    const user = await prisma.user.create({
      data: {
        email,
        // Never matches a password: this account signs in with Google (or
        // via a password reset, which sets a real one).
        passwordHash: hashPassword(randomBytes(32).toString("hex")),
        name: p.name?.trim() || null,
        googleSub: p.sub,
      },
    });
    return { ok: true, userId: user.id, created: true };
  } catch {
    return { ok: false, error: "Couldn't create the account — try again." };
  }
}
