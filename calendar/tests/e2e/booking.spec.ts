import { test, expect } from "@playwright/test";

const PREFIX = "[e2e]";
const SLUG = "e2e-booking-test";

test.beforeAll(async ({ request }) => {
  await request.post("/api/test/booking-settings", {
    data: {
      bookingEnabled: true,
      bookingSlug: SLUG,
      bookingTitle: `${PREFIX} Book time with me`,
      bookingDurationMin: 30,
    },
  });
});

test.afterAll(async ({ request }) => {
  await request.post("/api/test/booking-settings", {
    data: { bookingEnabled: false, bookingSlug: null },
  });
});

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("visitor can book an open slot", async ({ page }) => {
  await page.goto(`/book/${SLUG}`);
  await expect(page.getByRole("heading", { name: `${PREFIX} Book time with me` })).toBeVisible();

  const firstSlotButton = page.locator("main button").first();
  await expect(firstSlotButton).toBeVisible();
  await firstSlotButton.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByLabel("Your name").fill(`${PREFIX} Playwright Visitor`);
  await modal.getByLabel(/Email/).fill("visitor@example.com");
  await modal.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText("You're booked!")).toBeVisible();
});

test("404s for an unknown or disabled slug", async ({ page }) => {
  const response = await page.goto("/book/definitely-not-a-real-slug");
  expect(response?.status()).toBe(404);
});
