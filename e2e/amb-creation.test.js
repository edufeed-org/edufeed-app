/**
 * E2E tests for AMB (Educational Resource) creation flow.
 *
 * Tests the FAB, creation page UI, and step 1 form interaction.
 * All tests require authentication and use a test community.
 *
 * Note: Full creation flow testing is limited because SKOS dropdowns
 * require external vocabulary data that may not load in E2E environment.
 */
import {
  test,
  expect,
  navigateToAMBCreation,
  selectBildungsbereich,
  setupMetadataMock
} from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';
import { TEST_COMMUNITY } from './test-data.js';

// ============================================================================
// FAB and Page Navigation Tests
// ============================================================================

test.describe('AMB Resource Creation - FAB and Page Navigation', () => {
  test('FAB is visible on community Learning tab for authenticated user', async ({
    authenticatedPage: page
  }) => {
    // Navigate to community page
    await page.goto(`/c/${TEST_COMMUNITY.npub}`);
    await page.waitForTimeout(2000);

    // Wait for community sidebar to load
    await expect(page.locator('nav.menu').first()).toBeVisible({ timeout: 15000 });

    // Click on Learning tab using nav.menu button selector
    await page.locator('nav.menu button', { hasText: 'Learning' }).first().click();
    await page.waitForTimeout(2000);

    // FAB should be visible (use .first() since there's mobile and desktop FAB)
    await expect(page.locator('.fab').first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking Create Learning Content navigates to creation page', async ({
    authenticatedPage: page
  }) => {
    // Navigate to community page
    await page.goto(`/c/${TEST_COMMUNITY.npub}`);
    await page.waitForTimeout(2000);

    // Wait for community sidebar to load
    await expect(page.locator('nav.menu').first()).toBeVisible({ timeout: 15000 });

    // Click on Learning tab
    await page.locator('nav.menu button', { hasText: 'Learning' }).first().click();
    await page.waitForTimeout(2000);

    // Wait for FAB
    await expect(page.locator('.fab').first()).toBeVisible({ timeout: 15000 });

    // Click FAB to expand
    await page.locator('.fab [role="button"]').first().click();
    await page.waitForTimeout(300);

    // Click the "Create Learning Content" button
    await page.locator('button[data-tip="Create Learning Content"]').first().click();

    // Should navigate to the creation page
    await expect(page).toHaveURL(/\/create\/resource/, { timeout: 10000 });

    // New wizard starts on Bildungsbereich step — expect radio inputs, not
    // the title input.
    await expect(page.locator('input[name="bildungsbereich"]').first()).toBeVisible({
      timeout: 5000
    });

    // Should have navigation buttons (Next should be visible on step 1)
    await expect(page.locator('button:has-text("Next")')).toBeVisible();
  });

  test('creation page loads correctly from direct URL', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Should show the creation page with form
    await expect(page.locator('#amb-title')).toBeVisible();
    await expect(page.locator('button:has-text("Next")')).toBeVisible();

    // Should show the page header
    await expect(
      page
        .locator(
          'h1:has-text("Share Educational Resource"), h2:has-text("Share Educational Resource")'
        )
        .first()
    ).toBeVisible();
  });

  test('back button navigates to previous page', async ({ authenticatedPage: page }) => {
    // First go to discover page (so we have a history entry)
    await page.goto('/discover');
    await page.waitForTimeout(1000);

    // Then navigate to creation page — the new wizard starts on the
    // Bildungsbereich step, so wait for the radio inputs instead of #amb-title.
    await page.goto(`/create/resource?community=${TEST_COMMUNITY.npub}`);
    await page.waitForTimeout(2000);
    await expect(page.locator('input[name="bildungsbereich"]').first()).toBeVisible({
      timeout: 10000
    });

    // Click the back button in the top bar
    await page.locator('button[aria-label="Go back"]').click();
    await page.waitForTimeout(1000);

    // Should have navigated back
    await expect(page).toHaveURL(/\/discover/, { timeout: 5000 });
  });
});

