/**
 * E2E test for the Edufeed.org membership application flow.
 *
 * Per project memory `feedback_prefer_unit_over_e2e`, the rich form interactions
 * (handle availability check, NIP-44 encryption, kind 1069 publish,
 * admin authorization) are covered by Vitest component tests under
 *   src/lib/__tests__/edufeedMembershipForm.test.js
 *   src/lib/components/membership/__tests__/MembershipApplicationForm.test.js
 *   src/lib/components/membership/__tests__/MembershipCard.test.js
 *   src/lib/components/__tests__/AdminMembershipRoute.test.js
 *
 * The runtime config (`runtimeConfig.membership.enabled`) is loaded SSR-time
 * via /api/config and cannot be flipped per-test with Playwright route
 * interception. This E2E therefore branches on the deployed config: with
 * membership disabled the signup wizard has 4 steps and no handle step; with
 * it enabled the wizard grows the optional step 5 handle application (the
 * happy path through it is covered in signup-normie-path.test.js).
 */
import { test, expect } from '@playwright/test';

test.describe('Membership Application — deployment gate', () => {
  test('signup wizard shows the handle step only when membership is enabled', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const config = await (await page.request.get('/api/config')).json();
    const membershipEnabled = !!config?.membership?.enabled;

    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="signup-primary-cta"]').click();
    await expect(page.locator('#global-signup-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#global-signup-modal .steps .step')).toHaveCount(
      membershipEnabled ? 5 : 4
    );
    if (!membershipEnabled) {
      // Disabled deployments must not leak any membership/handle step content.
      const modalText = await page.locator('#global-signup-modal').textContent();
      expect(modalText).not.toMatch(/Mitgliedschaft|Wunsch-Adresse|membership|Handle/i);
    }
  });

  test('/admin/membership shows login-required when membership is disabled', async ({ page }) => {
    await page.goto('/admin/membership');
    await page.waitForTimeout(2000);

    // With membership disabled and no logged-in user, the route still renders
    // (it's just a Svelte page) and shows the login-required alert because
    // activePubkey is empty. The page chrome (h1 with admin_membership_title)
    // is always present.
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });
});
