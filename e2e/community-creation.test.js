/**
 * E2E tests for community creation (kind 10222).
 *
 * Tests the CreateCommunityModal flow including keypair selection,
 * community settings, and successful creation.
 *
 * Hermeticity (group-features-off): `playwright.config.js`'s shared webServer
 * hardcodes `CONCORD_ENABLED: 'true'` unconditionally — required for real
 * Concord flows in concord-channels.test.js / concord-notifications.test.js,
 * which run against the same server process, so it cannot simply be turned
 * off in the webServer env for everyone. That flag alone is enough to light
 * up CreateCommunityModal's flag-gated type step
 * (`typeStepVisible = moderatedAvailable || !!runtimeConfig.concord?.enabled`,
 * see wizard-logic.js `communityWizardSteps`), which would break every
 * step-count assumption below. (`GROUPS_ENABLED` is unset in both the
 * webServer env and this worktree's `.env`, so `moderatedAvailable` is false
 * either way and needs no override — but see the note below on why relying
 * on that is fragile.)
 *
 * Fix: force `runtimeConfig.concord.enabled = false` for every page this
 * file touches, following the `enableNpubLogin` technique in
 * npub-login.test.js — rewrite the JSON-escaped `/api/config` payload
 * SvelteKit inlines into the SSR'd document (the root layout's
 * `initializeConfig()` guards against re-initializing later, so intercepting
 * only the client-side `/api/config` fetch on `/discover` is too late once a
 * prior `/` navigation — e.g. inside the `authenticatedPage` fixture — has
 * already baked `concord.enabled: true` into the store), plus intercept the
 * `/api/config` route directly for any later client-side fetches.
 *
 * This is wired in via a local override of the `page` fixture (not a
 * `test.beforeEach`) so it also covers `authenticatedPage`, which depends on
 * `page` and performs its own `goto('/')` internally before any test body
 * runs — a `beforeEach` reliably running before a *fixture's* setup isn't
 * guaranteed the way overriding the fixture itself is.
 *
 * `/`'s SSR'd document ships an ~18KB `Link` header (one `modulepreload`
 * entry per JS chunk the root layout pulls in — this app's dependency graph
 * is large). That overflows the 16KB header cap baked into BOTH Playwright's
 * `route.fetch()` and Node's global `fetch()` (undici) — confirmed against
 * this preview build. `node:http`'s `maxHeaderSize` option has no such
 * ceiling, so document fetches go through a small manual client instead; the
 * oversized `link` header is dropped when refulfilling (it's a pure preload
 * hint — dropping it changes nothing observable, the browser still loads the
 * same scripts via normal `<script>` tags).
 */
import http from 'node:http';
import https from 'node:https';
import { test as base, expect } from './fixtures.js';
import { setupErrorCapture } from './test-utils.js';

/**
 * Fetch a URL via Node's raw http(s) client with a bumped max header size.
 * See the file header comment for why this exists instead of `route.fetch()`
 * or the global `fetch()`.
 * @param {string} url
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
function fetchDocument(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.request(url, { maxHeaderSize: 1_048_576 }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 200,
          contentType: /** @type {string} */ (res.headers['content-type']) || 'text/html',
          body: Buffer.concat(chunks).toString('utf-8')
        })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Force `concord.enabled: false` in the runtime config for a page, no matter
 * whether it was first populated via an SSR'd document or a client-side
 * `/api/config` fetch. See the file header comment for why both are needed.
 * @param {import('@playwright/test').Page} page
 */
async function disableGroupFeatures(page) {
  const patch = (text) =>
    text
      .replaceAll('\\"concord\\":{\\"enabled\\":true', '\\"concord\\":{\\"enabled\\":false')
      .replaceAll('"concord":{"enabled":true', '"concord":{"enabled":false');

  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (json.concord) json.concord = { ...json.concord, enabled: false };
    await route.fulfill({ response, json });
  });

  // Registered last → matched first (Playwright routes are LIFO); non-document
  // requests fall through to the /api/config route above or the network.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const { status, contentType, body } = await fetchDocument(route.request().url());
    await route.fulfill({ status, contentType, body: patch(body) });
  });
}

/**
 * Local test object: every `page` (and anything built on it, e.g.
 * `authenticatedPage`) gets group features forced off before any navigation.
 */
