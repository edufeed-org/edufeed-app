import { test, expect } from '@playwright/test';
import { waitForCalendarEvents, setupErrorCapture } from './test-utils.js';

test.describe('Calendar page chrome', () => {
  test('footer is visible at the bottom of /calendar', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('footer').first()).toBeVisible();
  });

  test('page uses min-h-screen wrapper (not a card)', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    // The new page wrapper (replacing the old island card) is min-h-screen bg-base-100.
    await expect(page.locator('div.min-h-screen.bg-base-100').first()).toBeVisible();
    // The old outer `flex w-full max-w-full` sidebar+content wrapper is gone.
    await expect(page.locator('div.flex.w-full.max-w-full')).toHaveCount(0);
  });

  test('desktop inline filter bar is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);
    // The redesigned bar exposes the Search input inline (not a dropdown)
    // plus Tags, People, and Advanced dropdown triggers.
    await expect(page.locator('[data-testid="calendar-search-input"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="people-filter-trigger"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="advanced-filters-trigger"]').first()).toBeVisible();
    // Tags still renders via data-filter-trigger; at least one dropdown trigger.
    expect(await page.locator('[data-filter-trigger]').count()).toBeGreaterThanOrEqual(3);
  });

  test('search input is always visible and typing publishes a chip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const searchWrap = page.locator('[data-testid="calendar-search-input"]').first();
    await expect(searchWrap).toBeVisible();
    const input = searchWrap.locator('input[type="search"]');
    await input.click();
    await input.fill('test');

    // Debounce is 300ms; wait a tick, then assert search chip is visible.
    const searchChip = page.locator('[data-testid="chip-search"]').first();
    await expect(searchChip).toBeVisible({ timeout: 5_000 });

    // Removing the chip clears the search.
    await searchChip.getByRole('button').click();
    await expect(searchChip).toHaveCount(0);
  });
});

test.describe('Event card author', () => {
  test('list-view cards show an author profile link', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Author header renders inside non-compact list-view cards (CalendarEventsList).
    // ProfileAvatar with linkToProfile wraps the avatar in <a href="/p/{pubkey}">.
    // We poll because the profile event may arrive shortly after the card itself.
    const authorLink = page.locator('[data-testid="calendar-event-card"] a[href^="/p/"]').first();
    await expect(authorLink).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Active filter chips', () => {
  test('Clear all removes chips', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Publish a search query via the input.
    const input = page.locator('[data-testid="calendar-search-input"] input[type="search"]');
    await input.fill('foo');

    const chip = page.locator('[data-testid="chip-search"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });

    // Chip strip's "Clear all" removes every chip.
    await page.locator('[data-testid="chip-clear-all"]').first().click();
    await expect(chip).toHaveCount(0);
  });

  test('calendar dropdown and filter triggers share the same row on lg+', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const calendarTrigger = page.locator('[popovertarget="calendar-popover"]').first();
    const firstFilterTrigger = page.locator('[data-filter-trigger]').first();

    await expect(calendarTrigger).toBeVisible();
    await expect(firstFilterTrigger).toBeVisible();

    const calBox = await calendarTrigger.boundingBox();
    const filterBox = await firstFilterTrigger.boundingBox();
    expect(calBox).not.toBeNull();
    expect(filterBox).not.toBeNull();
    // Single-row layout: the two triggers share the same top (±4px for button padding differences).
    expect(Math.abs((calBox?.y ?? 0) - (filterBox?.y ?? 0))).toBeLessThanOrEqual(4);
  });
});

