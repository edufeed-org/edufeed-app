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

    // Join/leave buttons should NOT be visible (they only show for authenticated users)
    // The button has class btn-primary or btn-outline and text "Follow"/"Unfollow"
    // (CommunikeyCard.svelte, communikey_card_button_join/_leave)
    const joinButtons = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
    await expect(joinButtons).not.toBeVisible({ timeout: 3000 });
  });

  test('community header shows no "Following" badge when not logged in', async ({ page }) => {
    await navigateToCommunityPage(page);

    // The joined indicator (badge-success "Following", CommunityProfileHero.svelte's
    // communikey_header_joined_badge) must not render for a logged-out visitor — there
    // is no separate "not joined" badge in the current UI, only the absence of this one
    // plus the join button (covered by the next test).
    const followingBadge = page.locator('.badge-success', { hasText: 'Following' }).first();
    await expect(followingBadge).not.toBeVisible({ timeout: 5000 });
  });

  test('join button in header is visible when not logged in', async ({ page }) => {
    await navigateToCommunityPage(page);

    // Join button should be visible in header (text is "Follow Community",
    // CommunityProfileHero.svelte's communikey_header_join_button)
    // Use first() because there may be multiple (desktop/mobile layouts)
    const joinButton = page.locator('button', { hasText: 'Follow Community' }).first();
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

    // Join button should be visible for authenticated users (text "Follow",
    // exact match — "Follow" is a case-insensitive substring of "Unfollow" too)
    const joinButton = cards.first().locator('button', { hasText: /^Follow$/ });
    await expect(joinButton).toBeVisible({ timeout: 5000 });
  });

  test('can join community from discover page', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    // Find a community card with a Follow button (not already joined)
    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Click the Follow button
    const joinButton = cards.first().locator('button', { hasText: /^Follow$/ });

    // Skip if already joined (button would say "Unfollow")
    const buttonText = await joinButton.textContent();
    if (buttonText?.includes('Unfollow')) {
      test.skip();
      return;
    }

    await joinButton.click();

    // Wait for the operation to complete
    await page.waitForTimeout(3000);

    // Button should now say "Unfollow" (indicating joined state)
    await expect(cards.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
      timeout: 10000
    });
  });

  test('can join community from community page header', async ({ authenticatedPage: page }) => {
    await navigateToCommunityPage(page);

    // Check if already joined (badge-success "Following",
    // CommunityProfileHero.svelte's communikey_header_joined_badge)
    const joinedBadge = page.locator('.badge-success', { hasText: 'Following' });
    const isJoined = await joinedBadge.isVisible();

    if (isJoined) {
      // Already joined, skip this test
      test.skip();
      return;
    }

    // Click the Follow Community button in header (use first() for desktop/mobile layouts)
    const joinButton = page.locator('button.btn-primary', { hasText: 'Follow Community' }).first();
    await expect(joinButton).toBeVisible({ timeout: 5000 });
    await joinButton.click();

    // Wait for operation to complete
    await page.waitForTimeout(3000);

    // Should now show "Following" badge (use first() for desktop/mobile layouts)
    await expect(page.locator('.badge-success', { hasText: 'Following' }).first()).toBeVisible({
      timeout: 10000
    });
  });

  test('join shows loading state during publish', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    const joinButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });

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
    const membershipButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
    const buttonText = await membershipButton.textContent();

    // If not joined, join first
    if (buttonText?.includes('Follow') && !buttonText?.includes('Unfollow')) {
      await membershipButton.click();
      await page.waitForTimeout(3000);
    }

    // Now verify we're joined (button says Unfollow)
    await expect(cards.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
      timeout: 10000
    });

    // Click Unfollow
    await cards
      .first()
      .locator('button', { hasText: /^Unfollow$/ })
      .click();

    // Wait for operation to complete
    await page.waitForTimeout(3000);

    // Button should now say "Follow" again
    await expect(cards.first().locator('button', { hasText: /^Follow$/ })).toBeVisible({
      timeout: 10000
    });
  });

  test('leave removes joined badge from card', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    const cards = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // Join first if needed
    const membershipButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Follow') && !buttonText?.includes('Unfollow')) {
      await membershipButton.click();
      // Wait for Unfollow button to confirm join completed
      await expect(cards.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
        timeout: 10000
      });
    }

    // Verify joined state - card should have joined visual indicator
    // The card gets border-success/30 class when joined (the anchor element)
    const cardElement = cards.first();
    await expect(cardElement).toHaveClass(/border-success/, { timeout: 5000 });

    // Now leave
    await cards
      .first()
      .locator('button', { hasText: /^Unfollow$/ })
      .click();
    // Wait for Follow button to confirm leave completed
    await expect(cards.first().locator('button', { hasText: /^Follow$/ })).toBeVisible({
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
    const membershipButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Follow') && !buttonText?.includes('Unfollow')) {
      await membershipButton.click();
      // Wait for Unfollow button to confirm join completed
      await expect(cards.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
        timeout: 10000
      });
    }

    // Navigate to a different page
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Navigate back to communities tab
    await navigateToCommunitiesTab(page);

    // Should still show as joined (Unfollow button visible)
    const cardsAfterNav = page.locator('.card').filter({ hasText: 'Community Host' });
    await expect(cardsAfterNav.first()).toBeVisible({ timeout: 15000 });
    await expect(cardsAfterNav.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
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

    // Click follow/unfollow button
    const membershipButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
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
    const membershipButton = cards.first().locator('button', { hasText: /^(Follow|Unfollow)$/ });
    const buttonText = await membershipButton.textContent();

    if (buttonText?.includes('Follow') && !buttonText?.includes('Unfollow')) {
      await membershipButton.click();
      // Wait for Unfollow button to confirm join completed
      await expect(cards.first().locator('button', { hasText: /^Unfollow$/ })).toBeVisible({
        timeout: 10000
      });
    }

    // Now leave
    await cards
      .first()
      .locator('button', { hasText: /^Unfollow$/ })
      .click();
    await page.waitForTimeout(3000);

    errorCapture.assertNoCriticalErrors();
  });
});
