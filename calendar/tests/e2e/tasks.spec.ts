import { test, expect } from "@playwright/test";

const PREFIX = "[e2e]";

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("inline add parses shorthand into a task", async ({ page }) => {
  await page.goto("/tasks", { waitUntil: "networkidle" });
  const input = page.getByLabel("Add a task");
  await input.fill(`${PREFIX} read chapter 4 tomorrow 3pm 1h !!`);
  // Live preview of what the shorthand means, before submitting.
  await expect(page.getByText("Tomorrow, 3:00 PM")).toBeVisible();
  await expect(page.getByText("1h", { exact: true })).toBeVisible();
  await input.press("Enter");

  const row = page.locator("li", { hasText: `${PREFIX} read chapter 4` }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("High")).toBeVisible();
  await expect(row.getByText("60m est.")).toBeVisible();
  await expect(row).toContainText("3:00 PM");
});

test("quick capture files a #project task and stays open for the next one", async ({ page }) => {
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await page.getByText("+ Project").click();
  await page.getByPlaceholder("Project name").fill(`${PREFIX} Biology`);
  await page.locator('form:has(input[placeholder="Project name"])').getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("link", { name: `${PREFIX} Biology` })).toBeVisible();

  await page.locator("body").press("c");
  const box = page.getByRole("dialog", { name: "Quick add" });
  await expect(box).toBeVisible();
  const input = box.getByRole("textbox");
  // A #tag matches a project loosely (exact, then prefix, then substring).
  await input.fill(`${PREFIX} lab writeup #biology`);
  await input.press("Enter");
  await expect(box.getByText(`${PREFIX} lab writeup · in ${PREFIX} Biology`)).toBeVisible();
  await expect(input).toHaveValue("");

  await page.keyboard.press("Escape");
  const row = page.locator("li", { hasText: `${PREFIX} lab writeup` }).first();
  await expect(row.getByText(`${PREFIX} Biology`)).toBeVisible();
});

test("completing a task offers undo", async ({ page }) => {
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await page.getByLabel("Add a task").fill(`${PREFIX} undo me`);
  await page.getByLabel("Add a task").press("Enter");
  const list = page.locator("main ul").first();
  const row = list.locator("li", { hasText: `${PREFIX} undo me` });
  await expect(row).toBeVisible();

  await row.getByLabel("mark done").click();
  await expect(page.getByRole("status")).toContainText(`Completed “${PREFIX} undo me”`);
  await expect(row).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
});

test("new-task form fills fields from title shorthand", async ({ page }) => {
  await page.goto("/tasks?new=1", { waitUntil: "networkidle" });
  const title = page.locator('input[name="title"]');
  await title.fill(`${PREFIX} essay draft fri 2h !!!`);
  await title.blur();
  await expect(title).toHaveValue(`${PREFIX} essay draft`);
  await expect(page.getByRole("radio", { name: "Urgent" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('input[name="durationMin"]')).toHaveValue("120");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.locator("li", { hasText: `${PREFIX} essay draft` }).first()).toBeVisible();
});