const test = base.extend({
  page: async ({ page }, use) => {
    await disableGroupFeatures(page);
    await use(page);
  }
});

/**
 * Navigate to the Communities tab on the discover page.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToCommunitiesTab(page) {
  await page.goto('/discover');
  await page.waitForTimeout(2000);

  // Switch to Communities tab
  await page.locator('[data-testid="tab-communities"]').click();
  await page.waitForTimeout(2000);
}

/**
 * Open the CreateCommunityModal from the Communities tab.
 * @param {import('@playwright/test').Page} page
 */
async function openCreateCommunityModal(page) {
  const createButton = page.locator('button', { hasText: 'Create Community' });
  await expect(createButton).toBeVisible({ timeout: 10000 });
  await createButton.click();
  await page.waitForTimeout(500);
}

/**
 * Expand the "Advanced Settings" collapse on the Community Settings step
 * (step 1) — Relays and Blossom servers live inside it (pre-existing UI
 * change on dev, unrelated to this plan; see CreateCommunityModal.svelte's
 * `collapse-arrow collapse` wrapper). daisyUI's checkbox-driven collapse
 * stacks an `<input type="checkbox">` on top of the `.collapse-title` text —
 * clicking the title div itself gets swallowed by that overlay, so check the
 * input directly.
 * @param {import('@playwright/test').Page} page
 */
async function expandAdvancedSettings(page) {
  const collapse = page.locator('.collapse', { hasText: 'Advanced Settings' });
  await collapse.locator('input[type="checkbox"]').check({ force: true });
  await page.waitForTimeout(300);
}

// ============================================================================
// Modal Access Tests
// ============================================================================

test.describe('Community Creation - Modal Access', () => {
  test('Create Community button not visible when not logged in', async ({ page }) => {
    await navigateToCommunitiesTab(page);

    // The "Create Community" button should NOT be visible for unauthenticated users
    const createButton = page.locator('button', { hasText: 'Create Community' });
    await expect(createButton).not.toBeVisible({ timeout: 3000 });
  });

  test('Create Community button visible when logged in', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);

    // The "Create Community" button should be visible for authenticated users
    const createButton = page.locator('button', { hasText: 'Create Community' });
    await expect(createButton).toBeVisible({ timeout: 10000 });
  });

  test('clicking Create Community button opens modal', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Modal should be visible (dialog element with heading)
    const modalHeading = page.getByRole('heading', { name: 'Create New Community' });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // Should show keypair selection options (step 0)
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await expect(useCurrentButton).toBeVisible({ timeout: 5000 });
  });

  test('type step is absent when no group features are enabled', async ({
    authenticatedPage: page
  }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);
    await page.locator('.modal-box button', { hasText: 'Use Current Keypair' }).click();
    await expect(page.locator('[data-testid="community-type-open"]')).toHaveCount(0);
  });
});

// ============================================================================
// Step 0 - Keypair Selection Tests
// ============================================================================

