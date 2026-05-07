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
      'MainContentArea wrapper selector must resolve so the overflow check is meaningful (a null result would silently pass not.toMatch)'
    ).not.toBeNull();
    expect(
      wrapperOverflowY,
      'MainContentArea wrapper must not be its own scroll surface (overflow-y must be visible/clip), so <main> remains the canonical scroller for non-chat views'
    ).not.toMatch(/^(auto|scroll)$/);
  });

  test('mobile community header stays pinned during <main> scroll', async ({
    authenticatedPage: page
  }) => {
    // Use a mobile viewport so the lg:hidden mobile community header branch renders.
    await page.setViewportSize({ width: 390, height: 844 });

    // Use the /c/ dashboard with the Communities view — it lists all 30 test
    // communities, which is reliably tall enough to overflow on a 390x844 viewport.
    // The mobile community header renders on every /c/* route via
    // src/routes/c/+layout.svelte, so dashboard works the same as a single-community
    // page for this assertion.
    await page.goto(`/c/?view=communities`);
    await page.waitForLoadState('domcontentloaded');

    // The mobile community header is identified by a data-testid added in
    // src/routes/c/+layout.svelte so the selector is robust against refactors.
    // Wait for the header itself rather than <nav> because the desktop sidebar
    // <nav> is lg:hidden on this mobile viewport.
    const header = page.locator('[data-testid="mobile-community-header"]');
    await header.waitFor({ state: 'visible', timeout: 15_000 });

    // Capture initial header top — it should be flush with the viewport top
    // (or with the navbar above it). What matters is that it stays put after scroll.
    const initialTop = await header.evaluate((el) => el.getBoundingClientRect().top);

    // Wait for <main> to be tall enough to actually scroll. Skip on environments
    // where the community page hasn't loaded enough content to overflow.
    // Need enough overflow to scroll a meaningful distance and detect whether
    // the header pins. The community-mode drawer wraps content in h-dvh, so
    // overflow on <main> tends to be modest — 50px is enough for our assertion.
    let isScrollable = false;
    try {
      await page.waitForFunction(
        () => {
          const main = document.querySelector('main');
          return !!main && main.scrollHeight > main.clientHeight + 50;
        },
        null,
        { timeout: 15_000 }
      );
      isScrollable = true;
    } catch {
      // not scrollable enough
    }
    test.skip(!isScrollable, '<main> not tall enough to scroll on /c/[npub] in this environment');

    // Programmatically scroll <main> down and confirm it took effect.
    // Request 500px; the browser clamps to the actual overflow, which on this
    // route is on the order of tens of pixels (community-mode wraps content in
    // h-dvh). Even 30+ px is plenty to detect a non-sticky header (which would
    // move up by exactly that amount).
    const actualScroll = await page.evaluate(() => {
      const main = /** @type {HTMLElement | null} */ (document.querySelector('main'));
      if (!main) return 0;
      main.scrollTop = 500;
      return main.scrollTop;
    });
    expect(actualScroll, 'main should have accepted some scroll').toBeGreaterThan(20);

    // After scroll, the sticky header's top should still be ~initialTop.
    // Without sticky positioning the header would scroll up by `actualScroll`,
    // landing at roughly initialTop - actualScroll (negative).
    const afterTop = await header.evaluate((el) => el.getBoundingClientRect().top);
    expect(
      Math.abs(afterTop - initialTop),
      `mobile community header should stay pinned during <main> scroll (initialTop=${initialTop}, afterTop=${afterTop}, scrolled=${actualScroll})`
    ).toBeLessThanOrEqual(2);
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

  test('main has no sidebar margin offset on desktop community route', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/c/${TEST_AUTHOR.npub}`);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });

    const mainMarginLeft = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? getComputedStyle(main).marginLeft : null;
    });

    expect(mainMarginLeft).toBe('0px');
  });

  test('desktop sidebars stay pinned during <main> scroll', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/c/${TEST_AUTHOR.npub}`);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });
    await page.locator('[data-testid="content-nav-sidebar"]').waitFor({ state: 'visible' });

    // Capture sidebar bounding rects before scroll.
    const sidebarsBefore = await page.evaluate(() => {
      const community = document.querySelector('[data-testid="community-sidebar"]');
      const nav = document.querySelector('[data-testid="content-nav-sidebar"]');
      return {
        community: community?.getBoundingClientRect()?.top ?? null,
        nav: nav?.getBoundingClientRect()?.top ?? null
      };
    });
    expect(sidebarsBefore.community, 'CommunitySidebar must be present').not.toBeNull();
    expect(sidebarsBefore.nav, 'ContentNavSidebar must be present').not.toBeNull();

    // Structural invariant (always runs, even when <main> can't scroll):
    // sidebars must NOT be descendants of <main>. If they were, scrolling
    // <main> would move them — i.e. the regression we're guarding against.
    const sidebarsAreSiblings = await page.evaluate(() => {
      const main = document.querySelector('main');
      const community = document.querySelector('[data-testid="community-sidebar"]');
      const nav = document.querySelector('[data-testid="content-nav-sidebar"]');
      return {
        communityInsideMain: main?.contains(community) ?? false,
        navInsideMain: main?.contains(nav) ?? false
      };
    });
    expect(
      sidebarsAreSiblings.communityInsideMain,
      'CommunitySidebar must NOT be a descendant of <main>'
    ).toBe(false);
    expect(
      sidebarsAreSiblings.navInsideMain,
      'ContentNavSidebar must NOT be a descendant of <main>'
    ).toBe(false);

    // Scroll <main>; if the page doesn't have enough content to scroll, skip
    // (a stationary sidebar at scrollTop=0 would trivially pass and mask
    // re-introduction of position:fixed on a sidebar inside <main>).
    const actualScroll = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return 0;
      main.scrollTop = Math.min(500, main.scrollHeight - main.clientHeight);
      return main.scrollTop;
    });
    test.skip(actualScroll <= 20, '<main> has insufficient overflow on this run');

    const sidebarsAfter = await page.evaluate(() => {
      const community = document.querySelector('[data-testid="community-sidebar"]');
      const nav = document.querySelector('[data-testid="content-nav-sidebar"]');
      return {
        community: community?.getBoundingClientRect()?.top ?? null,
        nav: nav?.getBoundingClientRect()?.top ?? null
      };
    });

    // Both sidebars must NOT have moved — they're flex siblings outside <main>.
    expect(sidebarsAfter.community).toBe(sidebarsBefore.community);
    expect(sidebarsAfter.nav).toBe(sidebarsBefore.nav);
  });

  test('FAB pins to bottom of <main> when content is shorter than viewport', async ({
    authenticatedPage: page
  }) => {
    // Regression: the FAB lives in a `sticky bottom-0 h-0` wrapper inside <main>.
    // `position: sticky` only activates when natural-flow position would otherwise
    // scroll past the boundary — on short pages (no overflow) it degrades to
    // static and the wrapper sits in document flow, halfway up the viewport.
    // Fix: `mt-auto` on the wrapper pushes it to the bottom of the flex column
    // even when content is short, so the FAB lands at the bottom of the scroll
    // port. On long pages `mt-auto` is a no-op (no free space) and sticky takes
    // over normally.
    //
    // Use a tall desktop viewport to guarantee <main> does not overflow on
    // /c/?view=communities (Communities view with empty/sparse test data).
    await page.setViewportSize({ width: 1280, height: 2000 });
    await page.goto('/c/?view=communities');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });

    // Wait for the FAB to be in the DOM.
    await page.locator('main .fab').waitFor({ state: 'visible', timeout: 10_000 });

    const layout = await page.evaluate(() => {
      const main = /** @type {HTMLElement | null} */ (document.querySelector('main'));
      const wrap = main?.querySelector(':scope > .sticky');
      const fab = main?.querySelector('.fab');
      if (!main || !wrap || !fab) return null;
      return {
        overflow: main.scrollHeight > main.clientHeight,
        mainBottom: main.getBoundingClientRect().bottom,
        wrapTop: wrap.getBoundingClientRect().top,
        fabBottom: fab.getBoundingClientRect().bottom,
        wrapClassList: Array.from(wrap.classList)
      };
    });
    expect(layout, 'main, sticky wrapper, and .fab must all be present').not.toBeNull();
    if (!layout) return;

    // Precondition for the regression scenario — the test is meaningful only
    // when <main> does not overflow (otherwise sticky alone would already pin
    // the wrapper). If the test environment somehow renders enough content to
    // overflow even on a 2000px-tall viewport, skip rather than report a
    // misleading pass.
    test.skip(
      layout.overflow,
      '<main> overflows even on 2000px viewport — regression scenario unreachable'
    );

    // Class-presence check on `mt-auto`. We can't assert the computed
    // margin-top value because for a flex item with `margin-top: auto`,
    // `getComputedStyle().marginTop` returns the *used* value (the pixel
    // amount absorbed), not the keyword "auto". The geometric check below
    // is the behavioral assertion; this one documents the mechanism.
    expect(
      layout.wrapClassList,
      'sticky wrapper must include `mt-auto` so it pushes to the bottom of <main> on short pages'
    ).toContain('mt-auto');

    // The wrapper itself (h-0) should land at <main>'s bottom edge. Allow ~2px
    // for sub-pixel rounding. This is the structural behavior the fix delivers
    // — without `mt-auto`, the wrapper sits at its natural-flow position right
    // after the content (halfway up the viewport on short pages).
    expect(
      Math.abs(layout.wrapTop - layout.mainBottom),
      `wrapper top (${layout.wrapTop}) should be at <main> bottom (${layout.mainBottom})`
    ).toBeLessThanOrEqual(2);

    // The FAB itself should land near <main>'s bottom — within the speed-dial
    // primary button height + the bottom-6/bottom-20 offset. We don't assert
    // an exact pixel value because the offset is responsive (lg:bottom-6 vs
    // bottom-20) and the button size depends on btn-lg sizing. The structural
    // wrapTop check above is the strict assertion; this is a sanity bound.
    expect(
      layout.mainBottom - layout.fabBottom,
      `FAB bottom (${layout.fabBottom}) should be close to <main> bottom (${layout.mainBottom})`
    ).toBeLessThan(120);
  });

  test('ContentNavSidebar mounts on community routes, unmounts on dashboard', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Dashboard: DashboardNavSidebar visible, ContentNavSidebar absent.
    await page.goto('/c/');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });
    await expect(page.locator('[data-testid="dashboard-nav-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="content-nav-sidebar"]')).toHaveCount(0);

    // Community route: ContentNavSidebar visible, DashboardNavSidebar absent.
    await page.goto(`/c/${TEST_AUTHOR.npub}`);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });
    await expect(page.locator('[data-testid="content-nav-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-nav-sidebar"]')).toHaveCount(0);

    // Back to dashboard: ContentNavSidebar gone again.
    await page.goto('/c/');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav').first().waitFor({ state: 'visible' });
    await expect(page.locator('[data-testid="content-nav-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dashboard-nav-sidebar"]')).toBeVisible();
  });
});
