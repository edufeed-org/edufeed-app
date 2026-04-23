/**
 * E2E tests for the "no external link" flow.
 *
 * Covers the escape-hatch card on step 2 of the resource wizard that lets
 * users skip URL/naddr entry and create a Nostr-native resource directly.
 * Clicking the card auto-advances to step 3.
 */
import { test, expect } from './fixtures.js';

test.describe('Resource form — no-URL option', () => {
  test('happy path: no-URL resource advances through step 3', async ({
    authenticatedPage: page
  }) => {
    await page.goto('/create/resource/amb');

    // Step 1: Bildungsbereich — check the first radio and auto-advance.
    await page.locator('input[name="bildungsbereich"]').first().check();
    // Auto-advances after 200ms — step 2 shows up.
    await expect(page.getByText('Resource URL or naddr')).toBeVisible({ timeout: 5000 });

    // Step 2: click the no-URL card — auto-advances to step 3 after 200ms.
    await page.getByTestId('no-url-button').click();

    // Step 3: URL field must be absent; fill required fields and advance.
    await expect(page.locator('#amb-identifier')).toHaveCount(0);
    await page.locator('#amb-title').fill('Pure Nostr Resource');
    await page.locator('#amb-description').fill('A resource with no external URL.');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 4 reached — verify the Classification step is visible.
    // We stop here: full publish requires SKOS/FormConceptPicker interaction
    // which cannot be completed in E2E because concept events (kind 39737) are
    // not seeded on E2E relays. See e2e/COVERAGE.md:237 for details.
    await expect(page.locator('text=Resource Type').first()).toBeVisible({ timeout: 10000 });
  });

  // SKIPPED: Publishing requires completing step 4 (SKOS/FormConceptPicker
  // selection of learning resource type and subject). The E2E relays are NOT
  // seeded with ConceptScheme/concept events (kind 39737), so FormConceptPicker
  // shows an empty dropdown and selection fails validation. Re-enable once
  // concept events are seeded on the E2E amb-relay (see e2e/COVERAGE.md:237).
  test.skip('edit round-trip: reopening a no-URL resource restores the state card', async ({
    authenticatedPage: page
  }) => {
    // Create first (abbreviated — same shape as the happy path).
    await page.goto('/create/resource/amb');
    await page.locator('input[name="bildungsbereich"]').first().check();
    await expect(page.getByText('Resource URL or naddr')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('no-url-button').click();
    // Auto-advance lands us on step 3 directly.
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
    await expect(page.getByText(/will be created directly on Nostr/i)).toBeVisible({
      timeout: 10000
    });

    // Advance to step 3 and confirm the URL field is absent.
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.locator('#amb-identifier')).toHaveCount(0);
  });
});
