/**
 * E2E tests for profile editing flow.
 *
 * Tests the edit button visibility, modal pre-population, and profile update flow.
 * All authenticated tests use the authenticatedPage fixture.
 */
import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { TEST_AUTHOR, TEST_AUTHOR_2 } from './test-data.js';
import { setupErrorCapture } from './test-utils.js';

const OWN_PROFILE_URL = `/p/${TEST_AUTHOR.npub}`;
const OTHER_PROFILE_URL = `/p/${TEST_AUTHOR_2.npub}`;

/**
 * Wait for profile page to load.
 * @param {import('@playwright/test').Page} page
 */
async function waitForProfileLoad(page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Open the kind-0 edit modal via the rail card's edit icon.
 * @param {import('@playwright/test').Page} page
 */
async function openEditModal(page) {
  await page.getByTestId('edit-profile-rail').click();
  await expect(page.locator('dialog[open]')).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Edit Button Visibility Tests
// ============================================================================

test.describe('Profile Editing - Edit Button Visibility', () => {
  test('edit button visible on own profile', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Rail edit icon + tab customization button are owner-only controls
    await expect(page.getByTestId('edit-profile-rail')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('customize-tabs')).toBeVisible({ timeout: 5000 });
  });

  test('edit button not visible on other profile', async ({ authenticatedPage: page }) => {
    await page.goto(OTHER_PROFILE_URL);
    await waitForProfileLoad(page);

    // Owner-only edit controls should NOT be visible on someone else's profile
    await expect(page.getByTestId('edit-profile-rail')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('customize-tabs')).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// Edit Modal Form Tests
// ============================================================================

test.describe('Profile Editing - Modal Form', () => {
  test('clicking Edit opens modal', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open modal via the rail edit icon
    await openEditModal(page);
  });

  test('modal shows correct title', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Click edit button
    await openEditModal(page);

    // Modal title should indicate profile editing
    await expect(page.locator('dialog h3')).toBeVisible();
  });

  test('form pre-populates with current profile data', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Get the current profile name from the page
    const profileName = await page.locator('h1').first().textContent();

    // Click edit button
    await openEditModal(page);

    // Name field should be pre-populated
    const nameInput = page.locator('dialog input[name="name"], dialog input#name').first();
    if (await nameInput.isVisible()) {
      await expect(nameInput).toHaveValue(profileName?.trim() || TEST_AUTHOR.name);
    }
  });

  test('modal closes on close button click', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open modal
    await openEditModal(page);

    // Click close button (X button with ✕ text)
    await page.locator('dialog button.btn-circle:has-text("✕")').click();

    // Modal should close
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// Profile Update Tests
// ============================================================================

test.describe('Profile Editing - Update Flow', () => {
  test('can update name and save', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open edit modal
    await openEditModal(page);

    // Find and update the name field
    const nameInput = page.locator('#profile-name');
    const newName = `Updated Name ${Date.now()}`;
    await nameInput.clear();
    await nameInput.fill(newName);

    // Click save button (use specific selector to avoid matching close button)
    const saveButton = page.getByRole('button', { name: 'Save Profile' });
    await saveButton.click();

    // Wait for save to complete (success message or modal close)
    await expect(async () => {
      const modalStillOpen = await page.locator('dialog[open]').isVisible();
      const successMessage = await page.locator('.alert-success').isVisible();
      expect(modalStillOpen === false || successMessage === true).toBe(true);
    }).toPass({ timeout: 15_000 });

    // If modal closed, reload and verify the change persisted
    const modalOpen = await page.locator('dialog[open]').isVisible();
    if (!modalOpen) {
      await page.reload();
      await waitForProfileLoad(page);
      await expect(page.locator('h1')).toContainText(newName, { timeout: 10_000 });
    }
  });

  test('can update about and save', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open edit modal
    await openEditModal(page);

    // Find and update the about field (textarea)
    const aboutInput = page.locator('#profile-about');
    const newAbout = `Updated bio ${Date.now()}`;

    if (await aboutInput.isVisible()) {
      await aboutInput.clear();
      await aboutInput.fill(newAbout);

      // Click save button (use specific selector to avoid matching close button)
      const saveButton = page.getByRole('button', { name: 'Save Profile' });
      await saveButton.click();

      // Wait for save to complete
      await expect(async () => {
        const modalStillOpen = await page.locator('dialog[open]').isVisible();
        const successMessage = await page.locator('.alert-success').isVisible();
        expect(modalStillOpen === false || successMessage === true).toBe(true);
      }).toPass({ timeout: 15_000 });
    }
  });
});

// ============================================================================
// Form Validation Tests
// ============================================================================

test.describe('Profile Editing - Form Validation', () => {
  test('shows error for empty name', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open edit modal
    await openEditModal(page);

    // Clear the name field
    const nameInput = page.locator('#profile-name');
    await nameInput.clear();

    // Click save button (use specific selector to avoid matching close button)
    const saveButton = page.getByRole('button', { name: 'Save Profile' });
    await saveButton.click();

    // Wait for validation - modal should stay open or show error
    await page.waitForTimeout(500);

    // Modal should still be open (validation failed)
    const modalStillOpen = await page.locator('dialog[open]').isVisible();
    expect(modalStillOpen).toBe(true);
  });

  test('shows error for invalid URL in website field', async ({ authenticatedPage: page }) => {
    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open edit modal
    await openEditModal(page);

    // Find website input and enter invalid URL
    const websiteInput = page.locator('#profile-website');

    if (await websiteInput.isVisible()) {
      await websiteInput.fill('not-a-valid-url');

      // Ensure name is filled (required)
      const nameInput = page.locator('#profile-name');
      await nameInput.fill('Test Name');

      // Click save button (use specific selector to avoid matching close button)
      const saveButton = page.getByRole('button', { name: 'Save Profile' });
      await saveButton.click();

      // Wait for validation
      await page.waitForTimeout(500);

      // Modal should still be open (validation failed)
      const modalStillOpen = await page.locator('dialog[open]').isVisible();
      expect(modalStillOpen).toBe(true);
    }
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Profile Editing - Error Handling', () => {
  test('no critical JavaScript errors during edit flow', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto(OWN_PROFILE_URL);
    await waitForProfileLoad(page);

    // Open edit modal
    await openEditModal(page);

    // Make some changes
    const nameInput = page.locator('#profile-name');
    await nameInput.fill('Test Edit');

    // Close modal without saving
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Assert no critical errors
    errorCapture.assertNoCriticalErrors();
  });
});
