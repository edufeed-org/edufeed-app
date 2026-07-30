/**
 * E2E tests for calendar event creation flow.
 *
 * Tests the FAB, modal, event creation, and deletion flows.
 * All tests require authentication.
 */
import { test, expect, openEventCreationModal, FAB_TRIGGER } from './fixtures.js';
import { setupErrorCapture, waitForEventDetail } from './test-utils.js';

// ============================================================================
// FAB and Modal UI Tests
// ============================================================================

test.describe('Calendar Event Creation - FAB and Modal UI', () => {
  test('FAB is visible on calendar page for authenticated user', async ({
    authenticatedPage: page
  }) => {
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // FAB should be visible
    await expect(page.locator(FAB_TRIGGER)).toBeVisible();
  });

  test('clicking Create Event opens modal', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Modal should be visible with form
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible();

    // Should have title input
    await expect(page.locator('#title')).toBeVisible();

    // Should have start date input
    await expect(page.locator('#startDate')).toBeVisible();

    // Should have submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('modal closes on close button click', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Modal should be visible
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible();

    // Click the close button (X button in header)
    await page.locator('.modal-box button.btn-circle.btn-ghost').click();

    // Modal should close
    await expect(page.locator('dialog[open] .modal-box')).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// Event Creation - Happy Path Tests
// ============================================================================

test.describe('Calendar Event Creation - Happy Path', () => {
  test('can create all-day event with required fields', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Generate a unique title
    const eventTitle = `Test All-Day Event ${Date.now()}`;

    // Fill in title
    await page.locator('#title').fill(eventTitle);

    // Start date should already be prefilled with today, but let's ensure it
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);

    // Click submit
    await page.locator('button[type="submit"]').click();

    // Wait for navigation to event detail page
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });

    // Verify we're on the event detail page
    expect(page.url()).toContain('/calendar/event/naddr1');

    // Wait for event detail to load
    await waitForEventDetail(page);

    // The event title should be visible in the h1 heading
    await expect(page.locator('h1').filter({ hasText: eventTitle })).toBeVisible({
      timeout: 10000
    });
  });

  test('can create timed event with start and end times', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Generate a unique title
    const eventTitle = `Test Timed Event ${Date.now()}`;

    // Click "Timed" event type (second button in the group)
    await page.locator('.modal-box button:has-text("Timed")').click();

    // Fill in title
    await page.locator('#title').fill(eventTitle);

    // Set start date and time
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);
    await page.locator('#startTime').fill('14:00');

    // Set end time (optional but let's fill it)
    await page.locator('#endTime').fill('16:00');

    // Click submit
    await page.locator('button[type="submit"]').click();

    // Wait for navigation to event detail page
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });

    // Wait for event detail to load
    await waitForEventDetail(page);

    // The event title should be visible in the h1 heading
    await expect(page.locator('h1').filter({ hasText: eventTitle })).toBeVisible({
      timeout: 10000
    });
  });

  test('created event shows title and metadata on detail page', async ({
    authenticatedPage: page
  }) => {
    await openEventCreationModal(page);

    // Generate a unique title and add optional fields
    const eventTitle = `Detailed Event ${Date.now()}`;
    const eventSummary = 'This is a test event description for E2E testing.';

    // Fill in title
    await page.locator('#title').fill(eventTitle);

    // Fill in summary/description
    await page.locator('#summary').fill(eventSummary);

    // Use today's date
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);

    // Click submit
    await page.locator('button[type="submit"]').click();

    // Wait for navigation to event detail page
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });

    // Wait for event detail to load
    await waitForEventDetail(page);

    // Verify title is visible
    await expect(page.locator('h1').filter({ hasText: eventTitle })).toBeVisible({
      timeout: 10000
    });

    // Scoped to the description card rather than a bare getByText: the summary
    // is rendered through MarkdownRenderer, so the wrapper and the paragraph it
    // produces both contain the text and a page-wide getByText resolves to two
    // elements. Anchoring on the card also makes the assertion say what it
    // means — the summary is in the description card, not merely on the page.
    // See CalendarEventDetailView.svelte:218-224.
    const descriptionCard = page.locator('.card-body').filter({ hasText: eventSummary });
    await expect(descriptionCard).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Form Validation Tests
// ============================================================================

