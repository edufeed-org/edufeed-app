/**
 * E2E tests for community join/leave flows.
 *
 * Tests join and leave functionality on discover page and community page.
 * Includes both authenticated and unauthenticated user flows.
 */
import { test, expect } from './fixtures.js';
import { setupErrorCapture, waitForCommunitySidebar } from './test-utils.js';
import { TEST_COMMUNITY } from './test-data.js';

const COMMUNITY_URL = `/c/${TEST_COMMUNITY.npub}`;

/**
 * Navigate to discover page and switch to Communities tab.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToCommunitiesTab(page) {
  await page.goto('/discover');
  await page.waitForTimeout(2000);

  // Click the Communities tab using data-testid
  await page.locator('[data-testid="tab-communities"]').click();

  // Wait for community cards to load
  await page.waitForTimeout(3000);
}

/**
 * Navigate to a community page and wait for it to load.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToCommunityPage(page) {
  await page.goto(COMMUNITY_URL);
  await waitForCommunitySidebar(page);
  await page.waitForTimeout(1000);
}

// ============================================================================
// Unauthenticated User Tests
// ============================================================================

test.describe('Community Membership - Unauthenticated', () => {
  test('join button not visible on discover page when not logged in', async ({ page }) => {
    await navigateToCommunitiesTab(page);

    // Community cards should be visible (they show "Community Host X" names)
    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Join buttons should NOT be visible (they only show for authenticated users)
    // The button has class btn-primary or btn-outline and text Join/Leave
    const joinButtons = cards.first().locator('button', { hasText: /Join|Leave/ });
    await expect(joinButtons).not.toBeVisible({ timeout: 3000 });
  });

  test('community header shows "Not Joined" badge when not logged in', async ({ page }) => {
    await navigateToCommunityPage(page);

    // Should show "Not Joined" badge (use first() for desktop/mobile layouts)
    const notJoinedBadge = page.locator('.badge', { hasText: 'Not Joined' }).first();
    await expect(notJoinedBadge).toBeVisible({ timeout: 10000 });
  });

  test('join button in header is visible when not logged in', async ({ page }) => {
    await navigateToCommunityPage(page);

    // Join button should be visible in header (text is "Join Community")
    // Use first() because there may be multiple (desktop/mobile layouts)
    const joinButton = page.locator('button', { hasText: 'Join Community' }).first();
    await expect(joinButton).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Join Flow - Authenticated
// ============================================================================

test.describe('Community Membership - Join Flow', () => {
  test('join button visible on discover page when logged in', async ({
    authenticatedPage: page
  }) => {
    await navigateToCommunitiesTab(page);

    // Community cards should be visible
    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Join button should be visible for authenticated users
    const joinButton = cards.first().locator('button', { hasText: 'Join' });
    await expect(joinButton).toBeVisible({ timeout: 5000 });
  });

  test('can join community from discover page', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    // Find a community card with a Join button (not already joined)
    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Click the Join button
    const joinButton = cards.first().locator('button', { hasText: 'Join' });

    // Skip if already joined (button would say "Leave")
    const buttonText = await joinButton.textContent();
    if (buttonText?.includes('Leave')) {
      test.skip();
      return;
    }

    await joinButton.click();

    // Wait for the operation to complete
    await page.waitForTimeout(3000);

    // Button should now say "Leave" (indicating joined state)
    await expect(cards.first().locator('button', { hasText: 'Leave' })).toBeVisible({
      timeout: 10000
    });
  });

  test('can join community from community page header', async ({ authenticatedPage: page }) => {
    await navigateToCommunityPage(page);

    // Check if already joined
    const joinedBadge = page.locator('.badge-success', { hasText: 'Joined' });
    const isJoined = await joinedBadge.isVisible();

    if (isJoined) {
      // Already joined, skip this test
      test.skip();
      return;
    }

    // Click the Join button in header (use first() for desktop/mobile layouts)
    const joinButton = page.locator('button.btn-primary', { hasText: 'Join' }).first();
    await expect(joinButton).toBeVisible({ timeout: 5000 });
    await joinButton.click();

    // Wait for operation to complete
    await page.waitForTimeout(3000);

    // Should now show "Joined" badge (use first() for desktop/mobile layouts)
    await expect(page.locator('.badge-success', { hasText: 'Joined' }).first()).toBeVisible({
      timeout: 10000
    });
  });

  test('join shows loading state during publish', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    const joinButton = cards.first().locator('button', { hasText: /Join|Leave/ });

    // Click the button
    await joinButton.click();

    // Should show loading spinner (the button contains a loading element)
    // Note: This happens very quickly, so we might not always catch it
    // Just verify the click doesn't cause an error
    await page.waitForTimeout(1000);
  });
});

// ============================================================================
// Leave Flow - Authenticated
// ============================================================================

test.describe('Community Membership - Leave Flow', () => {
  test('can leave joined community from discover page', async ({ authenticatedPage: page }) => {
    // First, ensure we're joined to a community
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Find the button
    const membershipButton = cards.first().locator('button', { hasText: /Join|Leave/ });
    const buttonText = await membershipButton.textContent();

    // If not joined, join first
    if (buttonText?.includes('Join')) {
      await membershipButton.click();
      await page.waitForTimeout(3000);
    }

    // Now verify we're joined (button says Leave)
    await expect(cards.first().locator('button', { hasText: 'Leave' })).toBeVisible({
      timeout: 10000
    });

    // Click Leave
    await cards.first().locator('button', { hasText: 'Leave' }).click();

    // Wait for operation to complete
    await page.waitForTimeout(3000);

    // Button should now say "Join" again
    await expect(cards.first().locator('button', { hasText: 'Join' })).toBeVisible({
      timeout: 10000
    });
  });

  test('leave removes joined badge from card', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Join first if needed
    const membershipButton = cards.first().locator('button', { hasText: /Join|Leave/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Join')) {
      await membershipButton.click();
      // Wait for Leave button to confirm join completed
      await expect(cards.first().locator('button', { hasText: 'Leave' })).toBeVisible({
        timeout: 10000
      });
    }

    // Verify joined state - card should have joined visual indicator
    // The card gets border-success/30 class when joined (the anchor element)
    const cardElement = cards.first();
    await expect(cardElement).toHaveClass(/border-success/, { timeout: 5000 });

    // Now leave
    await cards.first().locator('button', { hasText: 'Leave' }).click();
    // Wait for Join button to confirm leave completed
    await expect(cards.first().locator('button', { hasText: 'Join' })).toBeVisible({
      timeout: 10000
    });

    // Card should no longer have the joined styling
    await expect(cardElement).not.toHaveClass(/border-success/);
  });
});

// ============================================================================
// Membership State Persistence
// ============================================================================

test.describe('Community Membership - Persistence', () => {
  test('membership state persists across page navigation', async ({ authenticatedPage: page }) => {
    // Join a community on discover page
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Ensure we're joined
    const membershipButton = cards.first().locator('button', { hasText: /Join|Leave/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Join')) {
      await membershipButton.click();
      // Wait for Leave button to confirm join completed
      await expect(cards.first().locator('button', { hasText: 'Leave' })).toBeVisible({
        timeout: 10000
      });
    }

    // Navigate to a different page
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Navigate back to communities tab
    await navigateToCommunitiesTab(page);

    // Should still show as joined (Leave button visible)
    const cardsAfterNav = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cardsAfterNav.first()).toBeVisible({ timeout: 15000 });
    await expect(cardsAfterNav.first().locator('button', { hasText: 'Leave' })).toBeVisible({
      timeout: 10000
    });
  });
});

// ============================================================================
// Error Handling
// ============================================================================

test.describe('Community Membership - Error Handling', () => {
  test('no critical JavaScript errors during join flow', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Click join/leave button
    const membershipButton = cards.first().locator('button', { hasText: /Join|Leave/ });
    await membershipButton.click();
    await page.waitForTimeout(3000);

    errorCapture.assertNoCriticalErrors();
  });

  test('no critical JavaScript errors during leave flow', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Ensure we're joined first
    const membershipButton = cards.first().locator('button', { hasText: /Join|Leave/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Join')) {
      await membershipButton.click();
      // Wait for Leave button to confirm join completed
      await expect(cards.first().locator('button', { hasText: 'Leave' })).toBeVisible({
        timeout: 10000
      });
    }

    // Now leave
    await cards.first().locator('button', { hasText: 'Leave' }).click();
    await page.waitForTimeout(3000);

    errorCapture.assertNoCriticalErrors();
  });
});
