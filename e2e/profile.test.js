import { test, expect } from '@playwright/test';
import { TEST_AUTHOR } from './test-data.js';
import { setupErrorCapture } from './test-utils.js';

const PROFILE_URL = `/p/${TEST_AUTHOR.npub}`;

test.describe('Profile page', () => {
  test('loads and shows user info', async ({ page }) => {
    await page.goto(PROFILE_URL);

    // Wait for profile to load (profile name appears in h1)
    await expect(page.locator('h1')).toContainText(TEST_AUTHOR.name, { timeout: 15_000 });

    // Profile avatar should be visible (alt = display name from test data).
    // Feed cards streaming in below also carry the author avatar, so match
    // only the first (header) instance to avoid a strict-mode violation.
    await expect(page.locator(`img[alt="${TEST_AUTHOR.name}"]`).first()).toBeVisible({
      timeout: 15_000
    });

    // Bio should be visible
    await expect(page.getByText('Bio for test author 0')).toBeVisible();
  });

  test('shows notes tab with user notes', async ({ page }) => {
    await page.goto(PROFILE_URL);

    // Wait for profile to load
    await expect(page.locator('h1')).toContainText(TEST_AUTHOR.name, { timeout: 15_000 });

    // Notes tab should be visible
    const notesTab = page.locator('button', { hasText: 'Notes' });
    await expect(notesTab).toBeVisible();

    // Click "Load more" to trigger loading notes from relay
    const loadMoreBtn = page.locator('button', { hasText: 'Load more' });
    if (await loadMoreBtn.isVisible()) {
      await loadMoreBtn.click();
    }

    // Wait for notes to load from mock relay
    await expect(async () => {
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain('Test note');
    }).toPass({ timeout: 15_000 });
  });

  test('unknown profile shows not found state', async ({ page }) => {
    // Use a valid hex pubkey that doesn't exist in test data
    // 64 hex chars, valid format but no matching profile
    await page.goto('/p/0000000000000000000000000000000000000000000000000000000000000001');

    // Should show "Profile Not Found" after timeout (5s in the component)
    await expect(page.getByText('Profile Not Found')).toBeVisible({ timeout: 10_000 });
  });

  test('no critical JavaScript errors', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto(PROFILE_URL);
    await expect(page.locator('h1')).toContainText(TEST_AUTHOR.name, { timeout: 15_000 });

    errorCapture.assertNoCriticalErrors();
  });
});