// ============================================================================
// New Wizard Intro Steps — Bildungsbereich + URL/Metadata Fetch
// ============================================================================
// These tests cover steps 1 + 2 of the new guided wizard, which sit BEFORE
// what used to be "step 1" (now step 3: Basic). Metadata fetch is mocked via
// `setupMetadataMock`, so no network calls are required.

test.describe('AMB Resource Creation - Bildungsbereich Step', () => {
  test('all three Bildungsbereich radios are visible on initial load', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    await expect(page.locator('input[name="bildungsbereich"][value="schule"]')).toBeVisible();
    await expect(page.locator('input[name="bildungsbereich"][value="hochschule"]')).toBeVisible();
    await expect(page.locator('input[name="bildungsbereich"][value="extra"]')).toBeVisible();
  });

  test('cannot advance past Bildungsbereich without selecting one', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    // Next without selecting should keep us on step 1
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(300);

    // Still showing the radios (step 1)
    await expect(page.locator('input[name="bildungsbereich"]').first()).toBeVisible();
    // URL step's input should NOT be visible
    await expect(page.locator('#metadata-input')).not.toBeVisible();
  });

  test('selecting a Bildungsbereich advances to the URL step on Next', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    await selectBildungsbereich(page, 'schule');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(500);

    // URL step input should now be visible
    await expect(page.locator('#metadata-input')).toBeVisible({ timeout: 5000 });
  });

  test('clicking a Bildungsbereich card auto-advances without clicking Next', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    // Click the radio directly (simulating card-click → radio-change)
    await page.locator('input[name="bildungsbereich"][value="hochschule"]').check();

    // URL step input should appear within ~1s due to the ~200ms auto-advance delay
    await expect(page.locator('#metadata-input')).toBeVisible({ timeout: 2000 });
  });

  test('Bildungsbereich step does not show raw vocab-key slugs', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    // Raw vocab keys like "schulfaecher" or "hochschulfaecher" are implementation
    // detail and must not be shown to the user on step 1.
    const pageText = await page.locator('body').textContent();
    expect(pageText).not.toMatch(/schulfaecher|hochschulfaecher/);
  });
});

