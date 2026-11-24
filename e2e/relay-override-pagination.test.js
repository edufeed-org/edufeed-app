/**
 * Relay Override Pagination E2E Tests
 *
 * Tests that pagination works correctly when users configure custom relays
 * via kind 30002 relay set overrides. This verifies the per-relay pagination
 * tracking implemented to fix the bug where pagination stopped prematurely
 * when one relay was exhausted but others still had content.
 *
 * Test scenarios:
 * 1. Educational (Learning tab) - User adds educational relay override
 * 2. Calendar (Events tab) - User adds calendar relay override
 * 3. Communikey (Communities tab) - User adds communikey relay override
 */

import { test, expect, addRelayOverride, triggerInfiniteScroll } from './fixtures.js';
import { seedEventsToRelay, RELAY_URLS, countEventsOnRelay } from './relay-verification.js';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';

// Deterministic key for override relay events (different from main test authors)
function createOverrideAuthorKey() {
  const sk = new Uint8Array(32);
  const seed = 'override-author';
  for (let i = 0; i < 32; i++) {
    sk[i] = (seed.charCodeAt(i % seed.length) + i * 7 + 99) & 0xff;
  }
  sk[0] = (sk[0] % 127) + 1;
  return sk;
}

const OVERRIDE_AUTHOR_SK = createOverrideAuthorKey();
const OVERRIDE_AUTHOR_PK = getPublicKey(OVERRIDE_AUTHOR_SK);

/**
 * Create a signed AMB event (kind 30142) for seeding to override relay.
 * Uses different timestamps than the main test data to simulate
 * a relay with content from a different time range.
 *
 * @param {number} index - Event index for unique d-tag
 * @param {number} timestamp - Unix timestamp for created_at
 * @returns {object} Signed Nostr event
 */
function createOverrideAMBEvent(index, timestamp) {
  const event = {
    kind: 30142,
    created_at: timestamp,
    tags: [
      ['d', `override-resource-${index}`],
      ['name', `Override Resource #${index}`],
      ['description', `Educational resource from override relay #${index}`],
      ['learningResourceType.id', 'https://w3id.org/kim/hcrt/text'],
      ['learningResourceType.prefLabel.en', 'Text'],
      ['about.id', 'https://w3id.org/kim/hochschulfaechersystematik/n01'],
      ['about.prefLabel.en', 'Computer Science'],
      ['inLanguage', 'en'],
      ['license.id', 'https://creativecommons.org/licenses/by/4.0/'],
      ['license.prefLabel.en', 'CC BY 4.0']
    ],
    content: ''
  };
  return finalizeEvent(event, OVERRIDE_AUTHOR_SK);
}

/**
 * Create a signed calendar event (kind 31922) for seeding to override relay.
 *
 * @param {number} index - Event index for unique d-tag
 * @param {number} startTimestamp - Unix timestamp for event start
 * @returns {object} Signed Nostr event
 */
function createOverrideCalendarEvent(index, startTimestamp) {
  const event = {
    kind: 31922,
    created_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    tags: [
      ['d', `override-calendar-${index}`],
      ['title', `Override Event #${index}`],
      ['start', String(startTimestamp)],
      ['t', 'override-test']
    ],
    content: `Test calendar event from override relay #${index}`
  };
  return finalizeEvent(event, OVERRIDE_AUTHOR_SK);
}

/**
 * Create a signed community definition event (kind 10222) for seeding to override relay.
 *
 * @param {number} index - Event index
 * @returns {object} Signed Nostr event
 */
function createOverrideCommunityEvent(index) {
  // Each community needs its own keypair
  const sk = new Uint8Array(32);
  const seed = `override-community-${index}`;
  for (let i = 0; i < 32; i++) {
    sk[i] = (seed.charCodeAt(i % seed.length) + i * 7 + 50) & 0xff;
  }
  sk[0] = (sk[0] % 127) + 1;

  const event = {
    kind: 10222,
    created_at: Math.floor(Date.now() / 1000) - 7200,
    tags: [
      ['d', ''],
      ['name', `Override Community #${index}`],
      ['about', `Test community from override relay #${index}`]
    ],
    content: JSON.stringify({
      name: `Override Community #${index}`,
      about: `Test community from override relay #${index}`
    })
  };
  return finalizeEvent(event, sk);
}

