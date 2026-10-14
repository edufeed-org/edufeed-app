import { test, expect } from '@playwright/test';
import { setupErrorCapture } from './test-utils.js';

test.describe('Mobile navigation', () => {
  test.describe('mobile viewport (375x667)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('hamburger menu is visible and desktop nav links are hidden', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Hamburger button should be visible
      const hamburger = page.locator('.lg\\:hidden .dropdown .btn-ghost.btn-circle');
      await expect(hamburger).toBeVisible({ timeout: 5000 });

      // Desktop nav links should be hidden
      const desktopNav = page.locator('.hidden.lg\\:flex').first();
      await expect(desktopNav).not.toBeVisible();
    });

    test('hamburger click opens dropdown with nav links', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Click hamburger
      const hamburger = page.locator('.lg\\:hidden .dropdown .btn-ghost.btn-circle');
      await hamburger.click();
      await page.waitForTimeout(300);

      // Dropdown menu should appear with nav links
      const dropdown = page.locator('.lg\\:hidden .dropdown-content');
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      // Should contain Communities, Discover, Calendar links
      await expect(
        dropdown.locator('a').filter({ hasText: /Communities|Gemeinschaften/ })
      ).toBeVisible();
      await expect(dropdown.locator('a').filter({ hasText: /Discover|Entdecken/ })).toBeVisible();
      await expect(dropdown.locator('a').filter({ hasText: /Calendar|Kalender/ })).toBeVisible();
    });

    test('nav link click navigates correctly', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open hamburger
      const hamburger = page.locator('.lg\\:hidden .dropdown .btn-ghost.btn-circle');
      await hamburger.click();
      await page.waitForTimeout(300);

      // Click Discover link
      const dropdown = page.locator('.lg\\:hidden .dropdown-content');
      await dropdown
        .locator('a')
        .filter({ hasText: /Discover|Entdecken/ })
        .click();

      // Should navigate to discover page
      await expect(page).toHaveURL(/\/discover/);
    });

    test('login button is accessible in mobile dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open hamburger
      const hamburger = page.locator('.lg\\:hidden .dropdown .btn-ghost.btn-circle');
      await hamburger.click();
      await page.waitForTimeout(300);

      // Login button should be in the dropdown
      const dropdown = page.locator('.lg\\:hidden .dropdown-content');
      await expect(dropdown.locator('button').filter({ hasText: /Login|Anmelden/ })).toBeVisible();
    });

    test('no horizontal overflow on discover page', async ({ page }) => {
      // Use /discover (not homepage which has pre-existing hero section overflow)
      await page.goto('/discover');
      await page.waitForTimeout(3000);

      // Document width should not exceed viewport width
      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(docWidth).toBeLessThanOrEqual(viewportWidth);
    });

    test('no critical JavaScript errors on mobile', async ({ page }) => {
      const errorCapture = setupErrorCapture(page);

      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open and close hamburger
      const hamburger = page.locator('.lg\\:hidden .dropdown .btn-ghost.btn-circle');
      await hamburger.click();
      await page.waitForTimeout(300);

      errorCapture.assertNoCriticalErrors();
    });
  });

  test.describe('desktop viewport (1280x720)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('navbar logo src matches configured APP_LOGO from API config', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Fetch the expected logo URL from the config API
      const config = await page.evaluate(() => fetch('/api/config').then((r) => r.json()));

      // Verify the logo img src matches the configured value
      const logoImg = page.locator('img[alt="App Logo"]');
      await expect(logoImg).toHaveAttribute('src', config.appLogo);
    });

    test('desktop nav links are visible and hamburger is hidden', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Desktop nav links should be visible
      const desktopNav = page.locator('.hidden.lg\\:flex').first();
      await expect(desktopNav).toBeVisible({ timeout: 5000 });

      // Hamburger menu container should be hidden
      const mobileMenu = page.locator('.lg\\:hidden');
      await expect(mobileMenu).not.toBeVisible();
    });
  });
});
