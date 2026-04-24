import { test, expect } from '@playwright/test';
import { waitForCalendarEvents, setupErrorCapture } from './test-utils.js';

test.describe('Calendar page chrome', () => {
  test('footer is visible at the bottom of /calendar', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('footer').first()).toBeVisible();
  });

  test('page uses min-h-screen wrapper (not a card)', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    // The new page wrapper (replacing the old island card) is min-h-screen bg-base-100.
    await expect(page.locator('div.min-h-screen.bg-base-100').first()).toBeVisible();
    // The old outer `flex w-full max-w-full` sidebar+content wrapper is gone.
    await expect(page.locator('div.flex.w-full.max-w-full')).toHaveCount(0);
  });

  test('desktop inline filter bar is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    // The inline filter bar renders its triggers with data-filter-trigger.
    const triggers = page.locator('[data-filter-trigger]');
    await expect(triggers.first()).toBeVisible();
    // At minimum: Tags, Relays, Follow-Listen, Search = 4 triggers.
    expect(await triggers.count()).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Mobile filter drawer', () => {
  test('small viewport shows Filter button that opens the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Filter button appears only on lg:hidden, in the header row
    const filterBtn = page.getByRole('button', { name: /^Filter(\s|$|\()/ }).first();
    await expect(filterBtn).toBeVisible();
    await filterBtn.click();

    // Drawer has role="dialog" with aria-labelledby="filter-drawer-title"
    const drawer = page.getByRole('dialog', { name: /Filter/ });
    await expect(drawer).toBeVisible();

    // Close via Escape (window-level keydown listener in the drawer)
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
  });

  test('no critical JavaScript errors on mobile drawer flow', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const filterBtn = page.getByRole('button', { name: /^Filter(\s|$|\()/ }).first();
    await filterBtn.click();
    await page.keyboard.press('Escape');

    errorCapture.assertNoCriticalErrors();
  });
});

test.describe('Featured Authors rail', () => {
  test('rail is present only when CALENDAR_FEATURED_AUTHORS is configured', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const rail = page.locator('[data-testid="featured-authors"]').first();
    const count = await rail.count();
    if (count === 0) {
      test.skip(true, 'CALENDAR_FEATURED_AUTHORS is empty in this env');
      return;
    }
    await expect(rail).toBeVisible();
  });
});
