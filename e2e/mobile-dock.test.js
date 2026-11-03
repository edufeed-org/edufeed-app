import { test, expect } from './fixtures.js';
import { TEST_AUTHOR } from './test-data.js';

// Phone bottom bar (pr/mobile-dock, tabs reworked in pr/mobile-nav): five
// labeled items — Feed · Communities · Erstellen · Posteingang · Entdecken —
// no floating create button and no Termi bubble below lg; the center item
// opens the create sheet with the phone quick row.
test.describe('Mobile dock', () => {
  test('logged-in dock shows five labeled items and no floating buttons', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/c/');
    const dock = page.getByTestId('mobile-dock');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.dock-label')).toHaveText([
      /Feed/,
      /Communities/,
      /Erstellen|Create/,
      /Posteingang|Inbox/,
      /Entdecken|Discover/
    ]);
    await expect(page.getByTestId('global-fab-button')).toBeHidden();
    await expect(page.getByTestId('termi-launcher')).toBeHidden();
    await page.getByTestId('dock-create').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByTestId('fab-phone-quick').locator('button')).toHaveCount(3);
  });

  test('the dashboard root is the feed on phones and the Feed tab is active', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/c/');
    await expect(page.getByTestId('dock-feed')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('dashboard-home')).toHaveCount(0);
  });

  test('the Communities tab is a list with Finden and the create card', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/c/?view=communities');
    await expect(page.getByTestId('communities-phone')).toBeVisible();
    await expect(page.getByTestId('communities-find')).toBeVisible();
    await expect(page.getByTestId('communities-phone-create')).toBeVisible();
    await expect(page.getByTestId('dock-communities')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('header-drawer-toggle')).toHaveCount(0);
  });

  test('inside a community the dock stays and Bereiche opens the section sheet', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${TEST_AUTHOR.npub}`);
    await expect(page.getByTestId('mobile-dock')).toBeVisible();
    await expect(page.getByTestId('header-back')).toBeVisible();
    await expect(page.getByTestId('header-switch')).toHaveCount(0);
    await expect(page.getByTestId('section-count')).toBeVisible();
    await page.getByTestId('section-open').click();
    await expect(page.getByTestId('section-sheet')).toBeVisible();
    await page.getByTestId('section-tile-calendar').click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.getByTestId('section-sheet')).toBeHidden();
  });

  test('the section row stays pinned under the header while <main> scrolls', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${TEST_AUTHOR.npub}?view=calendar`);
    const row = page.getByTestId('section-row');
    await expect(row).toBeVisible();
    const isScrollable = await page
      .waitForFunction(
        () => {
          const main = document.querySelector('main');
          return !!main && main.scrollHeight > main.clientHeight + 300;
        },
        null,
        { timeout: 15_000 }
      )
      .then(() => true)
      .catch(() => false);
    test.skip(!isScrollable, '<main> not tall enough to scroll in this environment');
    await page.evaluate(() => {
      const main = /** @type {HTMLElement} */ (document.querySelector('main'));
      main.scrollTop = 300;
    });
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="mobile-community-header"]');
      const row = document.querySelector('[data-testid="section-row"]');
      if (!header || !row) return null;
      return {
        headerBottom: Math.round(header.getBoundingClientRect().bottom),
        rowTop: Math.round(row.getBoundingClientRect().top),
        rowBottom: Math.round(row.getBoundingClientRect().bottom)
      };
    });
    expect(geometry).not.toBeNull();
    // Pinned right under the header, not scrolled away and not covered by it.
    expect(Math.abs(geometry.rowTop - geometry.headerBottom)).toBeLessThanOrEqual(2);
    expect(geometry.rowBottom).toBeGreaterThan(geometry.headerBottom);
  });
});
