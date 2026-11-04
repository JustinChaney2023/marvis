import { test, expect } from "@playwright/test";

// Same rule as event-modal.spec.ts: only ever touch rows this suite made.
const PREFIX = "[e2e]";

test.afterEach(async ({ request }) => {
  await request.post("/api/test/cleanup", { data: { prefix: PREFIX } });
});

test("dragging an event shows a drop skeleton and the block lands where it showed", async ({ page }) => {
  await page.goto("/home?view=week", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ New event" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Title").fill(`${PREFIX} Drag me`);
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();

  const block = page.locator("button[data-event]", { hasText: `${PREFIX} Drag me` }).filter({ visible: true }).first();
  await expect(block).toBeVisible();
  const from = (await block.boundingBox())!;

  // Grab the block 12px below (mid-block, clear of the resize handle) its top edge, then hover ~2 hours (96px) lower.
  const grabY = from.y + 12;
  const dy = 96;
  await page.mouse.move(from.x + from.width / 2, grabY);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, grabY + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, grabY + dy, { steps: 5 });

  const skeleton = page.locator("[data-drop-skeleton]");
  await expect(skeleton).toBeVisible();
  const ghost = (await skeleton.boundingBox())!;
  // The skeleton shows the block's TOP edge, not the cursor: it must sit ~dy
  // below where the block started (15 min snap: at most 6px off).
  expect(Math.abs(ghost.y - (from.y + dy))).toBeLessThanOrEqual(7);

  await page.mouse.up();
  await expect(skeleton).toHaveCount(0);
  const moved = page.locator("button[data-event]", { hasText: `${PREFIX} Drag me` }).filter({ visible: true }).first();
  await expect.poll(async () => Math.abs((await moved.boundingBox())!.y - ghost.y)).toBeLessThanOrEqual(3);
});