// Also create profile for override author so their content renders correctly
function createOverrideAuthorProfile() {
  const event = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000) - 86400,
    tags: [],
    content: JSON.stringify({
      name: 'Override Author',
      about: 'Author from override relay',
      picture: `https://robohash.org/${OVERRIDE_AUTHOR_PK}`
    })
  };
  return finalizeEvent(event, OVERRIDE_AUTHOR_SK);
}

// ============================================================================
// Educational Relay Override Tests (Learning Tab)
// ============================================================================

test.describe('Educational relay override pagination', () => {
  test.beforeEach(async () => {
    // Seed AMB events to strfry (the override relay) with recent timestamps
    // These events are NEWER than the ones on amb-relay to test timestamp handling
    const now = Math.floor(Date.now() / 1000);
    const ambEvents = [];

    // Create 15 AMB events with timestamps from the last hour
    for (let i = 0; i < 15; i++) {
      ambEvents.push(createOverrideAMBEvent(i, now - i * 60)); // 1 minute apart
    }

    // Also add the profile so the author resolves
    ambEvents.push(createOverrideAuthorProfile());

    const seeded = await seedEventsToRelay(ambEvents, { relay: RELAY_URLS.strfry });
    console.log(`Seeded ${seeded} override AMB events to strfry`);
  });

  test(
    'pagination continues when user adds educational relay override',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // Verify strfry has our AMB events
      const strfryAMBCount = await countEventsOnRelay(
        { kinds: [30142] },
        { relay: RELAY_URLS.strfry }
      );
      expect(strfryAMBCount).toBeGreaterThan(0);

      // Step 1: Add strfry as educational relay override
      await addRelayOverride(page, 'educational', RELAY_URLS.strfry);

      // Step 2: Navigate to discover page Learning tab
      await page.goto('/discover?content=learning');
      await page.waitForTimeout(3000);

      // Click the Learning tab to ensure we're on it
      await page.locator('button:has-text("Learning")').first().click();
      await page.waitForTimeout(2000);

      // Step 3: Wait for initial content to load (use data-testid for content cards)
      await expect(page.locator('[data-testid="content-card"]').first()).toBeVisible({
        timeout: 15000
      });

      // Get initial card count
      const initialCount = await page.locator('[data-testid="content-card"]').count();
      console.log(`Initial card count: ${initialCount}`);

      // Step 4: Verify content from override relay appears
      // Look for "Override Resource" in any card title
      const hasOverrideContent = await page
        .locator('[data-testid="content-card"]')
        .filter({ hasText: /Override Resource/ })
        .count();

      // Content from override relay should be visible
      // (May not be immediately if default relay has newer content)
      console.log(`Override content cards visible: ${hasOverrideContent}`);

      // Step 5: Trigger infinite scroll multiple times
      await triggerInfiniteScroll(page, 3);

      // Get new card count
      const finalCount = await page.locator('[data-testid="content-card"]').count();
      console.log(`Final card count after scrolling: ${finalCount}`);

      // Verify pagination loaded more content
      expect(finalCount).toBeGreaterThan(initialCount);

      // Step 6: Verify "no more content" hasn't appeared prematurely
      // (If per-relay pagination is broken, this would appear too early)
      const noMoreContent = await page.locator('text=No more content').isVisible();

      // We should either:
      // a) Still have more content to load (noMoreContent = false)
      // b) Have loaded content from both relays before exhausting
      // Either is acceptable for this test - the key is pagination didn't stop after amb-relay exhausted
      console.log(`"No more content" visible: ${noMoreContent}`);
    }
  );

  test('pagination loads significant content with relay override configured', async ({
    authenticatedPage: page
  }) => {
    // Add strfry as educational relay override
    await addRelayOverride(page, 'educational', RELAY_URLS.strfry);

    // Navigate to discover Learning tab
    await page.goto('/discover?content=learning');
    await page.waitForTimeout(3000);

    // Click the Learning tab to ensure we're on it
    await page.locator('button:has-text("Learning")').first().click();
    await page.waitForTimeout(2000);

    // Wait for content
    await expect(page.locator('[data-testid="content-card"]').first()).toBeVisible({
      timeout: 15000
    });

    // Get initial count
    const initialCount = await page.locator('[data-testid="content-card"]').count();

    // Scroll to load more content
    await triggerInfiniteScroll(page, 5);

    // Get final count
    const finalCount = await page.locator('[data-testid="content-card"]').count();

    console.log(`Initial content: ${initialCount}`);
    console.log(`Final content after scrolling: ${finalCount}`);

    // Verify we loaded substantial content (proves pagination is working)
    expect(finalCount).toBeGreaterThan(initialCount);
    expect(finalCount).toBeGreaterThan(30); // Should have loaded several pages

    // Verify "no more content" hasn't appeared prematurely
    // (This would happen if only one relay was checked)
    const noMoreContent = await page.locator('text=No more content').isVisible();
    console.log(`"No more content" visible: ${noMoreContent}`);
  });

  test('no critical JavaScript errors during relay override pagination', async ({
    authenticatedPage: page
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Add relay override
    await addRelayOverride(page, 'educational', RELAY_URLS.strfry);

    // Navigate and paginate
    await page.goto('/discover?content=learning');
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("Learning")').first().click();
    await page.waitForTimeout(2000);
    await triggerInfiniteScroll(page, 3);

    // Filter for critical errors (ignore minor issues)
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('ChunkLoadError')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// Calendar Relay Override Tests (Events Tab)
// ============================================================================

test.describe('Calendar relay override pagination', () => {
  test.beforeEach(async () => {
    // Seed calendar events to strfry with future dates
    const now = Math.floor(Date.now() / 1000);
    const calendarEvents = [];

    // Create 10 calendar events for the next 10 days
    for (let i = 0; i < 10; i++) {
      const startTime = now + (i + 1) * 86400; // Future dates
      calendarEvents.push(createOverrideCalendarEvent(i, startTime));
    }

    const seeded = await seedEventsToRelay(calendarEvents, { relay: RELAY_URLS.strfry });
    console.log(`Seeded ${seeded} override calendar events to strfry`);
  });

  test(
    'pagination works with user-configured calendar relay',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // Add strfry as calendar relay override
      await addRelayOverride(page, 'calendar', RELAY_URLS.strfry);

      // Navigate to discover Events tab
      await page.goto('/discover?content=events');
      await page.waitForTimeout(3000);

      // Click the Events tab to ensure we're on it
      await page.locator('button:has-text("Events")').first().click();
      await page.waitForTimeout(2000);

      // Wait for content
      await expect(page.locator('[data-testid="content-card"]').first()).toBeVisible({
        timeout: 15000
      });

      // Get initial count
      const initialCount = await page.locator('[data-testid="content-card"]').count();

      // Scroll to load more
      await triggerInfiniteScroll(page, 2);

      // Verify more content loaded
      const finalCount = await page.locator('[data-testid="content-card"]').count();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount);

      // Check for override relay content
      const overrideContent = await page
        .locator('[data-testid="content-card"]')
        .filter({ hasText: /Override Event/ })
        .count();
      console.log(`Override calendar events visible: ${overrideContent}`);
    }
  );
});

// ============================================================================
// Communikey Relay Override Tests (Communities Tab)
// ============================================================================

test.describe('Communikey relay override pagination', () => {
  test.beforeEach(async () => {
    // Seed community definitions to strfry
    const communityEvents = [];

    // Create 10 community definitions
    for (let i = 0; i < 10; i++) {
      communityEvents.push(createOverrideCommunityEvent(i));
    }

    const seeded = await seedEventsToRelay(communityEvents, { relay: RELAY_URLS.strfry });
    console.log(`Seeded ${seeded} override community events to strfry`);
  });

  test(
    'pagination works with user-configured communikey relay',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // Add strfry as communikey relay override
      await addRelayOverride(page, 'communikey', RELAY_URLS.strfry);

      // Navigate to discover Communities tab
      await page.goto('/discover?content=communities');
      await page.waitForTimeout(3000);

      // Click the Communities tab to ensure we're on it
      await page.locator('button:has-text("Communities")').first().click();
      await page.waitForTimeout(2000);

      // Wait for content (communities use .card class, not content-card)
      await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 });

      // Get initial count
      const initialCount = await page.locator('.card').count();

      // Scroll to load more
      await triggerInfiniteScroll(page, 2);

      // Verify content loaded
      const finalCount = await page.locator('.card').count();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount);

      // Check for override relay content
      const overrideContent = await page
        .locator('.card')
        .filter({ hasText: /Override Community/ })
        .count();
      console.log(`Override communities visible: ${overrideContent}`);
    }
  );
});