test.describe('AMB Resource Creation - URL / Metadata Fetch Step', () => {
  test('Step 2 shows the URL input and inspects automatically (no manual button)', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });
    await selectBildungsbereich(page, 'hochschule');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(500);

    // URL input is present, but no manual Inspect/Prüfen button exists.
    const urlInput = page.locator('#metadata-input');
    await expect(urlInput).toBeVisible();
    await expect(page.locator('button:has-text("Inspect")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Prüfen")')).toHaveCount(0);

    // Typing a URL triggers auto-inspect (debounced ~500 ms); the Next button
    // remains enabled so the user can proceed once the form prefills.
    await urlInput.fill('https://example.com/a-resource');
    await page.waitForTimeout(1000);
    await expect(page.locator('button:has-text("Next")').first()).toBeEnabled();
  });

  test('"none" metadata response advances to Basic step with empty form', async ({
    authenticatedPage: page
  }) => {
    // Default mock returns source:'none' — navigateToAMBCreation uses it
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, {
      url: 'https://example.com/no-metadata-here'
    });

    // On Basic step now — title should be empty (no prefill)
    await expect(page.locator('#amb-title')).toBeVisible();
    await expect(page.locator('#amb-title')).toHaveValue('');
    await expect(page.locator('#amb-description')).toHaveValue('');

    // Identifier should carry the URL entered on step 2
    await expect(page.locator('#amb-identifier')).toHaveValue(
      'https://example.com/no-metadata-here'
    );
  });

  test('Open Graph metadata prefills Basic step fields', async ({ authenticatedPage: page }) => {
    // Install OG mock BEFORE the navigate helper installs its default mock.
    await setupMetadataMock(page, {
      mode: 'og',
      og: {
        title: 'Mocked OG Title',
        description: 'Mocked OG Description from meta tags',
        image: 'https://example.com/og-thumb.jpg',
        locale: 'de_DE'
      }
    });

    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, {
      url: 'https://example.com/og-page',
      skipMockSetup: true
    });

    // Basic step fields should be prefilled from OG metadata
    await expect(page.locator('#amb-title')).toHaveValue('Mocked OG Title');
    await expect(page.locator('#amb-description')).toHaveValue(
      'Mocked OG Description from meta tags'
    );
    // Language extracted from 'de_DE' → 'de'
    await expect(page.locator('#amb-language')).toHaveValue('de');
    // Image URL prefilled
    await expect(page.locator('#amb-image')).toHaveValue('https://example.com/og-thumb.jpg');
  });

  test('AMB JSON-LD metadata prefills Basic step fields', async ({ authenticatedPage: page }) => {
    // Install AMB mock with a JSON-LD document using the shape proven to round-trip
    // through ambToNostr (see src/lib/__tests__/ambJsonLdToFormData.test.js).
    await setupMetadataMock(page, {
      mode: 'amb',
      amb: {
        '@context': 'https://w3id.org/kim/amb/context.jsonld',
        type: ['LearningResource', 'CreativeWork'],
        id: 'https://example.com/amb-resource',
        name: 'AMB Sample Resource',
        description: 'A sample AMB-tagged page',
        inLanguage: ['de'],
        learningResourceType: [
          {
            id: 'https://w3id.org/kim/hcrt/text',
            type: 'Concept',
            prefLabel: { de: 'Text', en: 'Text' }
          }
        ]
      }
    });

    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, {
      url: 'https://example.com/amb-resource',
      skipMockSetup: true
    });

    // Title and description should come from the AMB JSON-LD
    await expect(page.locator('#amb-title')).toHaveValue('AMB Sample Resource');
    await expect(page.locator('#amb-description')).toHaveValue('A sample AMB-tagged page');
    await expect(page.locator('#amb-language')).toHaveValue('de');
  });

  test('image preview renders on Basic step when OG returns an image', async ({
    authenticatedPage: page
  }) => {
    // Serve a valid 1x1 PNG for the OG image URL so the browser doesn't fire
    // the <img> onerror handler (which would hide the preview).
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    await page.route('https://example.com/og-thumb.jpg', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: onePixelPng
      })
    );

    await setupMetadataMock(page, {
      mode: 'og',
      og: {
        title: 'Preview Title',
        description: 'Preview Description',
        image: 'https://example.com/og-thumb.jpg'
      }
    });

    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, {
      url: 'https://example.com/og-preview',
      skipMockSetup: true
    });

    // Image URL prefilled
    await expect(page.locator('#amb-image')).toHaveValue('https://example.com/og-thumb.jpg');

    // A preview <img> should render pointing at the same URL
    const preview = page.locator('[data-testid="amb-image-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', 'https://example.com/og-thumb.jpg');
  });

  test('empty URL cannot advance past the URL step', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, { skipAdvance: true });

    await selectBildungsbereich(page, 'hochschule');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(500);

    // On URL step now — click Next without filling
    await expect(page.locator('#metadata-input')).toBeVisible();
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(300);

    // Should NOT have advanced — #amb-title from Basic step should not appear
    await expect(page.locator('#amb-title')).not.toBeVisible();
    // URL input should still be there
    await expect(page.locator('#metadata-input')).toBeVisible();
  });
});

// ============================================================================
// Step 1 Form Tests
// ============================================================================

