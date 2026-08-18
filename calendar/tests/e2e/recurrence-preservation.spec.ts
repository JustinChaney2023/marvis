import { test, expect } from "@playwright/test";

const PREFIX = "[e2e]";
const COMPLEX_RULE = "FREQ=WEEKLY;WKST=SU;UNTIL=20261213T085959Z;BYDAY=MO,WE";

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("editing an unrelated field on a complex-rule event preserves the rule", async ({
  page,
  request,
}) => {
  // Seed an event with a rule this app's UI can't fully represent — the
  // exact shape a Google-synced class schedule comes in as.
  const created = await request.post("/api/test/seed-event", {
    data: {
      title: `${PREFIX} CSCE A490`,
      start: "2026-08-24T09:00:00",
      end: "2026-08-24T10:15:00",
      recurrenceRule: COMPLEX_RULE,
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/?view=week&start=2026-08-24");
  await page.getByText("CSCE A490").first().click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  // The warning should be visible — the rule isn't a recognized preset or
  // custom-weekly shape.
  await expect(modal.getByText(/can't fully show/)).toBeVisible();

  // Retitle only — don't touch Repeat at all.
  const titleInput = modal.getByLabel("Title");
  await titleInput.fill(`${PREFIX} CSCE A490 (renamed)`);
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();

  const check = await request.get(`/api/test/get-event-rule?title=${encodeURIComponent(`${PREFIX} CSCE A490 (renamed)`)}`);
  const body = await check.json();
  expect(body.recurrenceRule).toBe(COMPLEX_RULE);
});
