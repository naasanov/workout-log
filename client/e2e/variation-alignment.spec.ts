import { test, expect } from '@playwright/test';

/**
 * Bug 3 verification: date, graph button, and delete (X) button should be
 * right-aligned and visually grouped across all variation cards.
 *
 * NOTE: The app requires authentication. If no session exists, these tests
 * verify the login page renders correctly and skip the alignment checks.
 * To fully verify alignment, run with an authenticated session.
 */

test.describe('variation card right-group alignment', () => {
  test('app loads without crashing', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/localhost:3000/);
    await page.screenshot({ path: 'e2e/screenshot-alignment.png' });
  });

  test('if authenticated: date/graph/delete buttons are right-aligned and grouped', async ({ page }) => {
    await page.goto('/');

    // Check if we're on the login page
    const isLoginPage = await page.locator('input[type="password"]').isVisible().catch(() => false);
    if (isLoginPage) {
      // Auth required — skip alignment verification, just confirm login form exists
      await expect(page.locator('input[type="password"]')).toBeVisible();
      console.log('Auth required — skipping alignment checks. Run with a logged-in session to verify.');
      return;
    }

    // If authenticated, verify the rightGroup structure on wide (desktop) layout
    await page.setViewportSize({ width: 1280, height: 900 });

    // The right group in WideVariation wraps date + graph button + delete button
    // Each variation row should have exactly one rightGroup per row
    const rightGroups = page.locator('[class*="rightGroup"]');
    const count = await rightGroups.count();

    if (count === 0) {
      console.log('No variation rows found — nothing to verify.');
      return;
    }

    // All rightGroup elements should share the same right-edge x position
    const boxes = await Promise.all(
      Array.from({ length: count }, (_, i) => rightGroups.nth(i).boundingBox())
    );

    const validBoxes = boxes.filter((b): b is NonNullable<typeof b> => b !== null);
    expect(validBoxes.length).toBeGreaterThan(0);

    if (validBoxes.length > 1) {
      // All right edges should be within 2px of each other (grid column alignment)
      const rightEdges = validBoxes.map(b => b.x + b.width);
      const minRight = Math.min(...rightEdges);
      const maxRight = Math.max(...rightEdges);
      expect(maxRight - minRight).toBeLessThanOrEqual(2);
    }

    // Each rightGroup should contain the graph button (Chart icon)
    for (let i = 0; i < count; i++) {
      const group = rightGroups.nth(i);
      // Graph button is a button inside the rightGroup
      await expect(group.locator('button').first()).toBeVisible();
    }
  });

  test('if authenticated: variation right-group is visible on desktop layout', async ({ page }) => {
    await page.goto('/');

    const isLoginPage = await page.locator('input[type="password"]').isVisible().catch(() => false);
    if (isLoginPage) {
      console.log('Auth required — skipping.');
      return;
    }

    await page.setViewportSize({ width: 1280, height: 900 });

    // The delete (X) button should be in the DOM even when not hovered
    const deleteButtons = page.locator('[class*="delete"]');
    const deleteCount = await deleteButtons.count();

    if (deleteCount > 0) {
      // Button should exist and be in the right-group (not clipped by overflow)
      const box = await deleteButtons.first().boundingBox();
      expect(box).not.toBeNull();
      // Button should have positive width (not clipped to 0)
      expect(box!.width).toBeGreaterThan(0);
    }
  });
});
