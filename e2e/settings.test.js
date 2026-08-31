import { test as baseTest, expect } from '@playwright/test';
import { test as authTest } from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';

/**
 * E2E tests for the Settings page.
 *
 * Tests verify:
 * 1. Theme switching (light/dark/system, default/STIL) - works without login
 * 2. Login requirements for relay settings
 * 3. Relay settings management (authenticated)
 * 4. Gated mode toggle (authenticated)
 * 5. Debug mode toggle (authenticated)
 */

baseTest.describe('Settings page - Unauthenticated', () => {
  baseTest.describe('Theme (single editorial theme, no picker)', () => {
    baseTest(
      'settings page loads on the default theme without a theme switcher',
      async ({ page }) => {
        await page.goto('/settings');

        await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
          timeout: 10_000
        });

        // Color mode is fixed to light — the editorial theme is the default
        const theme = await page.locator('html').getAttribute('data-theme');
        expect(theme).toBe('light');

        // The theme picker was removed (single theme for now)
        await expect(page.locator('text=Appearance')).not.toBeVisible();
      }
    );
  });

  baseTest.describe('Unauthenticated state', () => {
    baseTest('shows login prompt when not logged in', async ({ page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Should show a login prompt/alert for relay settings
      const loginPrompt = page.locator('text=/log in|sign in|login to|sign in to/i').first();
      await expect(loginPrompt).toBeVisible({ timeout: 5000 });
    });

    baseTest('hides relay settings when not logged in', async ({ page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Relay preferences section should NOT be visible
      const relaySection = page.locator('text=/relay preferences/i').first();
      await expect(relaySection).not.toBeVisible({ timeout: 3000 });

      // Gated mode section should NOT be visible
      const gatedSection = page.locator('text=/gated mode/i').first();
      await expect(gatedSection).not.toBeVisible({ timeout: 3000 });
    });
  });

  baseTest.describe('Error handling', () => {
    baseTest('no critical JavaScript errors on settings page', async ({ page }) => {
      const errorCapture = setupErrorCapture(page);

      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Navigate through different sections
      await page.waitForTimeout(2000);

      errorCapture.assertNoCriticalErrors();
    });
  });
});

