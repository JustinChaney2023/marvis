import { test, expect } from "@playwright/test";

test("workload page shows the week and the estimates section", async ({ page }) => {
  await page.goto("/workload");
  await expect(page.getByRole("heading", { name: "Workload" })).toBeVisible();
  await expect(page.getByText("Next 7 days")).toBeVisible();
  await expect(page.getByText("Estimates vs. actual")).toBeVisible();
});
