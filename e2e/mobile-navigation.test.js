import { test, expect } from '@playwright/test';
import { setupErrorCapture } from './test-utils.js';

test.describe('Mobile navigation', () => {
  test.describe('mobile viewport (375x667)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('hamburger menu is visible and desktop nav links are hidden', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Hamburger button should be visible
      const hamburger = page.getByTestId('navbar-mobile-menu');
      await expect(hamburger).toBeVisible({ timeout: 5000 });

      // Desktop nav links should be hidden
      const desktopNav = page.locator('.hidden.lg\\:flex').first();
      await expect(desktopNav).not.toBeVisible();
    });

    test('hamburger tap opens the menu sheet with nav links', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Tap hamburger — the phone menu is a bottom sheet, not a dropdown
      await page.getByTestId('navbar-mobile-menu').click();

      const dropdown = page.getByTestId('mobile-menu-sheet');
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

      // Open the menu sheet
      await page.getByTestId('navbar-mobile-menu').click();

      // Click Discover link
      const dropdown = page.getByTestId('mobile-menu-sheet');
      await expect(dropdown).toBeVisible({ timeout: 5000 });
      await dropdown
        .locator('a')
        .filter({ hasText: /Discover|Entdecken/ })
        .click();

      // Should navigate to discover page
      await expect(page).toHaveURL(/\/discover/);
    });

    test('login button is accessible in the mobile menu sheet', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      await page.getByTestId('navbar-mobile-menu').click();

      // Login button sits at the bottom of the sheet
      const dropdown = page.getByTestId('mobile-menu-sheet');
      await expect(dropdown).toBeVisible({ timeout: 5000 });
      await expect(dropdown.getByTestId('sheet-login')).toBeVisible();
    });

    test('landing shows Anmelden in the row and the account CTA opens signup', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('navbar-mobile-login')).toBeVisible({ timeout: 10_000 });
      const cta = page.getByTestId('landing-cta-signup');
      await expect(cta).toBeVisible();
      await cta.click();
      await expect(page.locator('#global-signup-modal')).toBeVisible({ timeout: 5000 });
    });

    test('landing 5b: copy A, browse link, no horizontal overflow', async ({ page }) => {
      await page.goto('/');
      const hero = page.getByTestId('landing-hero');
      await expect(hero).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('landing-cta-signup')).toHaveText(
        /Kostenlos mitmachen|Join for free/
      );
      await expect(page.getByTestId('landing-cta-browse')).toHaveAttribute('href', '/discover');
      // Live cards and the avatar wall arrive late; give them time to lay out.
      await page.waitForTimeout(3000);
      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(docWidth).toBeLessThanOrEqual(viewportWidth);
      // The page scrolls inside <main>, which also clips horizontally — an
      // overflow there never widens the document, so measure it directly.
      const main = await page.evaluate(() => {
        const el = document.querySelector('main');
        return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
      });
      expect(main).not.toBeNull();
      expect(main?.scroll).toBeLessThanOrEqual(/** @type {number} */ (main?.client));
    });

    test('no horizontal overflow on discover page', async ({ page }) => {
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

      // Open and close the menu sheet
      await page.getByTestId('navbar-mobile-menu').click();
      await expect(page.getByTestId('mobile-menu-sheet')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('bottom-sheet-close').click();
      await expect(page.getByTestId('mobile-menu-sheet')).not.toBeVisible();

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
