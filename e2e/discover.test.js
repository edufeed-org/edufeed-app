import { test, expect } from '@playwright/test';
import {
  waitForContent,
  getCardCount,
  triggerInfiniteScroll,
  setupErrorCapture
} from './test-utils.js';

test.describe('Discover page - infinite scroll', () => {
  test('All tab: loads initial content', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    const count = await getCardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('All tab: infinite scroll loads more content', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    const initialCount = await getCardCount(page);

    await triggerInfiniteScroll(page);

    // Retry until count increases
    await expect(async () => {
      const newCount = await getCardCount(page);
      expect(newCount).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 15_000 });
  });

  test('Events tab: loads calendar events for date range', async ({ page }) => {
    // Note: Events tab uses date range filtering, not infinite scroll pagination.
    // The loader fetches ALL events within the selected date range at once.
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-events"]').click();
    await page.waitForTimeout(500);

    // Wait for calendar event cards
    await expect(page.locator('[data-testid="calendar-event-card"]').first()).toBeVisible({
      timeout: 15_000
    });

    const count = await getCardCount(page);
    expect(count).toBeGreaterThan(0);

    // No articles or AMB should be visible
    expect(await page.locator('.article-card').count()).toBe(0);
    expect(await page.locator('.amb-card').count()).toBe(0);
  });

  test('Learning tab: loads AMB resources and supports infinite scroll', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-learning"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('.amb-card').first()).toBeVisible({ timeout: 15_000 });

    const initialCount = await getCardCount(page);
    expect(initialCount).toBeGreaterThan(0);

    // AMB pagination needs timedPool (3s) + processing time per batch.
    // Retry until count increases - combining scrolls with assertion retries.
    await expect(async () => {
      await triggerInfiniteScroll(page);
      const newCount = await getCardCount(page);
      expect(newCount).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 15_000 });
  });

  test('Articles tab: loads articles and supports infinite scroll', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-articles"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('.article-card').first()).toBeVisible({ timeout: 15_000 });

    const initialCount = await getCardCount(page);
    expect(initialCount).toBeGreaterThan(0);

    // No calendar events or AMB should be visible
    expect(await page.locator('[data-testid="calendar-event-card"]').count()).toBe(0);
    expect(await page.locator('.amb-card').count()).toBe(0);

    await triggerInfiniteScroll(page);

    await expect(async () => {
      const newCount = await getCardCount(page);
      expect(newCount).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 15_000 });
  });

  test('tab switching displays correct content types', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    // Switch to Events
    await page.locator('[data-testid="tab-events"]').click();
    await expect(page.locator('[data-testid="calendar-event-card"]').first()).toBeVisible({
      timeout: 15_000
    });
    expect(await page.locator('.article-card').count()).toBe(0);
    expect(await page.locator('.amb-card').count()).toBe(0);

    // Switch to Articles
    await page.locator('[data-testid="tab-articles"]').click();
    await expect(page.locator('.article-card').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('[data-testid="calendar-event-card"]').count()).toBe(0);
    expect(await page.locator('.amb-card').count()).toBe(0);

    // Switch to Learning
    await page.locator('[data-testid="tab-learning"]').click();
    await expect(page.locator('.amb-card').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.article-card').count()).toBe(0);
    expect(await page.locator('[data-testid="calendar-event-card"]').count()).toBe(0);

    // Switch back to All - should have mixed content
    await page.locator('[data-testid="tab-all"]').click();
    await page.waitForTimeout(1000);
    const total = await getCardCount(page);
    expect(total).toBeGreaterThan(0);
  });

  test('Learning tab: no loading flicker during infinite scroll', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-learning"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.amb-card').first()).toBeVisible({ timeout: 15_000 });

    // Inject a counter that tracks how many times the loading spinner appears
    await page.evaluate(() => {
      window.__loadingFlickerCount = 0;
      const sentinel = document.getElementById('load-more-sentinel');
      const observer = new MutationObserver(() => {
        if (sentinel.querySelector('.loading-spinner')) {
          window.__loadingFlickerCount++;
        }
      });
      observer.observe(sentinel, { childList: true, subtree: true });
    });

    // Trigger one scroll
    await triggerInfiniteScroll(page);

    const flickerCount = await page.evaluate(() => window.__loadingFlickerCount);
    // The spinner may appear once per batch (50 AMB / 20 batch = 3 batches).
    // The original flicker bug caused rapid toggling within a single batch (10+).
    expect(flickerCount).toBeLessThanOrEqual(5);
  });

  test('Articles tab: shows "no more content" after all items loaded', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-articles"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.article-card').first()).toBeVisible({ timeout: 15_000 });

    // Scroll repeatedly until all content is exhausted (50 articles / 20 batch = 3 scrolls)
    // Each scroll needs timedPool (2s) + buffer to complete
    for (let i = 0; i < 6; i++) {
      const sentinel = page.locator('#load-more-sentinel');
      await sentinel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(4000);
    }

    // "No more content to load" should be visible - wait longer for final pagination to complete
    await expect(page.getByText('No more content to load')).toBeVisible({ timeout: 15_000 });
  });

  test('Learning tab: spinner stops after all content loaded', async ({ page }) => {
    // This test exercises the hanging relay (sends events but never EOSE for kind 30142).
    // Without the timedPool fix, the spinner spins forever.
    test.slow(); // Mark as slow test (3x default timeout)
    test.setTimeout(180_000);

    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-learning"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.amb-card').first()).toBeVisible({ timeout: 15_000 });

    // Scroll repeatedly to trigger loading
    // Each scroll needs timedPool (2s) + buffer to complete
    for (let i = 0; i < 10; i++) {
      await page.locator('#load-more-sentinel').scrollIntoViewIfNeeded();
      await page.waitForTimeout(4000);
    }

    // "No more content" must appear — proves the spinner stops
    await expect(page.getByText('No more content to load')).toBeVisible({ timeout: 45_000 });
  });

  test('page loads without critical JavaScript errors', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto('/discover');
    await waitForContent(page);

    errorCapture.assertNoCriticalErrors();
  });

  test('Learning tab: shows author profile names on resource cards', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-learning"]').click();
    await expect(page.locator('.amb-card').first()).toBeVisible({ timeout: 15_000 });

    // Wait for profiles to load asynchronously via useProfileMap
    // Profiles resolve via EventStore batching (bufferTime ~1000ms)
    await expect(async () => {
      // Author names of the rendered cards (card variant)
      const authorLines = await page.locator('[data-testid="amb-card-author"]').allTextContents();
      // At least one card should show a resolved profile name (not a truncated pubkey)
      // Test data uses "Test Author X" naming convention
      const hasProfileName = authorLines.some((line) => line.includes('Test Author'));
      expect(hasProfileName).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe('Discover page - search input stays put while typing', () => {
  // Regression: typing into the search field syncs the query to the URL
  // (`?search=…`, a replaceState goto). The root layout's scroll restore
  // treated that as a fresh navigation and reset <main> to the top, which on
  // a small viewport (iPhone with the keyboard open) scrolled the field out
  // of view mid-word and lost the focus. Logged-out: the hero sits above the
  // field, so the field is only reachable by scrolling.
  test('typing a query keeps <main> scroll position and input focus', async ({ page }) => {
    // Height like an iPhone viewport with the software keyboard open.
    await page.setViewportSize({ width: 390, height: 420 });
    await page.goto('/discover');

    const input = page.getByRole('textbox', { name: /suche|search/i }).first();
    await expect(input).toBeVisible();

    // Bring the field to the top of the scroll surface, like Safari does when
    // the keyboard opens on a focused field below the fold.
    const scrollBefore = await page.evaluate(() => {
      const main = document.querySelector('main');
      const field = document.querySelector('main input[type="text"]');
      if (!main || !field) throw new Error('no <main> or search input');
      main.scrollTop = field.getBoundingClientRect().top + main.scrollTop - 16;
      return main.scrollTop;
    });
    expect(scrollBefore).toBeGreaterThan(50);

    await input.click();
    await input.pressSequentially('Co', { delay: 50 });

    // The debounced query sync must have reached the URL …
    await expect(page).toHaveURL(/search=Co/);
    // … and the layout's restore loop (≤ 30 frames) must have run its course.
    await page.waitForTimeout(700);

    const after = await page.evaluate(() => {
      const main = document.querySelector('main');
      const field = document.querySelector('main input[type="text"]');
      const rect = field?.getBoundingClientRect();
      return {
        scrollTop: main?.scrollTop ?? -1,
        focused: document.activeElement === field,
        value: /** @type {HTMLInputElement | null} */ (field)?.value,
        onScreen: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight
      };
    });
    expect(after.value).toBe('Co');
    expect(after.focused, 'search input must keep the focus').toBe(true);
    expect(after.onScreen, 'search input must stay in view').toBe(true);
    // The filtered result list is shorter, so <main> may clamp a bit lower
    // than before; the bug reset it to the hero at the very top (0).
    expect(after.scrollTop, '<main> must not jump to the top').toBeGreaterThan(100);
  });
});

test.describe('Discover page - tab switch resets the search', () => {
  test('a search typed on one tab does not follow the user to the next tab', async ({ page }) => {
    await page.goto('/discover');
    await waitForContent(page);

    await page.locator('[data-testid="tab-learning"]').click();
    const input = page.getByRole('textbox', { name: /suche|search/i }).first();
    await input.fill('Mathe');
    await expect(page).toHaveURL(/search=Mathe/, { timeout: 5_000 });

    await page.locator('[data-testid="tab-communities"]').click();
    await expect(page).toHaveURL(/type=communities/);
    // The two URL writes used to race and copy the stale search back
    await expect(page).not.toHaveURL(/search=/);
    await expect(input).toHaveValue('');
  });
});
