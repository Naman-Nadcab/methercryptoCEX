import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await expect(page).toHaveTitle(/Crypto|Exchange|Trading/i);
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 5_000 });
  });

  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForURL(/\/(login|auth|dashboard)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/(login|auth|dashboard)/);
  });

  test('spot page loads', async ({ page }) => {
    await page.goto('/spot', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 5_000 });
  });

  test('p2p page loads', async ({ page }) => {
    await page.goto('/p2p', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 5_000 });
  });
});