test.describe('Community Creation - Keypair Selection', () => {
  test('step 0 shows two keypair options', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Should show "Use Current Keypair" option
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await expect(useCurrentButton).toBeVisible({ timeout: 5000 });

    // Should show "Create New Keypair" option
    const createNewButton = page.locator('button', { hasText: 'Create New Keypair' });
    await expect(createNewButton).toBeVisible({ timeout: 5000 });
  });

  test('selecting "Use Current Keypair" advances to step 1', async ({
    authenticatedPage: page
  }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Click "Use Current Keypair"
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Should now show community settings (step 1). Content Types is the
    // reliable landmark: Relays now lives inside the collapsed "Advanced
    // Settings" accordion (pre-existing UI change, unrelated to this plan —
    // see 'step 1 shows settings form fields' below), so it isn't visible
    // without expanding that section first.
    const contentTypesLabel = page.getByText('Content Types', { exact: true });
    await expect(contentTypesLabel).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Create New Keypair Flow Tests
// ============================================================================

test.describe('Community Creation - New Keypair Flow', () => {
  /**
   * Helper to navigate to the new keypair profile step.
   * @param {import('@playwright/test').Page} page
   */
  async function selectCreateNewKeypair(page) {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Click "Create New Keypair"
    const createNewButton = page.locator('button', { hasText: 'Create New Keypair' });
    await createNewButton.click();
    await page.waitForTimeout(500);
  }

  test('selecting "Create New Keypair" advances to profile step', async ({
    authenticatedPage: page
  }) => {
    await selectCreateNewKeypair(page);

    // Should show profile form with name input
    const nameInput = page.locator('#profile-name').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  });

  test('profile step shows name input field', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // Name input should be visible
    const nameInput = page.locator('#profile-name').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  });

  test('profile step shows about textarea', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // About textarea should be visible
    const aboutTextarea = page.locator('#profile-about');
    await expect(aboutTextarea).toBeVisible({ timeout: 5000 });
  });

  test('profile step shows picture URL input', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // The plain `#profile-picture` input was replaced by LicensedImageInput
    // (pre-existing UI change on dev, unrelated to this plan — see
    // CreateCommunityModal.svelte's "community picture goes through the
    // licensed image input"); its URL field carries this testid instead.
    const pictureInput = page.getByTestId('licensed-image-url-input');
    await expect(pictureInput).toBeVisible({ timeout: 5000 });
  });

  test('can fill profile form and proceed to key generation', async ({
    authenticatedPage: page
  }) => {
    await selectCreateNewKeypair(page);

    // Fill profile form
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    const aboutTextarea = page.locator('#profile-about');
    if (await aboutTextarea.isVisible()) {
      await aboutTextarea.fill('A test community for E2E testing');
    }

    // Click Next to proceed to key generation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Should show key generation step with public key display
    const publicKeyDisplay = page.locator('code').filter({ hasText: /^npub1/ });
    await expect(publicKeyDisplay).toBeVisible({ timeout: 10000 });
  });

  test('key generation step shows public key (npub)', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // Fill required name field
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    // Proceed to key generation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Public key (npub) should be displayed
    const npubDisplay = page.locator('code').filter({ hasText: /^npub1/ });
    await expect(npubDisplay).toBeVisible({ timeout: 10000 });
  });

  test('key generation step shows download backup button', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // Fill required name field
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    // Proceed to key generation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Download backup button should be visible
    const downloadButton = page.locator('button:has-text("Download")').first();
    await expect(downloadButton).toBeVisible({ timeout: 10000 });
  });

  test('key generation step shows encrypted backup option', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // Fill required name field
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    // Proceed to key generation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Encrypted password input should be visible (KeypairGenerator uses #keypair-password)
    await expect(page.locator('#keypair-password')).toBeVisible({ timeout: 10000 });
  });

  test('cannot proceed from key generation without downloading backup', async ({
    authenticatedPage: page
  }) => {
    await selectCreateNewKeypair(page);

    // Fill required name field
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    // Proceed to key generation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Try to click Next without downloading
    await nextButton.click();
    await page.waitForTimeout(500);

    // Should show error or still be on key generation step
    const errorAlert = page.locator('.alert-error');
    const stillOnKeyGen = await page.locator('#keypair-password').isVisible();

    expect((await errorAlert.isVisible()) || stillOnKeyGen).toBe(true);
  });

  test('back button is NOT visible on profile step (step 1)', async ({
    authenticatedPage: page
  }) => {
    await selectCreateNewKeypair(page);

    // Should be on profile step
    await expect(page.locator('#profile-name').first()).toBeVisible({
      timeout: 5000
    });

    // Back button should NOT be visible at step 1 (only Cancel is available)
    // Component logic: {#if currentStep > 1} shows Back button
    const backButton = page.locator('.modal-box button', { hasText: 'Back' });
    await expect(backButton).not.toBeVisible({ timeout: 3000 });

    // Cancel button should be visible as the only way to exit at step 1
    const cancelButton = page.locator('.modal-box button', { hasText: 'Cancel' });
    await expect(cancelButton).toBeVisible();
  });

  test('back button works on key generation step', async ({ authenticatedPage: page }) => {
    await selectCreateNewKeypair(page);

    // Fill name and proceed to key generation
    const nameInput = page.locator('#profile-name').first();
    await nameInput.fill('Test Community');

    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(1000);

    // Should be on key generation step
    await expect(page.locator('code').filter({ hasText: /^npub1/ })).toBeVisible({
      timeout: 10000
    });

    // Click Back
    const backButton = page.locator('.modal-box button', { hasText: 'Back' });
    await backButton.click();
    await page.waitForTimeout(500);

    // Should be back on profile step with name preserved
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await expect(nameInput).toHaveValue('Test Community');
  });
});

