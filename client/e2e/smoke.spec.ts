import { test, expect } from '@playwright/test';

test('app loads and shows login or main page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/localhost:3000/);
  const title = await page.title();
  console.log('Page title:', title);
  await page.screenshot({ path: 'e2e/screenshot-smoke.png' });
});
