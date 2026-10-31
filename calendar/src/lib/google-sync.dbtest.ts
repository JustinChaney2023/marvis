/* eslint-disable @typescript-eslint/no-explicit-any -- a loose fake of the Calendar API */
// DB-backed check of Google sync against a fake Calendar API (no network).
// Needs a migrated database: `npm run test:db` (CI runs it in the e2e job).
import assert from "node:assert/strict";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { exportToGoogle, importFromGoogle, syncGoogleCalendar } from "@/lib/google-sync";

process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y";
const store = new Map<string, any>(); let n = 0; const calls: string[] = [];
const err = (code: number) => Object.assign(new Error(String(code)), { code });
const fake = { events: {
  list: async (p: any) => {
    const all = [...store.values()]; const start = p.pageToken ? Number(p.pageToken) : 0;
    const page = all.slice(start, start + p.maxResults);
    return { data: { items: page, nextPageToken: start + p.maxResults < all.length ? String(start + p.maxResults) : undefined } };
  },
  insert: async ({ requestBody }: any) => { calls.push("insert"); const id = "g" + (++n); const ev = { ...requestBody, id, status: "confirmed", updated: new Date().toISOString() }; store.set(id, ev); return { data: ev }; },
  patch: async ({ eventId, requestBody }: any) => { calls.push("patch"); if (!store.has(eventId)) throw err(404); const ev = { ...store.get(eventId), ...requestBody, updated: new Date().toISOString() }; store.set(eventId, ev); return { data: ev }; },
  update: async () => { calls.push("UPDATE(should not be used)"); return { data: {} }; },
  delete: async ({ eventId }: any) => { calls.push("delete"); if (!store.has(eventId)) throw err(410); store.delete(eventId); return {}; },
}};
(google as any).calendar = () => fake;
const ok = (label: string, cond: boolean) => assert.ok(cond, label);

async function main() {
  let calId = "";
  const user = await prisma.user.create({ data: { email: `audit-${Date.now()}@x.test`, passwordHash: "x", timezone: "America/Los_Angeles" } });
  try {
    const acct = await prisma.googleAccount.create({ data: { userId: user.id, email: "a@x", label: "a", isDefault: true, accessToken: "t", refreshToken: "r", expiresAt: new Date(Date.now() + 864e5) } });
    const cal = await prisma.googleCalendar.create({ data: { googleAccountId: acct.id, calendarId: "primary", summary: "primary", isDefault: true } });
    calId = cal.id;
    const t0 = new Date(Date.now() + 864e5);
    const hr = (d: Date, h = 1) => new Date(d.getTime() + h * 36e5);

    // 1. edit after export (modal path no longer clears googleCalendarId) -> no duplicate
    const e1 = await prisma.event.create({ data: { userId: user.id, title: "E1", start: t0, end: hr(t0), localDirty: true } });
    await syncGoogleCalendar(user.id);
    await prisma.event.update({ where: { id: e1.id }, data: { title: "E1 edited", localDirty: true } });
    await syncGoogleCalendar(user.id);
    const e1rows = await prisma.event.count({ where: { userId: user.id, title: { startsWith: "E1" } } });
    ok("edit after export doesn't duplicate (rows=" + e1rows + ")", e1rows === 1);
    ok("edits use patch, never update", calls.includes("patch") && !calls.some((c) => c.startsWith("UPDATE")));
    // Google-only fields survive a patch
    const gid = (await prisma.event.findUniqueOrThrow({ where: { id: e1.id } })).googleEventId!;
    store.set(gid, { ...store.get(gid), attendees: [{ email: "x@y" }] });
    await prisma.event.update({ where: { id: e1.id }, data: { title: "E1 again", localDirty: true } });
    await exportToGoogle(cal.id);
    ok("attendees survive an edit", store.get(gid).attendees?.length === 1);

    // 2. subscribed events aren't exported
    await prisma.event.create({ data: { userId: user.id, title: "SUB", start: t0, end: hr(t0), source: "SUBSCRIBED", locked: true } });
    await exportToGoogle(cal.id);
    ok("subscribed feed not pushed", ![...store.values()].some((e) => e.summary === "SUB"));

    // 3. task block deleted locally -> deleted on Google, not re-imported
    const blk = await prisma.event.create({ data: { userId: user.id, title: "TaskBlock", start: t0, end: hr(t0), localDirty: true } });
    await exportToGoogle(cal.id);
    await prisma.event.deleteMany({ where: { id: blk.id } });
    await syncGoogleCalendar(user.id);
    ok("deleted block gone on Google", ![...store.values()].some((e) => e.summary === "TaskBlock"));
    ok("deleted block not re-imported", (await prisma.event.count({ where: { userId: user.id, title: "TaskBlock" } })) === 0);
    ok("no pending deletions left", (await prisma.googleDeletion.count({ where: { googleCalendarId: cal.id } })) === 0);

    // 4. recurring: local exclusion and split reach Google
    const rec = await prisma.event.create({ data: { userId: user.id, title: "Class", start: t0, end: hr(t0), recurrenceRule: "FREQ=WEEKLY", localDirty: true } });
    await exportToGoogle(cal.id);
    const skip = new Date(t0.getTime() + 7 * 864e5).toISOString();
    await prisma.event.update({ where: { id: rec.id }, data: { excludeDates: skip, recurrenceEndsBefore: new Date(t0.getTime() + 21 * 864e5), localDirty: true } });
    await exportToGoogle(cal.id);
    const recG = [...store.values()].find((e) => e.summary === "Class");
    ok("EXDATE + UNTIL sent: " + JSON.stringify(recG.recurrence), recG.recurrence.some((l: string) => l.startsWith("EXDATE")) && /UNTIL=/.test(recG.recurrence[0]));

    // 5. import: EXDATE + cancelled instance become exclusions; pagination
    store.set("gr", { id: "gr", status: "confirmed", summary: "GoogleSeries", start: { dateTime: "2026-11-02T17:00:00Z" }, end: { dateTime: "2026-11-02T18:00:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY", "EXDATE:20261109T170000Z"], updated: new Date().toISOString() });
    store.set("gr_i", { id: "gr_i", status: "cancelled", recurringEventId: "gr", originalStartTime: { dateTime: "2026-11-16T17:00:00Z" } });
    for (let i = 0; i < 300; i++) store.set("bulk" + i, { id: "bulk" + i, status: "confirmed", summary: "Bulk " + i, start: { dateTime: hr(t0, i).toISOString() }, end: { dateTime: hr(t0, i + 1).toISOString() }, updated: new Date().toISOString() });
    await importFromGoogle(cal.id);
    const gs = await prisma.event.findFirstOrThrow({ where: { userId: user.id, title: "GoogleSeries" } });
    ok("Google EXDATE + cancelled instance excluded: " + gs.excludeDates, (gs.excludeDates ?? "").includes("2026-11-09T17:00:00.000Z") && (gs.excludeDates ?? "").includes("2026-11-16T17:00:00.000Z"));
    ok("pagination imported all 300", (await prisma.event.count({ where: { userId: user.id, title: { startsWith: "Bulk " } } })) === 300);

    // 6. overlapping syncs share one run
    const [a, b] = [syncGoogleCalendar(user.id), syncGoogleCalendar(user.id)];
    ok("concurrent syncs are deduped", a === b);
    await a;
  } finally {
    await prisma.event.deleteMany({ where: { userId: user.id } });
    await prisma.googleDeletion.deleteMany({ where: { googleCalendarId: calId } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log("google-sync.dbtest.ts: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
