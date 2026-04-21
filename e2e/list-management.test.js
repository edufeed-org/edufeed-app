/**
 * E2E tests for NIP-51 list management on the dashboard.
 *
 * Covers the Lists tab UI: section rendering, New List button, modal
 * interactions (open/close, form fields, validation).
 *
 * Full create + persist round-trip is intentionally NOT covered here —
 * that requires a signed publish to a relay which is flaky in E2E.
 * The underlying CreateList action is covered by unit tests.
 */
import { test, expect } from './fixtures.js';
import { TEST_NADDRS, TEST_AUTHOR_2 } from './test-data.js';

const DASHBOARD_LISTS_URL = '/c?view=my-stuff&tab=lists';

/**
 * Navigate to an naddr route using client-side navigation.
 * naddr routes have SSR disabled and rely on relay infrastructure that
 * only exists client-side, so we boot the SPA on a working page first,
 * then trigger an internal navigation via anchor click.
 * @param {import('@playwright/test').Page} page
 * @param {string} naddr
 */
async function navigateToNaddr(page, naddr) {
  // Boot the SPA on a page that works with SSR
  const currentUrl = page.url();
  if (!currentUrl.includes('localhost')) {
    await page.goto('/discover');
    await page.waitForTimeout(2000);
  }

  await page.evaluate((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, `/${naddr}`);

  // Wait for client-side navigation + relay load
  await page.waitForTimeout(3000);
}

// ============================================================================
// Lists tab rendering
// ============================================================================

test.describe('Dashboard Lists Tab', () => {
  test('renders lists section with New list button for authenticated user', async ({
    authenticatedPage: page
  }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    // Lists section should be visible
    await expect(page.locator('[data-testid="dashboard-lists"]')).toBeVisible({ timeout: 10_000 });

    // New list button should be visible in the section header
    await expect(page.locator('[data-testid="new-list-button"]')).toBeVisible();
  });
});

// ============================================================================
// New list modal
// ============================================================================

test.describe('New List Modal', () => {
  test('clicking New list button opens the modal with kind picker and fields', async ({
    authenticatedPage: page
  }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    // Open the modal
    await page.locator('[data-testid="new-list-button"]').click();

    // Modal should be visible
    const modal = page.locator('dialog.modal-open');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Kind picker (select) should be visible
    await expect(modal.locator('#new-list-kind')).toBeVisible();

    // Title input should be visible
    await expect(modal.locator('#new-list-title')).toBeVisible();

    // Description textarea should be visible
    await expect(modal.locator('#new-list-description')).toBeVisible();

    // Create button should be visible but disabled when title is empty
    const createButton = modal.locator('button[type="submit"]');
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeDisabled();
  });

  test('kind picker offers multiple NIP-51 parameterized list kinds', async ({
    authenticatedPage: page
  }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    await page.locator('[data-testid="new-list-button"]').click();

    const modal = page.locator('dialog.modal-open');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // The select should contain several kind options (follow set, relay set,
    // bookmark set, etc.). Just assert there are >=4 options rendered.
    const optionCount = await modal.locator('#new-list-kind option').count();
    expect(optionCount).toBeGreaterThanOrEqual(4);
  });

  test('filling the title enables the Create button', async ({ authenticatedPage: page }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    await page.locator('[data-testid="new-list-button"]').click();
    const modal = page.locator('dialog.modal-open');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const createButton = modal.locator('button[type="submit"]');
    await expect(createButton).toBeDisabled();

    await modal.locator('#new-list-title').fill('My test list');
    await expect(createButton).toBeEnabled();

    // Whitespace-only titles don't count as valid
    await modal.locator('#new-list-title').fill('   ');
    await expect(createButton).toBeDisabled();
  });

  test('Cancel button closes the modal', async ({ authenticatedPage: page }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    await page.locator('[data-testid="new-list-button"]').click();
    const modal = page.locator('dialog.modal-open');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click the Cancel button (the non-primary btn in modal-action)
    await modal.locator('.modal-action button.btn').first().click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking the backdrop closes the modal', async ({ authenticatedPage: page }) => {
    await page.goto(DASHBOARD_LISTS_URL);
    await page.waitForTimeout(2000);

    await page.locator('[data-testid="new-list-button"]').click();
    const modal = page.locator('dialog.modal-open');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click the backdrop (button.modal-backdrop at the end of the dialog)
    await modal.locator('button.modal-backdrop').click();

    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// People-list CRUD (follow set kind 30000 detail view)
// ============================================================================
//
// The NIP51ListDetailView renders add/remove affordances only when the active
// user is the list owner AND the list is a "people" render-mode kind
// (excluding kind 3 contacts, which are edited on the profile page).
// Publishing a mutation is intentionally NOT exercised — kind 30002-style
// round-trips are flaky in E2E. The underlying ActionRunner branching
// (AddUserToFollowSet / RemoveUserFromFollowSet / ModifyListTags) is
// covered by the unit test suite.

test.describe('NIP-51 People-list CRUD affordances', () => {
  const ADD_PROFILE_PLACEHOLDER = 'Search by name or paste an npub';

  test('owner sees AddProfileRow and remove button on their follow set', async ({
    authenticatedPage: page
  }) => {
    await navigateToNaddr(page, TEST_NADDRS.followSet);

    // AddProfileRow renders a single combobox input for the owner
    await expect(page.getByPlaceholder(ADD_PROFILE_PLACEHOLDER).first()).toBeVisible({
      timeout: 15_000
    });

    // Remove button is attached to the one seeded profile (TEST_AUTHOR_2)
    await expect(
      page.locator(`[data-testid="remove-profile-${TEST_AUTHOR_2.pubkey}"]`)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('pasting an already-added npub surfaces a disabled row with "Already added" badge', async ({
    authenticatedPage: page
  }) => {
    await navigateToNaddr(page, TEST_NADDRS.followSet);

    const input = page.getByPlaceholder(ADD_PROFILE_PLACEHOLDER).first();
    await expect(input).toBeVisible({ timeout: 15_000 });

    // TEST_AUTHOR_2 is already in the seeded follow set
    await input.fill(TEST_AUTHOR_2.npub);

    // The synthetic "Add profile" row appears in the dropdown but is flagged excluded
    const badge = page.getByText('Already added', { exact: true });
    await expect(badge).toBeVisible({ timeout: 5000 });

    // The row's button should be disabled (aria-disabled or disabled attribute)
    const dropdownButton = badge.locator('xpath=ancestor::button[1]');
    await expect(dropdownButton).toHaveAttribute('aria-disabled', 'true');
  });

  test('unauthenticated visitor does not see add/remove UI', async ({ page }) => {
    // Visit the owner's follow-set naddr as a non-owner (no auth).
    // navigateToNaddr handles the initial /discover boot itself.
    await navigateToNaddr(page, TEST_NADDRS.followSet);

    // AddProfileRow must not render for non-owners
    await expect(page.getByPlaceholder(ADD_PROFILE_PLACEHOLDER)).toHaveCount(0);

    // Remove button must not be rendered either
    await expect(
      page.locator(`[data-testid="remove-profile-${TEST_AUTHOR_2.pubkey}"]`)
    ).toHaveCount(0);
  });
});