// ============================================================================
// Step 1 - Community Settings Tests
// ============================================================================

test.describe('Community Creation - Community Settings', () => {
  test('step 1 shows settings form fields', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Advance to step 1
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Relays now live inside the collapsed "Advanced Settings" accordion
    // (pre-existing UI change on dev, unrelated to this plan) — expand it
    // before asserting the label is visible.
    await expandAdvancedSettings(page);
    const relaysLabel = page.locator('text=Community Relays');
    await expect(relaysLabel).toBeVisible({ timeout: 5000 });

    // Should show content types section
    const contentTypesLabel = page.getByText('Content Types', { exact: true });
    await expect(contentTypesLabel).toBeVisible({ timeout: 5000 });
  });

  test('can toggle content types', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Advance to step 1
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Content types are pill buttons (no checkbox inside — pre-existing UI
    // change on dev, unrelated to this plan); enabled state is the
    // `btn-primary` class plus a checkmark icon. Find the Calendar pill.
    const calendarButton = page.locator('button', { hasText: 'Calendar' });
    await expect(calendarButton).toBeVisible({ timeout: 5000 });

    const wasEnabled = await calendarButton.evaluate((el) => el.classList.contains('btn-primary'));

    // Click the button to toggle
    await calendarButton.click();
    await page.waitForTimeout(300);

    // Verify it changed
    const isEnabledNow = await calendarButton.evaluate((el) =>
      el.classList.contains('btn-primary')
    );
    expect(isEnabledNow).toBe(!wasEnabled);
  });

  test('default relay is pre-populated', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Advance to step 1
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Default relay (wss://relay.edufeed.org) is listed inside the collapsed
    // "Advanced Settings" accordion — expand it first (see above).
    await expandAdvancedSettings(page);
    const defaultRelay = page.locator('text=wss://relay.edufeed.org');
    await expect(defaultRelay).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Creation Flow Tests
// ============================================================================

test.describe('Community Creation - Full Flow', () => {
  test('can advance to confirmation step', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Step 0: Select "Use Current Keypair"
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Step 1: Click Next to go to confirmation
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.click();
    await page.waitForTimeout(500);

    // Should now show the Create Community button (confirmation step)
    const createButton = page.locator('.modal-box button', { hasText: 'Create Community' });
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test('can complete community creation', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Step 0: Select "Use Current Keypair"
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Step 1: Click Next
    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(500);

    // Step 2: Click Create Community
    const createButton = page.locator('.modal-box button', { hasText: 'Create Community' });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    // Wait for creation to complete and navigation
    // Should navigate to the community page (/c/[pubkey])
    await page.waitForURL(/\/c\//, { timeout: 15000 });

    // Should be on a community page
    expect(page.url()).toMatch(/\/c\//);
  });

  test('created community shows user as joined', async ({ authenticatedPage: page }) => {
    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Complete creation flow
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
    await nextButton.click();
    await page.waitForTimeout(500);

    const createButton = page.locator('.modal-box button', { hasText: 'Create Community' });
    await createButton.click();

    // Wait for navigation to community page
    await page.waitForURL(/\/c\//, { timeout: 15000 });

    // Should show the membership badge (user auto-joins their created
    // community). The badge class is unchanged but its copy was renamed
    // "Joined" -> "Following" on dev, unrelated to this plan — see
    // communikey_header_joined_badge / community_layout_compact_header_joined_badge.
    const joinedBadge = page.locator('.badge-success', { hasText: 'Following' }).first();
    await expect(joinedBadge).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Community Creation - Error Handling', () => {
  test('no critical JavaScript errors during modal interaction', async ({
    authenticatedPage: page
  }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCommunitiesTab(page);
    await openCreateCommunityModal(page);

    // Interact with the modal
    const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
    await useCurrentButton.click();
    await page.waitForTimeout(500);

    // Click back
    const backButton = page.locator('.modal-box button', { hasText: 'Back' });
    if (await backButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backButton.click();
      await page.waitForTimeout(500);
    }

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    errorCapture.assertNoCriticalErrors();
  });
});
