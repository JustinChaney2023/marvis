import { test, expect } from "@playwright/test";

// All test data uses this prefix so cleanup only ever touches rows this
// suite created — real synced Google Calendar events live in the same
// dev DB and must never be touched.
const PREFIX = "[e2e]";

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("create a one-off event via the modal", async ({ page }) => {
  // New events default to today, so open the current week.
  await page.goto("/home?view=week", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ New event" }).click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  await modal.getByLabel("Title").fill(`${PREFIX} Playwright event`);
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();

  await expect(page.locator("button[data-event]", { hasText: `${PREFIX} Playwright event` }).filter({ visible: true }).first()).toBeVisible();
});

test("custom weekly repeat shows day toggles and persists on reopen", async ({
  page,
}) => {
  // New events default to today, so open the current week.
  await page.goto("/home?view=week", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ New event" }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Title").fill(`${PREFIX} Custom repeat`);
  await modal.getByRole("combobox", { name: "Repeat" }).selectOption("CUSTOM");

  await expect(modal.getByRole("button", { name: "Monday" })).toBeVisible();
  await modal.getByRole("button", { name: "Monday" }).click();
  await modal.getByRole("button", { name: "Wednesday" }).click();

  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();

  // The series starts today but only repeats Mon/Wed, so its first
  // occurrence may be next week — look a week ahead.
  const nextWeek = new Date(Date.now() + 7 * 86_400_000);
  const ymd = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, "0")}-${String(nextWeek.getDate()).padStart(2, "0")}`;
  await page.goto(`/home?view=week&start=${ymd}`, { waitUntil: "networkidle" });
  await page.locator("button[data-event]", { hasText: `${PREFIX} Custom repeat` }).filter({ visible: true }).first().click();
  const reopened = page.getByRole("dialog");
  await expect(reopened).toBeVisible();
  await expect(
    reopened.getByRole("combobox", { name: "Repeat" }),
  ).toHaveValue("CUSTOM");
  await expect(reopened.getByRole("button", { name: "Monday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    reopened.getByRole("button", { name: "Wednesday" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    reopened.getByRole("button", { name: "Tuesday" }),
  ).toHaveAttribute("aria-pressed", "false");

  await reopened.getByRole("button", { name: "Cancel" }).click();
});

test("locked toggle persists on reopen", async ({ page }) => {
  // New events default to today, so open the current week.
  await page.goto("/home?view=week", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ New event" }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Title").fill(`${PREFIX} Locked event`);
  // The checkbox is visually sr-only (a styled sibling span is the real
  // toggle) — a real user clicks anywhere in the label, which the browser
  // forwards to the input natively. Playwright's .check() targets the
  // input's own (occluded) box directly and refuses to click through the
  // visible span, so click the label text instead, same as a real click.
  await modal.getByText("Locked", { exact: false }).click();
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();

  await page.locator("button[data-event]", { hasText: `${PREFIX} Locked event` }).filter({ visible: true }).first().click();
  const reopened = page.getByRole("dialog");
  await expect(reopened.getByRole("checkbox", { name: /Locked/ })).toBeChecked();
  await reopened.getByRole("button", { name: "Cancel" }).click();
});