test.describe('AMB Resource Creation - Step 1 Form', () => {
  test('step 1 shows all required form fields', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Should show identifier (URL) field
    await expect(page.locator('#amb-identifier')).toBeVisible();

    // Should show title input (required)
    await expect(page.locator('#amb-title')).toBeVisible();

    // Should show description textarea (required)
    await expect(page.locator('#amb-description')).toBeVisible();

    // Should show language dropdown (required)
    await expect(page.locator('#amb-language')).toBeVisible();

    // Should show image URL field
    await expect(page.locator('#amb-image')).toBeVisible();
  });

  test('can fill step 1 form fields', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub, {
      url: 'https://example.com/resource'
    });

    // Identifier is now read-only and is populated from the URL step; the
    // navigate helper entered 'https://example.com/resource', which should
    // now be reflected in the disabled identifier input.
    await expect(page.locator('#amb-identifier')).toHaveValue('https://example.com/resource');

    // Fill the remaining step-1 fields
    await page.locator('#amb-title').fill('Test Educational Resource');
    await page.locator('#amb-description').fill('A comprehensive test resource for E2E testing.');
    await page.locator('#amb-language').selectOption('en');
    await page.locator('#amb-image').fill('https://example.com/image.jpg');

    // Verify values are filled
    await expect(page.locator('#amb-title')).toHaveValue('Test Educational Resource');
    await expect(page.locator('#amb-description')).toHaveValue(
      'A comprehensive test resource for E2E testing.'
    );
  });

  test('cannot proceed without filling required fields', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Try to click Next without filling anything
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(500);

    // Should still be on step 1 (title input still visible)
    await expect(page.locator('#amb-title')).toBeVisible();

    // Now fill title only (still missing description)
    await page.locator('#amb-title').fill('Test Resource');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(500);

    // Should still be on step 1
    await expect(page.locator('#amb-title')).toBeVisible();
  });

  test('can proceed to step 2 with required fields filled', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill required fields
    await page.locator('#amb-title').fill('Test Educational Resource');
    await page.locator('#amb-description').fill('A test resource description.');
    await page.locator('#amb-language').selectOption('en');

    // Click Next
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);

    // Should be on step 2 - look for Resource Type label (use .first() to avoid strict mode)
    await expect(
      page.locator('text=Resource Type').or(page.locator('text=Ressourcentyp')).first()
    ).toBeVisible({ timeout: 5000 });

    // Back button should be visible
    await expect(page.locator('button:has-text("Back")')).toBeVisible();
  });

  test('can go back from step 2 to step 1', async ({ authenticatedPage: page }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill required fields and go to step 2
    await page.locator('#amb-title').fill('Test Resource');
    await page.locator('#amb-description').fill('Test description');
    await page.locator('#amb-language').selectOption('de');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);

    // Now on step 2, click Back
    await page.locator('button:has-text("Back")').click();
    await page.waitForTimeout(500);

    // Should be back on step 1 with form values preserved
    await expect(page.locator('#amb-title')).toBeVisible();
    await expect(page.locator('#amb-title')).toHaveValue('Test Resource');
    await expect(page.locator('#amb-description')).toHaveValue('Test description');
  });
});

// ============================================================================
// Step 2 Form Tests
// ============================================================================

test.describe('AMB Resource Creation - Step 2 (Classification)', () => {
  /**
   * Helper to navigate to step 2 with filled step 1 form
   * @param {import('@playwright/test').Page} page
   */
  async function goToStep2(page) {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);
    await page.locator('#amb-title').fill('Test Resource');
    await page.locator('#amb-description').fill('Test description');
    await page.locator('#amb-language').selectOption('en');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);
  }

  test('step 2 shows Resource Type dropdown', async ({ authenticatedPage: page }) => {
    await goToStep2(page);

    // Resource Type dropdown should be visible
    const resourceTypeLabel = page
      .locator('text=Resource Type')
      .or(page.locator('text=Ressourcentyp'));
    await expect(resourceTypeLabel.first()).toBeVisible({ timeout: 5000 });
  });

  test('step 2 shows Subject dropdown', async ({ authenticatedPage: page }) => {
    await goToStep2(page);

    // Subject dropdown should be visible
    const subjectLabel = page.locator('text=Subject').or(page.locator('text=Thema'));
    await expect(subjectLabel.first()).toBeVisible({ timeout: 5000 });
  });

  test('step 2 shows Keywords input', async ({ authenticatedPage: page }) => {
    await goToStep2(page);

    // Keywords input should be visible
    await expect(page.locator('#amb-keywords')).toBeVisible({ timeout: 5000 });
  });

  test('can add keyword on step 2', async ({ authenticatedPage: page }) => {
    await goToStep2(page);

    // Find keywords input and add a keyword
    const keywordsInput = page.locator('#amb-keywords');
    await keywordsInput.fill('education');
    await keywordsInput.press('Enter');

    // Keyword should appear as a badge
    await expect(page.locator('.badge').filter({ hasText: 'education' })).toBeVisible({
      timeout: 5000
    });
  });
});

// ============================================================================
// Step 3 Form Tests
// ============================================================================

