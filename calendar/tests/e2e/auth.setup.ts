import { test as setup, expect } from "@playwright/test";

// Every app page needs a session now. Signs in once (creating the account
// on first run via the normal signup form) and saves the cookie for the
// rest of the suite. Override with E2E_EMAIL / E2E_PASSWORD.
const EMAIL = process.env.E2E_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-123";
export const STORAGE_STATE = "tests/e2e/.auth/user.json";

setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/login")) {
    await page.goto("/signup");
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").first().fill(PASSWORD);
    const confirm = page.getByPlaceholder(/confirm/i);
    if (await confirm.count()) await confirm.fill(PASSWORD);
    const invite = page.getByPlaceholder(/invite/i);
    if (await invite.count()) await invite.fill(process.env.SIGNUP_INVITE_CODE ?? "");
    await page.getByRole("button", { name: /sign up|create/i }).click();
    await page.waitForLoadState("networkidle");
  }
  await expect(page).not.toHaveURL(/\/(login|signup)/);
  await page.context().storageState({ path: STORAGE_STATE });
});
