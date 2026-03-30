import { test, expect } from '@playwright/test';
import { TEST_COMMUNITY_GATED } from './test-data.js';
import { waitForCommunitySidebar, setupErrorCapture } from './test-utils.js';

const COMMUNITY_URL = `/c/${TEST_COMMUNITY_GATED.npub}`;

/**
 * Navigate to gated community page and wait for it to load.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToCommunity(page) {
  await page.goto(COMMUNITY_URL);
  await waitForCommunitySidebar(page);
  await page.waitForTimeout(500);
}

/**
 * Click a tab button in the desktop content nav sidebar and wait for content.
 * @param {import('@playwright/test').Page} page
 * @param {string} label - Tab label text (e.g., "Forum", "Chat")
 * @param {string} [contentSelector] - Optional selector to wait for after click
 */
async function clickNavTab(page, label, contentSelector) {
  await page.locator('nav.menu button', { hasText: label }).click();
  if (contentSelector) {
    await expect(page.locator(contentSelector).first()).toBeVisible({ timeout: 30_000 });
  } else {
    await page.waitForTimeout(1000);
  }
}

test.describe('Community access filtering - Forum (restricted)', () => {
  test('shows only member threads in gated forum section', async ({ page }) => {
    await navigateToCommunity(page);
    await clickNavTab(page, 'Forum', '.thread-card');

    // Wait for profile list access to resolve and content to filter
    // Use .first() because both desktop and mobile layouts render MainContentArea
    await expect(async () => {
      // Member thread should be visible
      await expect(
        page.locator('.thread-card', { hasText: 'Member Thread: Welcome to the Forum' }).first()
      ).toBeVisible();

      // Non-member thread should NOT be visible (count 0 across all layouts)
      await expect(
        page.locator('.thread-card', { hasText: 'Non-Member Thread: Hello World' })
      ).toHaveCount(0);
    }).toPass({ timeout: 15_000, intervals: [500, 1000, 2000] });
  });
});

test.describe('Community access filtering - Chat (open)', () => {
  test('shows all messages in open chat section', async ({ page }) => {
    await navigateToCommunity(page);
    await clickNavTab(page, 'Chat', '.chat');

    // Both messages should be visible regardless of membership
    // Use .first() because both desktop and mobile layouts render Chat
    await expect(async () => {
      await expect(
        page.locator('.chat-bubble', { hasText: 'Chat from member author' }).first()
      ).toBeVisible();
      await expect(
        page.locator('.chat-bubble', { hasText: 'Chat from non-member author' }).first()
      ).toBeVisible();
    }).toPass({ timeout: 15_000, intervals: [500, 1000, 2000] });
  });
});

test.describe('Community access filtering - general', () => {
  test('no critical JavaScript errors when navigating tabs', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCommunity(page);
    await clickNavTab(page, 'Forum');
    await page.waitForTimeout(2000);
    await clickNavTab(page, 'Chat');
    await page.waitForTimeout(2000);

    errorCapture.assertNoCriticalErrors();
  });
});
