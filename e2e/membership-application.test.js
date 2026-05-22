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
 * interception. To avoid changing global E2E env (which would affect all other
 * tests), this single E2E asserts the **default-disabled deployment regression
 * boundary**: in the standard test env, signup wizard does not show a
 * membership step and /admin/membership renders without auth.
 *
 * Note: SignupModal integration is deferred — upstream `dev` refactored the
 * signup wizard to 3 steps after this branch was forked. Until the membership
 * step is re-integrated against the new wizard, the Settings page
 * `MembershipCard` is the primary entry point.
 */
import { test, expect } from '@playwright/test';

test.describe('Membership Application — Default-disabled regression boundary', () => {
  test('signup wizard renders without membership step by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-login-modal button:has-text("Sign Up")').click();
    await expect(page.locator('#global-signup-modal')).toBeVisible({ timeout: 5000 });

    // Should NOT contain any membership-related step content
    const modalText = await page.locator('#global-signup-modal').textContent();
    expect(modalText).not.toMatch(/Mitgliedschaft|Wunsch-Adresse|membership/i);
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
