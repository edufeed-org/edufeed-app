/**
 * E2E tests for calendar event editing flow.
 *
 * Tests the edit button visibility, modal pre-population, and event update flow.
 * All tests require authentication (uses authenticatedPage fixture).
 */
import { test, expect } from './fixtures.js';
import { setupErrorCapture, waitForEventDetail } from './test-utils.js';
import { TEST_NADDRS } from './test-data.js';

/**
 * Helper to navigate to the calendar event detail page.
 * Uses client-side navigation since SSR is disabled for naddr routes.
 * @param {import('@playwright/test').Page} page
 * @param {string} naddr
 */
async function navigateToEvent(page, naddr) {
  // Ensure we're on a page where SPA is loaded
  const currentUrl = page.url();
  if (!currentUrl.includes('localhost')) {
    await page.goto('/discover');
    await page.waitForTimeout(2000);
  }

  // Navigate via programmatic anchor click (works with SSR-disabled routes)
  await page.evaluate((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, `/calendar/event/${naddr}`);

  // Wait for page to load
  await page.waitForTimeout(4000);
}

/**
 * Helper to open the edit modal from the event detail page.
 * @param {import('@playwright/test').Page} page
 */
async function openEditModal(page) {
  // Click the "Manage event" dropdown trigger button
  const manageButton = page.locator('button[aria-label="Manage event"]');
  await expect(manageButton).toBeVisible({ timeout: 5000 });
  await manageButton.click();

  // Wait for dropdown to open
  await page.waitForTimeout(300);

  // Click "Edit" in the dropdown - it's the first li button in the EventManagementActions dropdown
  // The dropdown is inside the same parent div as the manage button
  const editOption = manageButton.locator('..').locator('.dropdown-content li button').first();
  await expect(editOption).toBeVisible();
  await editOption.click();

  // Wait for modal to appear
  await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Edit Button Visibility Tests
// ============================================================================

test.describe('Calendar Event Editing - Edit Button Visibility', () => {
  test('edit button visible for event owner', async ({ authenticatedPage: page }) => {
    // Navigate to seeded event owned by TEST_AUTHOR (who we're logged in as)
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);

    // The "Manage event" button should be visible for the owner
    const manageButton = page.locator('button[aria-label="Manage event"]');
    await expect(manageButton).toBeVisible({ timeout: 5000 });

    // Click to verify Edit option exists in dropdown
    await manageButton.click();
    await page.waitForTimeout(300);

    // Edit option should be visible in dropdown (inside the same dropdown parent)
    const editOption = manageButton.locator('..').locator('.dropdown-content li button').first();
    await expect(editOption).toBeVisible();
  });

  test('edit button hidden for non-owner', async ({ page }) => {
    // Navigate to event without logging in (anonymous user)
    await page.goto('/discover');
    await page.waitForTimeout(2000);

    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);

    // The "Manage event" button should NOT be visible for non-owners
    const manageButton = page.locator('button[aria-label="Manage event"]');
    await expect(manageButton).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// Edit Modal Form Pre-population Tests
// ============================================================================

test.describe('Calendar Event Editing - Form Pre-population', () => {
  test('clicking Edit opens modal with pre-filled data', async ({ authenticatedPage: page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);
    await openEditModal(page);

    // Modal should be visible with form
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible();

    // Title input should be pre-filled
    const titleInput = page.locator('#title');
    await expect(titleInput).toBeVisible();
    const titleValue = await titleInput.inputValue();
    expect(titleValue).toBeTruthy();
    expect(titleValue.length).toBeGreaterThan(0);
  });

  test('form shows correct title from existing event', async ({ authenticatedPage: page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);

    // Get the title from the page before opening modal
    const pageTitle = await page.locator('h1').first().textContent();

    await openEditModal(page);

    // Title input should match the page title
    const titleInput = page.locator('#title');
    const titleValue = await titleInput.inputValue();
    expect(titleValue).toBe(pageTitle?.trim());
  });

  test('form shows correct date from existing event', async ({ authenticatedPage: page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);
    await openEditModal(page);

    // Start date should be pre-filled
    const startDateInput = page.locator('#startDate');
    await expect(startDateInput).toBeVisible();
    const startDateValue = await startDateInput.inputValue();
    expect(startDateValue).toMatch(/^\d{2}\.\d{2}\.\d{4}$/); // German DD.MM.YYYY display (#33)
  });
});

// ============================================================================
// Event Update Tests
// ============================================================================

test.describe('Calendar Event Editing - Update Flow', () => {
  test('can update title and save', async ({ authenticatedPage: page }) => {
    // First create an event to edit (so we don't modify seeded data)
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Click the FAB to expand it
    await page.locator('.fab [role="button"]').click();
    await page.waitForTimeout(300);

    // Click the "Create Event" button
    await page.locator('button[data-tip="Create Event"]').click();
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5000 });

    // Create an event
    const originalTitle = `Edit Test Event ${Date.now()}`;
    await page.locator('#title').fill(originalTitle);
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);
    await page.locator('.modal-box button[type="submit"]').click();

    // Wait for navigation to event detail page
    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });
    await waitForEventDetail(page);

    // Store the current URL before editing
    const eventUrl = page.url();

    // Now edit the event
    await openEditModal(page);

    // Change the title
    const newTitle = `Updated Event ${Date.now()}`;
    await page.locator('#title').fill(newTitle);

    // Click submit and wait for the button to trigger the update
    const submitButton = page.locator('.modal-box button[type="submit"]');
    await submitButton.click();

    // Wait for page to reload by waiting for the network to settle
    // The modal triggers window.location.reload() after successful update
    await page.waitForTimeout(5000);

    // Reload the page explicitly to get the updated data
    await page.goto(eventUrl);
    await waitForEventDetail(page);

    // Verify the updated title is visible
    await expect(page.locator('h1').filter({ hasText: newTitle })).toBeVisible({ timeout: 10000 });
  });

  test('can update description and save', async ({ authenticatedPage: page }) => {
    // Create an event to edit
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    await page.locator('.fab [role="button"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[data-tip="Create Event"]').click();
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5000 });

    const eventTitle = `Description Test Event ${Date.now()}`;
    await page.locator('#title').fill(eventTitle);
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);
    await page.locator('.modal-box button[type="submit"]').click();

    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });
    await waitForEventDetail(page);

    // Store the current URL
    const eventUrl = page.url();

    // Edit the event
    await openEditModal(page);

    // Add a description
    const newDescription = `Updated description ${Date.now()}`;
    await page.locator('#summary').fill(newDescription);

    // Submit the update
    await page.locator('.modal-box button[type="submit"]').click();

    // Wait for update to process
    await page.waitForTimeout(5000);

    // Reload page to get updated data
    await page.goto(eventUrl);
    await waitForEventDetail(page);

    // Verify the description is visible
    await expect(page.getByText(newDescription)).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Form Validation Tests
