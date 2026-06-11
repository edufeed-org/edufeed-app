import { test, expect } from '@playwright/test';
import { waitForCalendarEvents, setupErrorCapture } from './test-utils.js';

test.describe('Calendar page', () => {
  test('loads and displays calendar events', async ({ page }) => {
    await page.goto('/calendar');

    // Wait for the CalendarView component to render
    await expect(page.locator('.container').first()).toBeVisible({ timeout: 15_000 });

    // Wait for calendar events to load from mock relay
    await waitForCalendarEvents(page, { timeout: 30_000 });

    // Calendar should have rendered some content (grid cells, event items, etc.)
    // Check for the page title
    await expect(page).toHaveTitle(/Calendar/);
  });

  test('calendar events contain expected metadata', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page, { timeout: 30_000 });

    // The page should contain event titles from our test data
    // Test data generates titles like "Date Event: Mathematics Workshop #0"
    // and "Time Event: Mathematics Lecture #0"
    const pageContent = await page.textContent('body');
    const hasCalendarContent =
      pageContent.includes('Workshop') ||
      pageContent.includes('Lecture') ||
      pageContent.includes('Event');
    expect(hasCalendarContent).toBe(true);
  });

  test('no critical JavaScript errors', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    errorCapture.assertNoCriticalErrors();
  });

  test('clicking calendar event opens details modal', async ({ page }) => {
    await page.goto('/calendar');
    await waitForCalendarEvents(page);

    // Click first event (grid view uses .calendar-event-bar, list uses testid)
    const gridEvent = page.locator('.calendar-event-bar').first();
    const cardEvent = page.locator('[data-testid="calendar-event-card"]').first();
    const firstEvent = gridEvent.or(cardEvent);
    await expect(firstEvent).toBeVisible({ timeout: 10000 });
    await firstEvent.click();

    // Verify modal opens
    await expect(page.locator('dialog#event-details-modal')).toBeVisible({ timeout: 5000 });

    // Verify modal contains any test event title (Workshop, Lecture, Conference, etc.)
    // Event ordering varies based on date, so accept any valid test event
    await expect(page.locator('dialog#event-details-modal h2')).toContainText(
      /Workshop|Lecture|Conference|Seminar|Exhibition|Event/
    );

    // Close modal via close button
    await page.locator('dialog#event-details-modal button.btn-outline').click();
    await expect(page.locator('dialog#event-details-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test('view toggle buttons switch URL and render matching view', async ({ page }) => {
    // Locks in Bug 1: clicking Grid used to strip `view` from the URL, which
    // the loader then defaulted back to 'list'. All three buttons must set
    // the URL param explicitly.
    await page.goto('/calendar?view=calendar');
    await waitForCalendarEvents(page);

    const gridBtn = page.locator('button[title="Calendar Grid View"]:visible').first();
    const listBtn = page.locator('button[title="List View"]:visible').first();
    const mapBtn = page.locator('button[title="Map View"]:visible').first();

    // Grid: URL carries ?view=calendar and event bars render.
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.locator('.calendar-event-bar').first()).toBeVisible({ timeout: 10_000 });

    // Click List → URL updates, list cards render.
    await listBtn.click();
    await expect(page).toHaveURL(/view=list/, { timeout: 5000 });
    await expect(page.locator('[data-testid="calendar-event-card"]').first()).toBeVisible({
      timeout: 10_000
    });

    // Click Map → URL updates. The mock-relay test fixtures have no location
    // data, so the map renders its empty-state card rather than a canvas; we
    // only assert the URL switch here (Bug 1 scope). Canvas rendering and
    // pin persistence are verified against real data via a dev-server probe.
    await mapBtn.click();
    await expect(page).toHaveURL(/view=map/, { timeout: 5000 });

    // Click Grid → URL returns to calendar. This is the exact path that used
    // to silently fall through to the 'list' default.
    await gridBtn.click();
    await expect(page).toHaveURL(/view=calendar/, { timeout: 5000 });
    await expect(page.locator('.calendar-event-bar').first()).toBeVisible({ timeout: 10_000 });
  });
});
