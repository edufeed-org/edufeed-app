/**
 * E2E tests for account management: login, logout, persistence, account switching.
 *
 * These tests verify the authentication flows work correctly from the user's perspective.
 */
import { test as base, expect } from '@playwright/test';
import { loginWithNsec, logout } from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';
import { TEST_AUTHOR, TEST_AUTHOR_2 } from './test-data.js';

// ============================================================================
// Login Modal UI Tests
// ============================================================================

base.describe('Login Modal UI', () => {
  base('login modal opens from navbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Click the login button
    await page.locator('button:has-text("Login")').first().click();

    // Modal should be visible
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
  });

  base('login modal shows available login methods', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Open login modal
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Check for login method buttons
    const nsecButton = page.locator('#global-login-modal [data-testid="login-method-nsec"]');
    const extensionButton = page.locator(
      '#global-login-modal [data-testid="login-method-extension"]'
    );
    const signupButton = page.locator('#global-login-modal [data-testid="signup-primary-cta"]');

    await expect(nsecButton).toBeVisible();
    await expect(extensionButton).toBeVisible();
    await expect(signupButton).toBeVisible();
  });

  base('login modal closes on escape key', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Open login modal
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Press escape to close
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('#global-login-modal')).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// NSEC Login Flow Tests
// ============================================================================

base.describe('NSEC Login Flow', () => {
  base('successful login with valid nsec shows profile in navbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Perform login
    await loginWithNsec(page, TEST_AUTHOR.nsec);

    // Verify: login button is gone, profile dropdown is visible
    // Use .first() to avoid strict mode violations from responsive navbar (desktop + mobile)
    await expect(page.locator('button:has-text("Login")').first()).not.toBeVisible({
      timeout: 5000
    });
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });
  });

  base('login fails with invalid nsec and shows error', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Click login and navigate to NSEC input
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });

    // Enter invalid nsec (malformed)
    const nsecInput = page.locator('#global-private-key-modal input').first();
    await nsecInput.fill('nsec1invalidkey123456789');

    // Click login
    await page.locator('#global-private-key-modal button.btn-primary').click();

    // Wait for error handling
    await page.waitForTimeout(1000);

    // Modal should still be visible (login failed)
    const modalStillOpen = await page.locator('#global-private-key-modal').isVisible();
    const errorVisible = await page
      .locator('.alert-error, [role="alert"], .text-error')
      .isVisible();

    // Either modal stays open OR an error message is shown
    expect(modalStillOpen || errorVisible).toBe(true);
  });

  base('login button is disabled with empty input', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Navigate to NSEC input modal
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });

    // Get the login button
    const loginButton = page.locator('#global-private-key-modal button.btn-primary');

    // Button should be disabled when input is empty
    const isDisabled = await loginButton.isDisabled();

    // Either button is disabled, or clicking it does nothing (modal stays open)
    if (!isDisabled) {
      await loginButton.click();
      await page.waitForTimeout(500);
      // Modal should still be visible since no input was provided
      await expect(page.locator('#global-private-key-modal')).toBeVisible();
    }
  });
});

// ============================================================================
// Logout Flow Tests
// ============================================================================

base.describe('Logout Flow', () => {
  base('logout removes account and shows login button', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login first
    await loginWithNsec(page, TEST_AUTHOR.nsec);

    // Verify logged in
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Logout
    await logout(page);

    // Verify: login button is back
    await expect(page.locator('button:has-text("Login")').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.dropdown .btn-circle').first()).not.toBeVisible();
  });

  base('logout clears account from localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Verify account is in localStorage
    const accountsBefore = await page.evaluate(() => localStorage.getItem('accounts'));
    expect(accountsBefore).toBeTruthy();
    expect(JSON.parse(accountsBefore).length).toBeGreaterThan(0);

    // Logout
    await logout(page);

    // Verify localStorage is cleared or empty
    const accountsAfter = await page.evaluate(() => localStorage.getItem('accounts'));
    if (accountsAfter) {
      const parsed = JSON.parse(accountsAfter);
      expect(parsed.length).toBe(0);
    }
  });
});

// ============================================================================
// Account Persistence Tests
// ============================================================================

