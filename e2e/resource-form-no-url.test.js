/**
 * E2E tests for the "Index a new Nostr-only resource" flow.
 *
 * Covers the escape-hatch that lets users advance past step 2 of the
 * resource wizard without entering a URL or naddr.
 */
import { test, expect } from './fixtures.js';

test.describe('Resource form — no-URL option', () => {
  test('happy path: publish a Nostr-only resource', async ({ authenticatedPage: page }) => {
    await page.goto('/create/resource/amb');

    // Step 1: Bildungsbereich
    await page.locator('input[name="bildungsbereich"]').first().check();
    // Auto-advances after 200ms — step 2 shows up.
    await expect(page.getByText('Resource URL or naddr')).toBeVisible({ timeout: 5000 });

    // Step 2: click the no-URL button and advance.
    await page.getByRole('button', { name: /Index a new Nostr-only resource/i }).click();
    await expect(page.getByText(/Resource without an external URL/i)).toBeVisible();
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 3: no URL field, fill required fields.
    await expect(page.locator('#amb-identifier')).toHaveCount(0);
    await page.locator('#amb-title').fill('Pure Nostr Resource');
    await page.locator('#amb-description').fill('A resource with no external URL.');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 4: pick a learning resource type + subject. (Use the first available
    // option for each dropdown — implementation detail of SKOSDropdown means
    // we click the picker, then the first option row.)
    await page.getByTestId('skos-dropdown-learningResourceType').click();
    await page.getByTestId('skos-dropdown-option').first().click();
    // Subject picker: same pattern, but FormConceptPicker not SKOSDropdown.
    // (If the Bildungsbereich has no subject vocab this step is skipped.)
    const subjectPicker = page.locator('[data-testid="form-concept-picker-about"]').first();
    if (await subjectPicker.isVisible()) {
      await subjectPicker.click();
      await page.getByTestId('concept-picker-option').first().click();
    }
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 5: validation must block submit — no file, no external URL.
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(
      page.getByText(/must have at least one file or external reference/i)
    ).toBeVisible();

    // Add an external URL to satisfy the validation.
    const externalUrlInput = page.getByPlaceholder(/https:\/\//).last();
    await externalUrlInput.fill('https://example.com/nostr-only-fallback');
    await externalUrlInput.press('Enter');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 6: relations — skip.
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 7: license defaults are fine — skip to step 8.
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 8: share — don't select any community. Publish.
    await page.getByRole('button', { name: /Publish/i }).click();

    // Expect navigation to an naddr-addressed detail page.
    await page.waitForURL(/\/naddr1[a-z0-9]+/i, { timeout: 15000 });
  });

  test('edit round-trip: reopening a no-URL resource restores the state card', async ({
    authenticatedPage: page
  }) => {
    // Create first (abbreviated — same shape as the happy path).
    await page.goto('/create/resource/amb');
    await page.locator('input[name="bildungsbereich"]').first().check();
    await expect(page.getByText('Resource URL or naddr')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /Index a new Nostr-only resource/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('#amb-title').fill('Edit Round-Trip Fixture');
    await page.locator('#amb-description').fill('Fixture for edit test.');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByTestId('skos-dropdown-learningResourceType').click();
    await page.getByTestId('skos-dropdown-option').first().click();
    const subjectPicker = page.locator('[data-testid="form-concept-picker-about"]').first();
    if (await subjectPicker.isVisible()) {
      await subjectPicker.click();
      await page.getByTestId('concept-picker-option').first().click();
    }
    await page.getByRole('button', { name: /Next/i }).click();
    const externalUrlInput = page.getByPlaceholder(/https:\/\//).last();
    await externalUrlInput.fill('https://example.com/edit-fixture');
    await externalUrlInput.press('Enter');
    await page.getByRole('button', { name: /Next/i }).click(); // step 6
    await page.getByRole('button', { name: /Next/i }).click(); // step 7
    await page.getByRole('button', { name: /Publish/i }).click();
    await page.waitForURL(/\/naddr1[a-z0-9]+/i, { timeout: 15000 });

    // Extract naddr from the URL and reopen in edit mode.
    const url = new URL(page.url());
    const naddr = url.pathname.replace(/^\//, '');
    await page.goto(`/create/resource/amb?edit=${naddr}`);

    // The state card for no-URL resources must be visible in edit mode.
    await expect(page.getByText(/Resource without an external URL/i)).toBeVisible({
      timeout: 10000
    });

    // Advance to step 3 and confirm the URL field is absent.
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.locator('#amb-identifier')).toHaveCount(0);
  });
});
