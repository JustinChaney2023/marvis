// DB-backed check of the Google sign-in account rules (no network).
// Needs a migrated database: `npm run test:db`.
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { resolveGoogleSignIn } from "@/lib/googleSignIn";

const run = Date.now();
const mail = (n: string) => `${n}-${run}@gsi.test`;
const profile = (n: string, over = {}) => ({ sub: `sub-${n}-${run}`, email: mail(n), emailVerified: true, name: "G User", ...over });

async function main() {
  const made: string[] = [];
  try {
    // 1. brand-new email -> account created, signs in; second time -> same account
    const a = await resolveGoogleSignIn(profile("new"));
    assert.ok(a.ok && a.created, "creates a new account");
    if (a.ok) made.push(a.userId);
    const a2 = await resolveGoogleSignIn(profile("new"));
    assert.ok(a2.ok && !a2.created && a.ok && a2.userId === a.userId, "same Google id signs in to the same account");

    // 2. unverified email is refused (and creates nothing)
    const u = await resolveGoogleSignIn(profile("unverified", { emailVerified: false }));
    assert.ok(!u.ok, "unverified email refused");
    assert.equal(await prisma.user.count({ where: { email: mail("unverified") } }), 0);

    // 3. existing password account, no proof of owning that Google account -> refused, not taken over
    const pw = await prisma.user.create({ data: { email: mail("pw"), passwordHash: "x" } });
    made.push(pw.id);
    const r = await resolveGoogleSignIn(profile("pw"));
    assert.ok(!r.ok, "bare email match must not link an existing password account");
    assert.equal((await prisma.user.findUnique({ where: { id: pw.id } }))?.googleSub, null);

    // 4. existing account that already connected that Google address -> linked and signed in
    const linked = await prisma.user.create({ data: { email: mail("linked"), passwordHash: "x" } });
    made.push(linked.id);
    await prisma.googleAccount.create({
      data: { userId: linked.id, email: mail("linked").toUpperCase(), label: "l", accessToken: "t", refreshToken: "r", expiresAt: new Date(Date.now() + 864e5) },
    });
    const l = await resolveGoogleSignIn(profile("linked"));
    assert.ok(l.ok && l.userId === linked.id && !l.created, "connected-calendar account links");
    assert.equal((await prisma.user.findUnique({ where: { id: linked.id } }))?.googleSub, profile("linked").sub);

    // 5. a different Google account claiming an already-linked email is refused
    const other = await resolveGoogleSignIn({ ...profile("linked"), sub: "someone-else" });
    assert.ok(!other.ok, "email already linked to another Google account");

    // 6. invite gate on -> no new accounts via Google
    process.env.SIGNUP_INVITE_CODE = "secret";
    const g = await resolveGoogleSignIn(profile("gated"));
    delete process.env.SIGNUP_INVITE_CODE;
    assert.ok(!g.ok, "invite gate blocks Google signup");
    assert.equal(await prisma.user.count({ where: { email: mail("gated") } }), 0);

    console.log("googleSignIn.dbtest.ts: all checks passed");
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
