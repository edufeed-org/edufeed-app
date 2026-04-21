import { test, expect } from '@playwright/test';
import { waitForCalendarEvents, setupErrorCapture } from './test-utils.js';

test.describe('Calendar event details modal - EventContextMenu', () => {
  /**
   * Helper: open the calendar details modal by clicking the first calendar event.
   * Returns the modal locator.
   */
  async function openFirstEventModal(page) {
    await page.goto('/calendar');
    await waitForCalendarEvents(page, { timeout: 30_000 });

    // Click first event (grid view uses .calendar-event-bar, list uses testid)
    const gridEvent = page.locator('.calendar-event-bar').first();
    const cardEvent = page.locator('[data-testid="calendar-event-card"]').first();
    const firstEvent = gridEvent.or(cardEvent);
    await expect(firstEvent).toBeVisible({ timeout: 10_000 });
    await firstEvent.click();

    // Wait for modal to open
    const modal = page.locator('dialog#event-details-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    return modal;
  }

  test('three-dots context menu button is visible in modal', async ({ page }) => {
    const modal = await openFirstEventModal(page);

    // The EventContextMenu renders a button with aria-label="Event menu"
    const menuButton = modal.locator('button[aria-label="Event menu"]');
    await expect(menuButton).toBeVisible({ timeout: 5_000 });
  });

  test('clicking context menu button opens dropdown with options', async ({ page }) => {
    const modal = await openFirstEventModal(page);

    // Click the three-dots menu button
    const menuButton = modal.locator('button[aria-label="Event menu"]');
    await expect(menuButton).toBeVisible({ timeout: 5_000 });
    await menuButton.click();

    // Verify dropdown menu appears with expected options
    const dropdown = modal.locator('.dropdown-content');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // Check for the three standard menu items
    await expect(dropdown.getByText('Copy event ID')).toBeVisible();
    await expect(dropdown.getByText('Copy share link')).toBeVisible();
    await expect(dropdown.getByText('View raw event')).toBeVisible();
  });

  test('view raw event opens raw event dialog', async ({ page }) => {
    const modal = await openFirstEventModal(page);

    // Open the context menu
    const menuButton = modal.locator('button[aria-label="Event menu"]');
    await menuButton.click();

    // Click "View raw event"
    const dropdown = modal.locator('.dropdown-content');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await dropdown.getByText('View raw event').click();

    // The raw event dialog should open with JSON content
    // Use the nested dialog inside the event-details-modal (the EventContextMenu's raw event dialog)
    const rawDialog = page.locator('dialog#event-details-modal dialog.modal');
    await expect(rawDialog).toBeVisible({ timeout: 5_000 });

    // Should contain valid JSON with standard Nostr event fields
    const preContent = await rawDialog.locator('pre').textContent();
    expect(preContent).toContain('"kind"');
    expect(preContent).toContain('"pubkey"');
    expect(preContent).toContain('"tags"');
  });

  test('no critical JavaScript errors when using context menu', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    const modal = await openFirstEventModal(page);

    // Open and interact with the context menu
    const menuButton = modal.locator('button[aria-label="Event menu"]');
    await menuButton.click();

    const dropdown = modal.locator('.dropdown-content');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    errorCapture.assertNoCriticalErrors();
  });
});
