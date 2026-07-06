/**
 * E2E spec for the normie-friendly signup happy path.
 *
 * Validates the integrated educator wizard (skip path):
 *   1. Login modal shows a prominent "Create your account" CTA, with the
 *      legacy methods (extension/nsec/bunker) visible directly below a
 *      divider — no disclosure to expand. Returning users need to see
 *      their option without an extra click.
 *   2. Clicking the CTA opens the signup wizard at step 1 (name only).
 *   3. After entering a name and pressing Enter (form submit), the user
 *      lands on step 2 (optional avatar/bio). The picture-URL field is
 *      collapsed behind a small disclosure to keep step 2 quiet.
 *   4. Step 3 is the optional educator context (Bildungsbereich/interests);
 *      Continue advances with everything left empty.
 *   5. Step 4 is the community picker; "Skip" finishes signup.
 *   6. When membership is enabled (per /api/config), a step 5 offers the
 *      edufeed-handle application; "Später beantragen" closes the modal.
 *      When disabled, the modal closes right after step 4.
 *   7. The user then sees the BackupRecoveryBanner promoting the
 *      recovery-file download.
 *
 * Per project guidance (CLAUDE.md: "Prefer unit/component tests over E2E"),
 * this spec covers only the integrated happy path. Field-level behavior is
 * exercised in src/lib/components/__tests__/SignupModal.test.js etc.
 */
import { test, expect } from '@playwright/test';
import { setupErrorCapture } from './test-utils.js';

test.describe('Signup - Normie path', () => {
  test('user can create an account via the wizard skip path and sees backup banner', async ({
    page
  }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // The wizard grows an extra handle step when membership is enabled.
    const config = await (await page.request.get('/api/config')).json();
    const membershipEnabled = !!config?.membership?.enabled;

    // Open login modal
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Primary CTA is the prominent element above the legacy methods
    const primaryCta = page.locator('[data-testid="signup-primary-cta"]');
    await expect(primaryCta).toBeVisible();

    // Legacy methods (extension/nsec/bunker) are visible directly — no
    // disclosure to expand. Asserting all three buttons are reachable so
    // returning users don't have to hunt.
    const advanced = page.locator('[data-testid="other-signin-methods"]');
    await expect(advanced).toBeVisible();
    await expect(advanced.locator('button.btn')).toHaveCount(3);

    // Click the primary CTA → opens signup modal at step 1
    await primaryCta.click();
    await expect(page.locator('#global-signup-modal')).toBeVisible({ timeout: 5000 });

    const nameInput = page.locator('#signup-name-input');
    await expect(nameInput).toBeVisible();

    // Step indicator: account / profile / context / communities (+ handle)
    await expect(page.locator('#global-signup-modal .steps .step')).toHaveCount(
      membershipEnabled ? 5 : 4
    );

    // Fill name and submit by pressing Enter — exercises the <form> wrap so
    // the keyboard path can't silently regress.
    await nameInput.fill('Test Teacher');
    await nameInput.press('Enter');

    // Step 2 visible: optional profile fields. The picture-URL input lives
    // inside a collapsed <details>, so we don't assert it's visible — the
    // about textarea is the always-visible signal.
    await expect(page.locator('#signup-about-textarea')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="signup-picture-url-disclosure"]')).toBeVisible();
    await page.locator('#global-signup-modal .modal-action .btn-primary').click();

    // Step 3: educator context (all optional) — Bildungsbereich dropdown is
    // the always-visible signal. Continue with everything empty.
    await expect(page.locator('#educator-levels')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="signup-context-continue"]').click();

    // Step 4: community picker → Skip finishes signup.
    const skipCommunities = page.locator('[data-testid="signup-skip-communities"]');
    await expect(skipCommunities).toBeVisible({ timeout: 5000 });
    await skipCommunities.click();

    if (membershipEnabled) {
      // Step 5: optional handle application; "Später beantragen" closes.
      const skipHandle = page.locator('[data-testid="signup-skip-handle"]');
      await expect(skipHandle).toBeVisible({ timeout: 10_000 });
      await skipHandle.click();
    }

    // Modal closes
    await expect(page.locator('#global-signup-modal')).not.toBeVisible({ timeout: 10_000 });

    // Backup recovery banner now visible (active user is a freshly-created nsec account)
    await expect(page.locator('[data-testid="backup-recovery-banner"]')).toBeVisible({
      timeout: 10_000
    });

    errorCapture.assertNoCriticalErrors();
  });
});