test.describe('Calendar Event Creation - Form Validation', () => {
  test('shows error when submitting without title', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Clear the title field to ensure it's empty
    await page.locator('#title').clear();

    // Click submit without filling title
    await page.locator('button[type="submit"]').click();

    // Wait a moment for validation
    await page.waitForTimeout(500);

    // Either validation error appears or we stay on the modal (HTML5 validation)
    const modalStillOpen = await page.locator('dialog[open] .modal-box').isVisible();
    const validationError = await page.locator('.alert-error').isVisible();

    // One of these should be true
    expect(modalStillOpen || validationError).toBe(true);

    // URL should NOT have changed (no navigation)
    expect(page.url()).toContain('/calendar');
    expect(page.url()).not.toContain('/calendar/event/naddr1');
  });

  test('shows error when submitting without start date', async ({ authenticatedPage: page }) => {
    await openEventCreationModal(page);

    // Fill in title
    await page.locator('#title').fill('Test Event');

    // Clear the start date
    await page.locator('#startDate').evaluate((el) => {
      /** @type {HTMLInputElement} */ (el).value = '';
    });

    // Click submit
    await page.locator('button[type="submit"]').click();

    // Wait a moment
    await page.waitForTimeout(500);

    // Modal should still be open (validation failed)
    const modalStillOpen = await page.locator('dialog[open] .modal-box').isVisible();
    const validationError = await page.locator('.alert-error').isVisible();

    expect(modalStillOpen || validationError).toBe(true);

    // URL should NOT have changed
    expect(page.url()).not.toContain('/calendar/event/naddr1');
  });
});

// ============================================================================
// Event Deletion Test
// ============================================================================

test.describe('Calendar Event Creation - Deletion', () => {
  test('authenticated user can delete own event', async ({ authenticatedPage: page }) => {
    // First create an event
    await openEventCreationModal(page);

    const eventTitle = `Delete Me Event ${Date.now()}`;
    await page.locator('#title').fill(eventTitle);
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);
    await page.locator('button[type="submit"]').click();

    // Wait for navigation to event detail
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });
    await waitForEventDetail(page);

    // Open the event context menu. The detail page routes through
    // CalendarEventDetailView -> DetailHeader -> EventContextMenu, whose trigger
    // is aria-label="Event menu". The old "Manage event" button still exists but
    // only inside CalendarEventDetailsModal, which this page does not render.
    const menuButton = page.locator('button[aria-label="Event menu"]');
    await expect(menuButton).toBeVisible({ timeout: 5000 });
    await menuButton.click();

    // Wait for dropdown to open
    await page.waitForTimeout(300);

    // Click "Delete" in the dropdown. EventContextMenu labels the item with
    // m.common_delete() — 'Delete', not the old 'Delete Event'. The *confirmation*
    // dialog below still reads 'Delete Event?' (event_management_delete_confirm_title).
    const deleteOption = page
      .locator('.dropdown-content button')
      .filter({ hasText: /^\s*Delete\s*$/ });
    await expect(deleteOption).toBeVisible();
    await deleteOption.click();

    // Wait for confirmation modal (still uses div-based pattern, not dialog)
    await expect(page.locator('.modal-open .modal-box h3')).toHaveText('Delete Event?', {
      timeout: 5000
    });

    // Click the "Delete Event" confirmation button
    await page.locator('.modal-open .modal-box button.btn-error').click();

    // Wait for deletion to process and redirect
    await page.waitForTimeout(3000);

    // Should be redirected away from the event page (e.g., to /calendar)
    expect(page.url()).not.toContain('/calendar/event/');
  });
});

// ============================================================================
// Error Handling Test
// ============================================================================

test.describe('Calendar Event Creation - Error Handling', () => {
  test('no critical JavaScript errors during event creation flow', async ({
    authenticatedPage: page
  }) => {
    const errorCapture = setupErrorCapture(page);

    // Open modal
    await openEventCreationModal(page);

    // Fill form
    const eventTitle = `Error Test Event ${Date.now()}`;
    await page.locator('#title').fill(eventTitle);
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);

    // Submit
    await page.locator('button[type="submit"]').click();

    // Wait for navigation
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });

    // Wait for page to stabilize
    await page.waitForTimeout(2000);

    // Assert no critical errors
    errorCapture.assertNoCriticalErrors();
  });
});
