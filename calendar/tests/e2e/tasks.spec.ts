import { test, expect } from "@playwright/test";

const PREFIX = "[e2e]";

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("add-task form remembers the last-used project", async ({ page }) => {
  await page.goto("/tasks");

  // Create a project via the "+ Project" quick-add.
  await page.getByText("+ Project").click();
  await page.getByPlaceholder("Project name").fill(`${PREFIX} Sticky Project`);
  await page.locator('form:has(input[placeholder="Project name"])').getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("link", { name: `${PREFIX} Sticky Project` })).toBeVisible();

  const projectSelect = page.locator('select[name="projectId"]');
  await projectSelect.selectOption({ label: `${PREFIX} Sticky Project` });

  const taskForm = page.locator('form:has(input[placeholder="What needs doing?"])');
  await taskForm.getByPlaceholder("What needs doing?").fill(`${PREFIX} first task`);
  await taskForm.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(`${PREFIX} first task`)).toBeVisible();

  // Reload — the project select should now default to what we just used,
  // not fall back to "No project".
  await page.reload();
  const expectedValue = await projectSelect.evaluate((el: HTMLSelectElement) => {
    const opt = Array.from(el.options).find(
      (o) => o.textContent === "[e2e] Sticky Project",
    );
    return opt?.value ?? "";
  });
  expect(expectedValue).not.toBe("");
  await expect(page.locator('select[name="projectId"]')).toHaveValue(
    expectedValue,
  );
});