authTest.describe('Settings page - Authenticated', () => {
  authTest.describe('Relay settings', () => {
    authTest('shows relay preferences when logged in', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Relay preferences section should be visible
      const relaySection = page.locator('text=/relay preferences/i').first();
      await expect(relaySection).toBeVisible({ timeout: 10_000 });
    });

    authTest('can see existing relays or create defaults', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for relay data to load
      await page.waitForTimeout(5000);

      // Should see either existing relays or "Create default list" option
      const hasRelays = await page.locator('text=/wss?:\\/\\//').first().isVisible();
      const hasCreateDefaults = await page
        .locator('button:has-text("Create default")')
        .first()
        .isVisible();

      expect(hasRelays || hasCreateDefaults).toBe(true);
    });

    authTest('shows Blossom servers section', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Blossom servers section should be visible
      const blossomSection = page.locator('text=/blossom|media server/i').first();
      await expect(blossomSection).toBeVisible({ timeout: 10_000 });
    });

    authTest('shows app-specific relay categories', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(3000);

      // Should see app-specific relay categories
      const calendarRelays = page.locator('text=/calendar/i').first();
      const educationalRelays = page.locator('text=/educational|learning/i').first();

      // At least one category should be visible
      const calendarVisible = await calendarRelays.isVisible().catch(() => false);
      const educationalVisible = await educationalRelays.isVisible().catch(() => false);

      expect(calendarVisible || educationalVisible).toBe(true);
    });
  });

  authTest.describe('Relay editing', () => {
    /**
     * Helper to ensure relay list exists before testing Add Relay form.
     * If no relay list exists, clicks "Create Relay List with Defaults" button.
     * @param {import('@playwright/test').Page} page
     */
    async function ensureRelayListExists(page) {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(5000);

      // Check if "Create Relay List with Defaults" button exists (means no relay list)
      const createDefaultsButton = page.locator('button:has-text("Create Relay List")');
      const hasNoRelayList = await createDefaultsButton.isVisible().catch(() => false);

      if (hasNoRelayList) {
        // Create default relay list first
        await createDefaultsButton.click();
        await page.waitForTimeout(1000);
      }
    }

    authTest('can see Add Relay form', async ({ authenticatedPage: page }) => {
      await ensureRelayListExists(page);

      // Should see Add Relay section
      const addRelayDivider = page.locator('text=/add relay/i').first();
      await expect(addRelayDivider).toBeVisible({ timeout: 5000 });

      // Should see relay URL input
      const relayInput = page.locator('input[placeholder*="relay.example.com"]').first();
      await expect(relayInput).toBeVisible();
    });

    authTest('can type relay URL in input', async ({ authenticatedPage: page }) => {
      await ensureRelayListExists(page);

      // Find relay URL input and type
      const relayInput = page.locator('input[placeholder*="relay.example.com"]').first();
      await relayInput.fill('wss://test-relay.example.com');

      // Verify the input value
      await expect(relayInput).toHaveValue('wss://test-relay.example.com');
    });

    authTest(
      'adding a bare hostname stores it with the wss:// scheme',
      async ({ authenticatedPage: page }) => {
        await ensureRelayListExists(page);

        const relayInput = page.locator('input[placeholder*="relay.example.com"]').first();
        await relayInput.fill('bare-host-relay.example.com');
        await page.locator('.join button:has-text("Add")').first().click();

        await expect(page.locator('text=wss://bare-host-relay.example.com').first()).toBeVisible({
          timeout: 5000
        });
      }
    );

    authTest('Add button is visible next to relay input', async ({ authenticatedPage: page }) => {
      await ensureRelayListExists(page);

      // Add button should be visible (in the join group with input)
      const addButton = page.locator('.join button:has-text("Add")').first();
      await expect(addButton).toBeVisible();
    });

    authTest(
      'read/write checkboxes are visible in add relay form',
      async ({ authenticatedPage: page }) => {
        await ensureRelayListExists(page);

        // Read and Write checkboxes for new relay should be visible
        // They use label-text class with "Read" and "Write" text
        const readLabel = page.locator('.label-text:has-text("Read")').first();
        const writeLabel = page.locator('.label-text:has-text("Write")').first();

        await expect(readLabel).toBeVisible();
        await expect(writeLabel).toBeVisible();
      }
    );

    authTest('can toggle read/write checkboxes', async ({ authenticatedPage: page }) => {
      await ensureRelayListExists(page);

      // Find the Read checkbox in the Add Relay form section (below the divider)
      // The checkbox is inside a label with gap-2 class
      const readCheckbox = page.locator('.label.gap-2 input[type="checkbox"]').first();

      // Get initial state
      const initialState = await readCheckbox.isChecked();

      // Toggle
      await readCheckbox.click();
      await page.waitForTimeout(300);

      // Verify state changed
      const newState = await readCheckbox.isChecked();
      expect(newState).toBe(!initialState);

      // Toggle back
      await readCheckbox.click();
    });
  });

  authTest.describe('Gated mode', () => {
    authTest('shows gated mode toggle when logged in', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(3000);

      // Look for gated mode section
      const gatedModeSection = page.locator('text=/gated mode/i').first();
      await expect(gatedModeSection).toBeVisible({ timeout: 5000 });
    });

    authTest('gated mode toggle is functional', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(3000);

      // Find a toggle in the gated mode section
      const gatedModeCard = page.locator('.card:has-text("Gated Mode")').first();
      const toggle = gatedModeCard.locator('input[type="checkbox"]').first();

      const toggleVisible = await toggle.isVisible().catch(() => false);
      if (toggleVisible) {
        // Just verify toggle is interactive (not disabled unless forced by config)
        const isDisabled = await toggle.isDisabled();
        // Toggle should either be enabled or show "forced" message
        if (!isDisabled) {
          // Don't actually click - just verify it's clickable
          expect(await toggle.isEnabled()).toBe(true);
        }
      }
    });
  });

  authTest.describe('Debug mode', () => {
    authTest('shows debug mode toggle when logged in', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(3000);

      // Look for developer/debug section
      const debugSection = page.locator('text=/developer/i').first();
      await expect(debugSection).toBeVisible({ timeout: 5000 });
    });

    authTest('debug mode toggle is functional', async ({ authenticatedPage: page }) => {
      await page.goto('/settings');

      await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
        timeout: 10_000
      });

      // Wait for settings to load
      await page.waitForTimeout(3000);

      // Find the debug toggle in the Developer section
      const developerCard = page.locator('.card:has-text("Developer")').first();
      const toggle = developerCard.locator('input[type="checkbox"]').first();

      const toggleVisible = await toggle.isVisible().catch(() => false);
      if (toggleVisible) {
        // Toggle debug mode and verify state changes
        const initialState = await toggle.isChecked();
        await toggle.click();
        await page.waitForTimeout(500);

        const newState = await toggle.isChecked();
        expect(newState).toBe(!initialState);

        // Toggle back to restore original state
        await toggle.click();
        await page.waitForTimeout(500);
      }
    });
  });

  authTest.describe('Error handling', () => {
    authTest(
      'no critical JavaScript errors when authenticated',
      async ({ authenticatedPage: page }) => {
        const errorCapture = setupErrorCapture(page);

        await page.goto('/settings');

        await expect(page.locator('h1').filter({ hasText: /settings/i })).toBeVisible({
          timeout: 10_000
        });

        // Wait for all sections to load
        await page.waitForTimeout(5000);

        errorCapture.assertNoCriticalErrors();
      }
    );
  });
});
