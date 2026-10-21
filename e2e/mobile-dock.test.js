import { test, expect } from './fixtures.js';

// Phone bottom bar (pr/mobile-dock): five labeled items, no floating create
// button and no Termi bubble below lg; the center item opens the create sheet.
test.describe('Mobile dock', () => {
  test('logged-in dock shows five labeled items and no floating buttons', async ({
    authenticatedPage: page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/c/');
    const dock = page.getByTestId('mobile-dock');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.dock-label')).toHaveText([
      /Start/,
      /Entdecken|Discover/,
      /Erstellen|Create/,
      /Posteingang|Inbox/,
      /Communities/
    ]);
    await expect(page.getByTestId('global-fab-button')).toBeHidden();
    await expect(page.getByTestId('termi-launcher')).toBeHidden();
    await page.getByTestId('dock-create').click();
    await expect(page.getByRole('menu')).toBeVisible();
  });
});
