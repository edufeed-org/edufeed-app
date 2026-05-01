import { test, expect } from './fixtures.js';

const ROUTES = ['/discover', '/calendar', '/c/'];

test.describe('Unified content region layout', () => {
  for (const route of ROUTES) {
    test(`single scroll surface on ${route}`, async ({ authenticatedPage: page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Count elements that actually overflow vertically.
      const scrollableCount = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        return all.filter((el) => {
          const style = window.getComputedStyle(el);
          const overflow = style.overflowY;
          const scrollable = overflow === 'auto' || overflow === 'scroll';
          return scrollable && el.scrollHeight > el.clientHeight;
        }).length;
      });

      expect(
        scrollableCount,
        `route ${route}: expected exactly 1 scrolling surface`
      ).toBeLessThanOrEqual(1);
    });

    test(`no <footer> rendered on ${route}`, async ({ authenticatedPage: page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('footer')).toHaveCount(0);
    });
  }

  test('document body does not scroll on /discover', async ({ authenticatedPage: page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    const bodyOverflow = await page.evaluate(() => {
      return document.body.scrollHeight > document.body.clientHeight + 1;
    });
    expect(bodyOverflow, 'document body must not be the scroll surface').toBe(false);
  });
});