// ============================================================================

test.describe('Calendar Event Editing - Form Validation', () => {
  test('cannot submit with empty title', async ({ authenticatedPage: page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);
    await openEditModal(page);

    // Clear the title field
    await page.locator('#title').clear();

    // Try to submit
    await page.locator('.modal-box button[type="submit"]').click();

    // Wait a moment for validation
    await page.waitForTimeout(500);

    // Modal should still be open (validation failed)
    const modalStillOpen = await page.locator('dialog[open] .modal-box').isVisible();
    const validationError = await page.locator('.alert-error').isVisible();

    expect(modalStillOpen || validationError).toBe(true);
  });

  test('updated event shows new data after reload', async ({ authenticatedPage: page }) => {
    // Create an event to edit
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    await page.locator('.fab [role="button"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[data-tip="Create Event"]').click();
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5000 });

    const eventTitle = `Reload Test ${Date.now()}`;
    await page.locator('#title').fill(eventTitle);
    const today = new Date().toISOString().split('T')[0];
    await page.locator('#startDate').fill(today);
    await page.locator('.modal-box button[type="submit"]').click();

    await page.waitForURL(/\/calendar\/event\/naddr1/, { timeout: 15000 });
    await waitForEventDetail(page);

    // Store the URL for later reload
    const eventUrl = page.url();

    // Edit the event
    await openEditModal(page);

    // Make a small change
    const editedTitle = `${eventTitle} - Edited`;
    await page.locator('#title').fill(editedTitle);

    // Submit the update
    await page.locator('.modal-box button[type="submit"]').click();

    // Wait for update to be published
    await page.waitForTimeout(5000);

    // Manually reload to verify the update was saved
    await page.goto(eventUrl);
    await waitForEventDetail(page);

    // Updated title should be visible
    await expect(page.locator('h1').filter({ hasText: editedTitle })).toBeVisible({
      timeout: 10000
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Calendar Event Editing - Error Handling', () => {
  test('no critical JavaScript errors during edit flow', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    // Navigate to event
    await navigateToEvent(page, TEST_NADDRS.calendarDate);
    await waitForEventDetail(page);

    // Open edit modal
    await openEditModal(page);

    // Make a change
    const titleInput = page.locator('#title');
    const currentTitle = await titleInput.inputValue();
    await titleInput.fill(`${currentTitle} - Test Edit`);

    // Close modal without saving (to avoid modifying seeded data)
    await page.locator('.modal-box button.btn-circle.btn-ghost').click();

    // Wait for modal to close
    await page.waitForTimeout(1000);

    // Assert no critical errors
    errorCapture.assertNoCriticalErrors();
  });
});