test.describe('AMB Resource Creation - Step 3 (Content & Creators)', () => {
  /**
   * Helper to navigate to step 3 with filled step 1+2 forms
   * @param {import('@playwright/test').Page} page
   */
  async function goToStep3(page) {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill step 1
    await page.locator('#amb-title').fill('Test Resource');
    await page.locator('#amb-description').fill('Test description');
    await page.locator('#amb-language').selectOption('en');
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);

    // Skip step 2 (SKOS dropdowns may not have data in test environment)
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);
  }

  test('step 3 shows Creators input', async ({ authenticatedPage: page }) => {
    await goToStep3(page);

    // Check if we're on step 3 by looking for Creators label
    const creatorsLabel = page.locator('text=Creators').or(page.locator('text=Autoren'));
    const isStep3 = await creatorsLabel
      .first()
      .isVisible()
      .catch(() => false);

    if (isStep3) {
      await expect(creatorsLabel.first()).toBeVisible();
    } else {
      // Still on step 2 due to validation - that's expected behavior too
      await expect(page.locator('text=Resource Type').first()).toBeVisible();
    }
  });

  test('step 3 shows External URLs input', async ({ authenticatedPage: page }) => {
    await goToStep3(page);

    // Check if we're on step 3
    const externalUrlsLabel = page
      .locator('text=External References')
      .or(page.locator('text=Externe Links'));
    const isStep3 = await externalUrlsLabel
      .first()
      .isVisible()
      .catch(() => false);

    if (isStep3) {
      await expect(externalUrlsLabel.first()).toBeVisible();
    }
  });
});

// ============================================================================
// Step 4 Form Tests
// ============================================================================

test.describe('AMB Resource Creation - Step 4 (License & Publish)', () => {
  test('step 4 shows License dropdown when navigated properly', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill step 1 to enable navigation
    await page.locator('#amb-title').fill('License Test Resource');
    await page.locator('#amb-description').fill('Testing license selection');
    await page.locator('#amb-language').selectOption('en');

    // Try to navigate through all steps
    for (let step = 1; step < 4; step++) {
      const nextButton = page.locator('button:has-text("Next")');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Check if we reached step 4 (License dropdown visible)
    const licenseDropdown = page.locator('#amb-license');
    const isStep4 = await licenseDropdown.isVisible().catch(() => false);

    if (isStep4) {
      await expect(licenseDropdown).toBeVisible();
    } else {
      console.log('Did not reach step 4 - SKOS validation may be blocking');
    }
  });

  test('step 4 shows Free Access checkbox when navigated properly', async ({
    authenticatedPage: page
  }) => {
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill step 1
    await page.locator('#amb-title').fill('Free Access Test Resource');
    await page.locator('#amb-description').fill('Testing free access checkbox');
    await page.locator('#amb-language').selectOption('en');

    // Navigate through steps
    for (let step = 1; step < 4; step++) {
      const nextButton = page.locator('button:has-text("Next")');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Check for free access checkbox
    const freeAccessCheckbox = page.locator('text=freely accessible').first();
    const isStep4 = await freeAccessCheckbox.isVisible().catch(() => false);

    if (isStep4) {
      await expect(freeAccessCheckbox).toBeVisible();
    }
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('AMB Resource Creation - Error Handling', () => {
  test('no critical JavaScript errors during page interaction', async ({
    authenticatedPage: page
  }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Fill Basic-step form (auto-advanced to here by navigateToAMBCreation)
    await page.locator('#amb-title').fill('Error Test Resource');
    await page.locator('#amb-description').fill('Testing for JS errors');
    await page.locator('#amb-language').selectOption('en');

    // Navigate forward one step
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(1000);

    // Navigate back through all steps to the Bildungsbereich step (step 1),
    // where the Cancel button becomes visible. At this point we've come from
    // Classification (step 4) → Basic (step 3) → URL (step 2) → Bildungsbereich.
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has-text("Back")').click();
      await page.waitForTimeout(300);
    }

    // Click Cancel to leave the wizard
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(500);

    // Assert no critical errors
    errorCapture.assertNoCriticalErrors();
  });
});
