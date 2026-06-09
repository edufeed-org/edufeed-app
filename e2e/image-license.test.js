/**
 * E2E: image license attestation modal opens on upload, closes on save.
 *
 * Scope: verifies the new modal/upload behaviors on the Basic step of the AMB
 * wizard. Does NOT publish a resource (the full-flow E2E is currently
 * skip'd because of SKOS seeding — see amb-creation-full.test.js).
 *
 * `navigateToAMBCreation()` auto-advances past steps 1 (Bildungsbereich) and
 * 2 (URL), landing us on step 3 (Basic) where LicensedImageInput lives.
 */
import path from 'node:path';
import { test, expect, navigateToAMBCreation } from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';
import { TEST_COMMUNITY } from './test-data.js';

const IMAGE_FIXTURE = path.resolve(process.cwd(), 'e2e/fixtures/test-image.png');

test.describe('Image license attestation', () => {
  test('uploading an image opens the license modal', async ({ authenticatedPage: page }) => {
    setupErrorCapture(page);
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    // Trigger the hidden file input directly (the Upload button calls .click()
    // on it, but driving the input itself is more reliable in headless).
    const fileInput = page.getByTestId('licensed-image-file-input');
    await fileInput.setInputFiles(IMAGE_FIXTURE);

    // License modal should auto-open after the Blossom upload settles.
    const modal = page.getByTestId('license-modal');
    await expect(modal).toBeVisible({ timeout: 20000 });

    // Save with default license + a credit.
    await modal.locator('#license-modal-credit').fill('E2E Test User');
    await page.getByTestId('license-modal-save').click();
    await expect(modal).toBeHidden({ timeout: 10000 });
  });

  test('closing the modal without saving leaves the image field flagged', async ({
    authenticatedPage: page
  }) => {
    setupErrorCapture(page);
    await navigateToAMBCreation(page, TEST_COMMUNITY.npub);

    const fileInput = page.getByTestId('licensed-image-file-input');
    await fileInput.setInputFiles(IMAGE_FIXTURE);

    const modal = page.getByTestId('license-modal');
    await expect(modal).toBeVisible({ timeout: 20000 });

    // Cancel without saving. The modal's Cancel button is a .btn-ghost.
    await modal.locator('button.btn-ghost').click();
    await expect(modal).toBeHidden();

    // Clicking Next on the Basic step should surface a validation error
    // about the missing license attestation (English copy:
    // "Uploaded images require a license attestation. Open the license
    // modal to file one.").
    await page.locator('button:has-text("Next")').click();
    await expect(page.getByText(/license attestation|Lizenz-Attestierung/i).first()).toBeVisible({
      timeout: 5000
    });
  });
});
