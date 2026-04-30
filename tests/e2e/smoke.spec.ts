import { test, expect } from '@playwright/test';

/**
 * Smoke test minimal : valide que Playwright + Next.js dev server
 * sont correctement branchés. Sera remplacé par les vrais tests
 * dans les commits suivants.
 */
test('smoke: homepage répond', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});
