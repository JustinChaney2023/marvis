"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  destroySession,
  getCurrentSessionId,
  hashPassword,
  requireUser,
  revokeOtherSessions,
  verifyPassword,
} from "@/lib/auth";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";

const MIN_PASSWORD_LEN = 8;

// Same pattern as the booking page's per-IP limiter — see rateLimit.ts.
const isLoginRateLimited = createRateLimiter(8, 15 * 60 * 1000);
// Looser than login (an account is a bigger ask than a login attempt,
// and a real signup flow includes several legitimate retries — typos,
// picking a longer password), but still bounded: stops a script from
// mass-creating accounts.
const isSignupRateLimited = createRateLimiter(5, 60 * 60 * 1000);

export async function signupAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;

  if (isSignupRateLimited(await requestIp())) {
    redirect(
      `/signup?error=${encodeURIComponent("Too many attempts — please try again later.")}`,
    );
  }

  if (!email || password.length < MIN_PASSWORD_LEN) {
    redirect(
      `/signup?error=${encodeURIComponent(
        !email ? "Email is required." : `Password must be at least ${MIN_PASSWORD_LEN} characters.`,
      )}`,
    );
  }

  // Open signup is fine while this instance isn't shared beyond people
  // you've personally invited — set SIGNUP_INVITE_CODE before handing
  // the URL out more broadly. Unset = no gate at all (today's behavior).
  const requiredInviteCode = process.env.SIGNUP_INVITE_CODE;
  if (requiredInviteCode) {
    const inviteCode = String(formData.get("inviteCode") ?? "").trim();
    if (inviteCode !== requiredInviteCode) {
      redirect(`/signup?error=${encodeURIComponent("Invalid invite code.")}`);
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect(`/signup?error=${encodeURIComponent("An account with that email already exists.")}`);
  }

  // The very first account on this instance is the admin (sees the
  // feedback inbox) and adopts any data created before accounts existed
  // — see the userId-nullable comment on User in schema.prisma.
  const isFirstUser = (await prisma.user.count()) === 0;

  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), name, isAdmin: isFirstUser },
  });

  if (isFirstUser) {
    await prisma.$transaction([
      prisma.event.updateMany({ where: { userId: null }, data: { userId: user.id } }),
      prisma.task.updateMany({ where: { userId: null }, data: { userId: user.id } }),
      prisma.project.updateMany({ where: { userId: null }, data: { userId: user.id } }),
      prisma.googleAccount.updateMany({ where: { userId: null }, data: { userId: user.id } }),
      prisma.appSettings.updateMany({ where: { userId: null }, data: { userId: user.id } }),
    ]);
  }

  await createSession(user.id);
  redirect("/");
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (isLoginRateLimited(await requestIp())) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(
        "Too many attempts — please try again in a few minutes.",
      )}`,
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=1`);
  }

  await createSession(user.id);
  redirect(next || "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    redirect("/settings?password_error=" + encodeURIComponent("Current password is incorrect."));
  }
  if (newPassword.length < MIN_PASSWORD_LEN) {
    redirect(
      "/settings?password_error=" +
        encodeURIComponent(`New password must be at least ${MIN_PASSWORD_LEN} characters.`),
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  // If a session token ever leaked (stolen cookie, shared device), a
  // password change should actually lock that session out too — not just
  // block future logins with the old password while a live session keeps
  // working forever. Revoke everywhere, then re-issue one for this
  // device so the user isn't logged out by changing their own password.
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await createSession(user.id);
  redirect("/settings?password_changed=1");
}

export async function revokeOtherSessionsAction() {
  const user = await requireUser();
  const currentSessionId = await getCurrentSessionId();
  await revokeOtherSessions(user.id, currentSessionId);
  revalidatePath("/settings");
}

export async function revokeSessionAction(sessionId: string) {
  const user = await requireUser();
  // Scoped by userId so this can't be used to revoke someone else's
  // session by guessing/enumerating ids.
  await prisma.session.deleteMany({ where: { id: sessionId, userId: user.id } });
  revalidatePath("/settings");
}