test.describe('Advanced (relay) filter behavior', () => {
  test('opening Advanced and ticking a relay renders a relay chip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Open the Advanced dropdown (hosts the relay selector in the redesign).
    const advancedTrigger = page.locator('[data-testid="advanced-filters-trigger"]').first();
    await expect(advancedTrigger).toBeVisible();
    await advancedTrigger.click();

    const panel = page.locator('[data-testid="advanced-filters-panel"]').first();
    await expect(panel).toBeVisible();

    // Tick the first relay checkbox inside the panel; skip if none available.
    const checkboxes = panel.locator('input.checkbox[type="checkbox"]');
    const count = await checkboxes.count();
    if (count === 0) {
      test.skip(true, 'No default calendar relays configured');
      return;
    }
    await checkboxes.first().check();

    // Auto-applies — a relay chip appears in the active filter strip.
    const relayChip = page.locator('[data-testid="chip-relay"]').first();
    await expect(relayChip).toBeVisible({ timeout: 5_000 });

    // Trigger badge also reflects the active count.
    const badge = advancedTrigger.locator('[data-filter-count]').first();
    await expect(badge).toBeVisible();
  });

  test('ticking a relay keeps events visible (regression: wrapper vs raw)', async ({ page }) => {
    // Regression for the bug where getSeenRelays was called on the
    // CalendarEvent wrapper instead of its originalEvent, making every
    // event disappear as soon as any relay checkbox was ticked.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const beforeCards = await page.locator('[data-testid="calendar-event-card"]').count();
    expect(beforeCards).toBeGreaterThan(0);

    const advancedTrigger = page.locator('[data-testid="advanced-filters-trigger"]').first();
    await advancedTrigger.click();
    const panel = page.locator('[data-testid="advanced-filters-panel"]').first();
    await expect(panel).toBeVisible();

    const checkboxes = panel.locator('input.checkbox[type="checkbox"]');
    if ((await checkboxes.count()) === 0) {
      test.skip(true, 'No default calendar relays configured');
      return;
    }
    await checkboxes.first().check();
    await expect(page.locator('[data-testid="chip-relay"]').first()).toBeVisible({
      timeout: 5_000
    });

    // After ticking a relay, at least one event card must remain rendered.
    // Previously every card vanished.
    const afterCards = page.locator('[data-testid="calendar-event-card"]');
    await expect.poll(async () => afterCards.count(), { timeout: 5_000 }).toBeGreaterThan(0);
  });
});

test.describe('Header event count vs rendered list', () => {
  test('header count matches rendered card count in day view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Switch to Day view. The button label comes from i18n; match by role+text
    // of the known english/german variants.
    const dayButton = page.getByRole('button', { name: /^(Day|Tag)$/ }).first();
    await dayButton.click();

    // Read header event count from CalendarNavigation ("· N Events").
    const headerText = await page.locator('text=/·\\s+\\d+\\s+Events/').first().textContent();
    const match = headerText?.match(/·\s+(\d+)\s+Events/);
    expect(match).not.toBeNull();
    const headerCount = Number(match?.[1] ?? 0);

    // Count rendered event cards (upcoming + past sections are both in the DOM).
    const renderedCards = await page.locator('[data-testid="calendar-event-card"]').count();

    expect(headerCount).toBe(renderedCards);
  });
});

test.describe('Mobile filter drawer', () => {
  test('small viewport shows Filter button that opens the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Filter button appears only on lg:hidden, in the header row
    const filterBtn = page.getByRole('button', { name: /^Filter(\s|$|\()/ }).first();
    await expect(filterBtn).toBeVisible();
    await filterBtn.click();

    // Drawer has role="dialog" with aria-labelledby="filter-drawer-title"
    const drawer = page.getByRole('dialog', { name: /Filter/ });
    await expect(drawer).toBeVisible();

    // Close via Escape (window-level keydown listener in the drawer)
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
  });

  test('no critical JavaScript errors on mobile drawer flow', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const filterBtn = page.getByRole('button', { name: /^Filter(\s|$|\()/ }).first();
    await filterBtn.click();
    await page.keyboard.press('Escape');

    errorCapture.assertNoCriticalErrors();
  });
});

test.describe('Featured Authors rail', () => {
  test('rail is present only when CALENDAR_FEATURED_AUTHORS is configured', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    const rail = page.locator('[data-testid="featured-authors"]').first();
    const count = await rail.count();
    if (count === 0) {
      test.skip(true, 'CALENDAR_FEATURED_AUTHORS is empty in this env');
      return;
    }
    await expect(rail).toBeVisible();
  });
});