base.describe('Account Persistence', () => {
  base('logged-in state persists across page reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForTimeout(3000);

    // Verify still logged in
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Login")').first()).not.toBeVisible();
  });

  base('multiple accounts persist across reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login with first account
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Add second account (open login modal again)
    await page.locator('.dropdown .btn-circle').first().click();
    await page.waitForTimeout(300);

    // Click "Switch Account" or similar to open login modal
    const switchButton = page
      .locator('.dropdown-content button')
      .filter({ hasText: /switch|wechseln/i })
      .first();
    await switchButton.click();

    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Login with second account
    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-private-key-modal input').first().fill(TEST_AUTHOR_2.nsec);
    await page.locator('#global-private-key-modal button.btn-primary').click();

    await page.waitForTimeout(1500);

    // Close modal
    for (let i = 0; i < 3; i++) {
      const hasOpenModal = await page.locator('dialog[open]').isVisible();
      if (hasOpenModal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else break;
    }

    // Check localStorage has 2 accounts
    const accounts = await page.evaluate(() => {
      const stored = localStorage.getItem('accounts');
      return stored ? JSON.parse(stored) : [];
    });
    expect(accounts.length).toBe(2);

    // Reload and verify both accounts still exist
    await page.reload();
    await page.waitForTimeout(3000);

    const accountsAfterReload = await page.evaluate(() => {
      const stored = localStorage.getItem('accounts');
      return stored ? JSON.parse(stored) : [];
    });
    expect(accountsAfterReload.length).toBe(2);
  });
});

// ============================================================================
// Account Switching Tests
// ============================================================================

base.describe('Account Switching', () => {
  base('can add second account without logging out first', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login with first account
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Open dropdown and click switch account
    await page.locator('.dropdown .btn-circle').first().click();
    await page.waitForTimeout(300);

    const switchButton = page
      .locator('.dropdown-content button')
      .filter({ hasText: /switch|wechseln/i })
      .first();
    await switchButton.click();

    // Login modal should open
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Add second account
    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-private-key-modal input').first().fill(TEST_AUTHOR_2.nsec);
    await page.locator('#global-private-key-modal button.btn-primary').click();

    await page.waitForTimeout(1500);

    // Close modal
    for (let i = 0; i < 3; i++) {
      const hasOpenModal = await page.locator('dialog[open]').isVisible();
      if (hasOpenModal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else break;
    }

    // Verify 2 accounts in storage
    const accounts = await page.evaluate(() => {
      const stored = localStorage.getItem('accounts');
      return stored ? JSON.parse(stored) : [];
    });
    expect(accounts.length).toBe(2);
  });

  base('can switch between accounts via login modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login with first account
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Get first account pubkey from active session
    const firstPubkey = await page.evaluate(() => localStorage.getItem('active'));

    // Add second account
    await page.locator('.dropdown .btn-circle').first().click();
    await page.waitForTimeout(300);
    const switchButton = page
      .locator('.dropdown-content button')
      .filter({ hasText: /switch|wechseln/i })
      .first();
    await switchButton.click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('#global-private-key-modal input').first().fill(TEST_AUTHOR_2.nsec);
    await page.locator('#global-private-key-modal button.btn-primary').click();

    await page.waitForTimeout(1500);

    // After adding second account, it becomes active
    const secondPubkey = await page.evaluate(() => localStorage.getItem('active'));

    // Active account should have changed
    expect(secondPubkey).not.toBe(firstPubkey);

    // Close modal
    for (let i = 0; i < 3; i++) {
      const hasOpenModal = await page.locator('dialog[open]').isVisible();
      if (hasOpenModal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else break;
    }

    // Now switch back to first account via login modal
    await page.locator('.dropdown .btn-circle').first().click();
    await page.waitForTimeout(300);
    await page
      .locator('.dropdown-content button')
      .filter({ hasText: /switch|wechseln/i })
      .first()
      .click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // The login modal should show saved accounts - click the first one's "Switch" button
    // Look for account cards or buttons in the modal
    const accountSwitchButtons = page.locator('#global-login-modal button:has-text("Switch")');
    const count = await accountSwitchButtons.count();

    if (count > 0) {
      // Click the first Switch button (for the other account)
      await accountSwitchButtons.first().click();
      await page.waitForTimeout(1000);

      // Verify active account changed back
      const finalPubkey = await page.evaluate(() => localStorage.getItem('active'));
      expect(finalPubkey).toBe(firstPubkey);
    }
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

base.describe('Error Handling', () => {
  base('no critical JavaScript errors during login flow', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Perform full login flow
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    errorCapture.assertNoCriticalErrors();
  });

  base('no critical JavaScript errors during logout flow', async ({ page }) => {
    const errorCapture = setupErrorCapture(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Login
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await expect(page.locator('.dropdown .btn-circle').first()).toBeVisible({ timeout: 5000 });

    // Logout
    await logout(page);
    await expect(page.locator('button:has-text("Login")').first()).toBeVisible({ timeout: 5000 });

    errorCapture.assertNoCriticalErrors();
  });
});
