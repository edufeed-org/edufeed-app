import { test, expect } from './fixtures.js';
import { TEST_AUTHOR, TEST_COMMUNITY } from './test-data.js';

const ROUTES = ['/discover', '/calendar', `/c/${TEST_AUTHOR.npub}`];

test.describe('Unified content region layout', () => {
  for (const route of ROUTES) {
    test(`single scroll surface on ${route}`, async ({ authenticatedPage: page }) => {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await page.locator('nav').first().waitFor({ state: 'visible' });

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
      await page.waitForLoadState('domcontentloaded');
      await page.locator('nav').first().waitFor({ state: 'visible' });
      await expect(page.locator('footer')).toHaveCount(0);
    });
  }

  test('document body does not scroll on /discover', async ({ authenticatedPage: page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });
    const bodyOverflow = await page.evaluate(() => {
      return document.body.scrollHeight > document.body.clientHeight + 1;
    });
    expect(bodyOverflow, 'document body must not be the scroll surface').toBe(false);
  });

  test('MainContentArea wrapper does not nest its own scroll surface', async ({
    authenticatedPage: page
  }) => {
    // Navigate to a real community (TEST_COMMUNITY). MainContentArea previously
    // wrapped non-chat views in an overflow-auto div, creating a nested scroll
    // surface inside <main>. That silently broke the sticky ScrollToTopButton
    // and GlobalFAB which are anchored to <main>. After the fix, <main> is
    // the only scroller for non-chat views and the wrapper has overflow:visible.
    await page.goto(`/c/${TEST_COMMUNITY.npub}`);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });

    // Wait for MainContentArea to render its wrapper div. We identify it by
    // its distinctive class combination: min-h-0 + flex-1 + transition-all.
    // It lives somewhere inside <main> (descendant, not necessarily direct
    // child — SvelteKit page wrappers may sit between).
    await page.waitForFunction(
      () => {
        const main = document.querySelector('main');
        if (!main) return false;
        return !!main.querySelector('div.min-h-0.flex-1.transition-all');
      },
      null,
      { timeout: 12_000 }
    );

    // The wrapper's computed overflow-y must NOT be auto/scroll. On the
    // pre-fix code it was overflow-auto for non-chat views; the fix removes
    // the toggle entirely, leaving overflow:visible (the default).
    const wrapperOverflowY = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return null;
      const wrapper = main.querySelector('div.min-h-0.flex-1.transition-all');
      if (!wrapper) return null;
      return window.getComputedStyle(wrapper).overflowY;
    });
    expect(
      wrapperOverflowY,
      'MainContentArea wrapper must not be its own scroll surface (overflow-y must be visible/clip), so <main> remains the canonical scroller for non-chat views'
    ).not.toMatch(/^(auto|scroll)$/);
  });

  test('restores <main> scroll position on back navigation', async ({
    authenticatedPage: page
  }) => {
    // Navigate to discover and wait for layout
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });

    // Wait for <main> to have scrollable content. If after a reasonable timeout
    // it still isn't tall enough, skip — test would be flaky otherwise.
    let isScrollable = false;
    try {
      await page.waitForFunction(
        () => {
          const main = document.querySelector('main');
          return !!main && main.scrollHeight > main.clientHeight + 100;
        },
        null,
        { timeout: 10_000 }
      );
      isScrollable = true;
    } catch {
      // not scrollable enough
    }
    test.skip(!isScrollable, '<main> not tall enough to scroll on /discover in this environment');

    // Programmatically scroll <main> down ~500px and read back the actual value
    // (may be clamped if the content is shorter than 500px overflow).
    const targetScroll = await page.evaluate(() => {
      const main = /** @type {HTMLElement | null} */ (document.querySelector('main'));
      if (!main) return 0;
      main.scrollTop = 500;
      return main.scrollTop;
    });
    expect(targetScroll, 'main should have accepted some scroll').toBeGreaterThan(0);

    // Navigate to /calendar via client-side SPA navigation (clicking a link).
    // A hard page.goto would destroy the in-memory scrollPositions Map and skip
    // the beforeNavigate/afterNavigate hooks entirely. Use a suffix-match on
    // href so the test survives i18n prefixes / resolve()-prefixed paths.
    await page.locator('a[href$="/calendar"]').first().click();
    await page.waitForURL('**/calendar', { timeout: 10_000 });
    await page.locator('nav').first().waitFor({ state: 'visible' });

    // Go back to /discover via browser back button (also stays in SPA)
    await page.goBack();
    await page.waitForURL('**/discover', { timeout: 10_000 });
    await page.locator('nav').first().waitFor({ state: 'visible' });

    // Wait for scroll to be restored (happens in requestAnimationFrame after layout settles).
    // Tolerance ±20px to allow for content reflow / virtualization.
    await page.waitForFunction(
      (expected) => {
        const main = document.querySelector('main');
        if (!main) return false;
        return Math.abs(main.scrollTop - expected) <= 20;
      },
      targetScroll,
      { timeout: 8_000 }
    );

    const restoredScroll = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollTop : -1;
    });
    expect(Math.abs(restoredScroll - targetScroll)).toBeLessThanOrEqual(20);
  });
});
