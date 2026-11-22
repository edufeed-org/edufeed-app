/**
 * E2E tests for NIP-50 search on the Learning tab.
 *
 * Tests search functionality including text search, the absence of SKOS
 * filters, and search results display on the discover page Learning tab.
 *
 * Note: Full search flow testing depends on relay behavior (NIP-50 support).
 * These tests focus on UI element presence and basic functionality.
 */
import { test, expect } from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';

/**
 * Navigate to discover page and switch to Learning tab.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToLearningTab(page) {
  await page.goto('/discover');
  await page.waitForTimeout(2000);

  // Click the Learning tab using data-testid
  await page.locator('[data-testid="tab-learning"]').click();

  // Wait for learning tab to activate and content area to render
  await page.waitForTimeout(3000);
}

/**
 * Get the main search input element.
 * @param {import('@playwright/test').Page} page
 */
function getSearchInput(page) {
  // Use "Search content" aria-label to distinguish from SKOS dropdown search inputs
  return page.getByRole('textbox', { name: 'Search content' });
}

// ============================================================================
// Search Input Tests
// ============================================================================

test.describe('Learning Search - Search Input', () => {
  test('search input visible on Learning tab', async ({ page }) => {
    await navigateToLearningTab(page);

    // Search input should be visible
    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });

  test('can type in search input', async ({ page }) => {
    await navigateToLearningTab(page);

    // Get search input and type a search term
    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    await searchInput.fill('Mathematics');
    await page.waitForTimeout(500);

    // Verify the text was entered
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('Mathematics');
  });

  test('clear button appears and works when text is entered', async ({ page }) => {
    await navigateToLearningTab(page);

    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type a search term
    await searchInput.fill('Physics');
    await page.waitForTimeout(500);

    // Clear button should appear
    const clearButton = page.locator('button', { hasText: '✕' });
    await expect(clearButton).toBeVisible({ timeout: 3000 });

    // Click clear button
    await clearButton.click();
    await page.waitForTimeout(500);

    // Search input should be empty
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('');
  });
});

// ============================================================================
// No SKOS Filters on /discover
// ============================================================================

test.describe('Learning Search - No SKOS Filters', () => {
  // The tab also lists kind 30040 publications, which carry none of the AMB
  // tags the SKOS filters match — a selected filter would hide them all.
  test('Learning tab shows no SKOS filter row', async ({ page }) => {
    await navigateToLearningTab(page);

    await expect(page.locator('[data-testid="general-filters"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-filters"]')).toHaveCount(0);
    await expect(page.locator('text=Resource Type')).not.toBeVisible();
  });
});

// ============================================================================
// Sort and Relay Filters Tests
// ============================================================================

test.describe('Learning Search - Common Filters', () => {
  test('Sort dropdown is visible on Learning tab', async ({ page }) => {
    await navigateToLearningTab(page);

    // Sort dropdown should be visible with "Newest First" selected
    const sortDropdown = page.getByRole('combobox', { name: /sort/i });
    await expect(sortDropdown).toBeVisible({ timeout: 10000 });
  });

  test('Relay filter dropdown is visible on Learning tab', async ({ page }) => {
    await navigateToLearningTab(page);

    // Relay filter should be visible
    const relayLabel = page.locator('text=Relay:');
    await expect(relayLabel).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Learning Search - Error Handling', () => {
  test('no critical JavaScript errors during page load', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToLearningTab(page);

    // Just verify page loaded without critical errors
    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    errorCapture.assertNoCriticalErrors();
  });

  test('no critical JavaScript errors when typing in search', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToLearningTab(page);

    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type and clear search
    await searchInput.fill('Economics');
    await page.waitForTimeout(1000);
    await searchInput.fill('');
    await page.waitForTimeout(500);

    errorCapture.assertNoCriticalErrors();
  });
});
