import { test, expect } from "@playwright/test";

test("signed-out visitors get the marketing page at /", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/to-do list, on your calendar/);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy policy" })).toBeVisible();
  await context.close();
});

test("signed-in visitors at / go to their calendar", async ({ page }) => {
  await page.goto("/?view=week");
  await expect(page).toHaveURL(/\/home\?view=week/);
});

test("the calendar needs a sign-in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
