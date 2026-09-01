import { test as base, expect } from '@playwright/test';
import { TEST_AUTHOR } from './test-data.js';
import {
  MOCK_HCRT_VOCABULARY,
  MOCK_SUBJECTS_VOCABULARY,
  MOCK_END_USER_ROLE_VOCABULARY
} from './mock-skos-data.js';

/**
 * Extended Playwright test with authenticated page fixture.
 * The authenticatedPage fixture provides a page with a logged-in test user.
 */
export const test = base.extend({
  /**
   * Page with authenticated test user.
   * Uses UI-based login with nsec for reliable authentication.
   */
  authenticatedPage: async ({ page }, use) => {
    // Navigate to home page
    await page.goto('/');
    await page.waitForTimeout(2000); // Wait for app initialization

    // Click the login button in navbar
    await page.locator('button:has-text("Login")').first().click();

    // Wait for login modal to appear
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    // Click NSEC login option. Use data-testid because a substring selector on
    // "NSEC" / "nsec" also matches the bunker option ("Connect a signing app
    // (Amber, nsec.app)").
    await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();

    // Wait for NSEC input modal to appear
    await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });

    // Fill the nsec input. Target the stable #nsec-input id — the modal also
    // contains a hidden `<input type="hidden" name="username">` (used for
    // browser-autocomplete UX) which would otherwise be picked by .first().
    await page.locator('#nsec-input').fill(TEST_AUTHOR.nsec);

    // Click the login button (btn-primary class)
    await page.locator('#global-private-key-modal button.btn-primary').click();

    // A successful login closes the whole modal stack on its own. This used to
    // need Escape-mashing because the modal manager transitioned back to the
    // login modal on success — don't reintroduce that workaround, it would
    // hide the regression.
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });

    await use(page);
  }
});

export { expect };

/**
 * Helper to logout the current user.
 * Clicks the profile dropdown and logs out.
 * @param {import('@playwright/test').Page} page
 */
export async function logout(page) {
  // Navigate to a page without overlapping hero elements
  await page.goto('/discover');
  await page.waitForTimeout(2000);

  // Click the profile avatar button to open dropdown (use .first() to skip mobile hamburger)
  await page.locator('.dropdown .btn-circle').first().click();

  // Wait for dropdown to open
  await page.waitForTimeout(300);

  // Click the logout button (contains "Logout" or similar text)
  await page
    .locator('.dropdown-content button')
    .filter({ hasText: /logout|abmelden/i })
    .first()
    .click();

  // Wait for logout to complete - login button should reappear (use .first() for responsive navbar)
  await expect(page.locator('button:has-text("Login")').first()).toBeVisible({ timeout: 5000 });
}

/**
 * Helper to login with an nsec.
 * @param {import('@playwright/test').Page} page
 * @param {string} nsec - The nsec to login with
 */
export async function loginWithNsec(page, nsec) {
  // Click the login button in navbar
  await page.locator('button:has-text("Login")').first().click();

  // Wait for login modal to appear
  await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

  // Click NSEC login option (data-testid avoids matching the bunker option, whose
  // label "Connect a signing app (Amber, nsec.app)" also contains the substring).
  await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();

  // Wait for NSEC input modal to appear
  await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 5000 });

  // Fill the nsec input via the stable #nsec-input id (avoids the hidden
  // username autocomplete input that .first() would otherwise pick).
  await page.locator('#nsec-input').fill(nsec);

  // Click the login button
  await page.locator('#global-private-key-modal button.btn-primary').click();

  // Wait for login to complete
  await page.waitForTimeout(1500);

  // Close any open modal
  for (let i = 0; i < 3; i++) {
    const hasOpenModal = await page.locator('dialog[open]').isVisible();
    if (hasOpenModal) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      break;
    }
  }
}

/**
 * The GlobalFAB trigger. There is no `.fab` class any more — the daisyUI
 * speed-dial was replaced by a single `btn-circle` whose accessible name comes
 * from `m.fab_open_menu()`. Note the create-hub sheet carries the *same*
 * aria-label on a `div[role="menu"]`, so the `button` qualifier is load-bearing.
 *
 * Routed through this one constant because six e2e files hard-coded the old
 * markup and all six broke together. See src/lib/components/shared/GlobalFAB.svelte.
 */
export const FAB_TRIGGER = 'button[aria-label="Open actions menu"]';

/**
 * Open the GlobalFAB create hub and wait for the sheet to be on screen.
 *
 * The FAB renders only when `getActiveUser()` is truthy and the route is not a
 * `[naddr=naddr]` detail page, `/create/*`, a chat view or `/c/messages` with a
 * thread open (src/routes/+layout.svelte:379, GlobalFAB.svelte:151) — so call
 * this from a list route while authenticated, not from a detail page.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openCreateHub(page) {
  const trigger = page.locator(FAB_TRIGGER);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expect(page.locator('div[role="menu"][aria-label="Open actions menu"]')).toBeVisible({
    timeout: 5000
  });
}

/**
 * Click a create-hub action tile by its accessible name.
 *
 * Tiles are keyed on `aria-label` (the action's `ariaLabel`), not `data-tip`:
 * `data-tip` carries the *description* and is absent entirely for actions with
 * no description (e.g. poll), so the old `button[data-tip="Create Event"]`
 * matched nothing. Names come from src/lib/config/create-actions.js — e.g.
 * 'Create new event', 'Create new calendar', 'Create poll'.
 *
 * `.first()` is load-bearing and route-dependent. `GlobalFAB`'s "Suggested"
 * section maps route-suggested ids back onto the *same* action objects the
 * "Create" section lists (`suggestedActions` at GlobalFAB.svelte:97-104 looks
 * each id up in `visibleActions`), so on `/calendar` the identical
 * 'Create new event' button renders in both sections. Both carry the same
 * aria-label and both call `runAction` on the same object, so either click is
 * equivalent.
 *
 * Note this is the *opposite* case to the event context menu, where `.first()`
 * was deliberately removed: there the matches are genuinely different actions
 * and taking the first silently clicked "Share to communities". Same operator,
 * opposite justification — check which situation you are in before copying
 * either.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} ariaLabel
 */
export async function clickCreateAction(page, ariaLabel) {
  const tile = page.locator(`div[role="menu"] button[aria-label="${ariaLabel}"]`).first();
  await expect(tile).toBeVisible({ timeout: 5000 });
  await tile.click();
}

/**
 * Helper to open the event creation modal on the calendar page.
 * @param {import('@playwright/test').Page} page
 */
export async function openEventCreationModal(page) {
  // Navigate to calendar page
  await page.goto('/calendar');
  await page.waitForTimeout(2000);

  await openCreateHub(page);
  await clickCreateAction(page, 'Create new event');

  // Wait for modal to appear
  await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5000 });
}

/**
 * Stub `/api/reader?mode=metadata` so the wizard's URL step resolves instantly
 * without hitting the network. The default stub returns "none" so the form
 * simply advances without prefilling anything.
 *
 * Callers can pass `opts.mode` to simulate metadata presence:
 *   - 'none' (default): page has no metadata; empty form after fetch
 *   - 'og': return Open Graph mapping
 *   - 'amb': return AMB JSON-LD mapping
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ mode?: 'none' | 'og' | 'amb', og?: object, amb?: object }} [opts]
 */
export async function setupMetadataMock(page, opts = {}) {
  const mode = opts.mode || 'none';
  // Playwright routes are LIFO-matched. Unroute any prior handler for this
  // pattern so repeated calls REPLACE rather than stack. This makes the
  // MOST RECENT setupMetadataMock call authoritative, regardless of call order
  // relative to navigateToAMBCreation's default install.
  await page.unroute('**/api/reader?mode=metadata*').catch(() => {});
  await page.route('**/api/reader?mode=metadata*', async (route) => {
    /** @type {any} */
    let metadata = { source: 'none' };
    if (mode === 'og') {
      metadata = {
        source: 'opengraph',
        og: opts.og || {
          title: 'Mock Page Title',
          description: 'Mock page description from OG meta',
          image: 'https://example.com/thumb.jpg',
          locale: 'en'
        }
      };
    } else if (mode === 'amb') {
      metadata = {
        source: 'amb-jsonld',
        amb: opts.amb || {}
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, metadata })
    });
  });
}

/**
 * Helper to navigate to the AMB resource creation page and advance past the new
 * intro steps (Bildungsbereich + URL) so callers land on the Basic step.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} communityNpub - The community's npub (bech32)
 * @param {{ bildungsbereich?: 'schule' | 'hochschule' | 'extra', url?: string, skipAdvance?: boolean, skipMockSetup?: boolean }} [opts]
 *   - bildungsbereich: which educational area radio to select (default: 'hochschule')
 *   - url: URL to enter on step 2 (default: synthesized per-test URL)
 *   - skipAdvance: if true, leave on step 1 so the caller can drive the wizard manually
 *   - skipMockSetup: if true, caller has already installed their own metadata
 *     mock and wants it to remain in force (default false: install "none" stub)
 */
export async function navigateToAMBCreation(page, communityNpub, opts = {}) {
  // Install default metadata stub unless the caller has already installed one
  // and doesn't want us to clobber it. (`setupMetadataMock` unroutes prior
  // handlers, so calling it unconditionally here would otherwise replace a
  // test-provided OG/AMB mock with the default "none".)
  if (!opts.skipMockSetup) {
    await setupMetadataMock(page);
  }

  // Navigate directly to the creation page with community param
  await page.goto(`/create/resource?community=${communityNpub}`);
  await page.waitForTimeout(2000);

  if (opts.skipAdvance) return;

  // Step 1: pick a Bildungsbereich
  const bildungsbereich = opts.bildungsbereich || 'hochschule';
  await selectBildungsbereich(page, bildungsbereich);
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);

  // Step 2: enter a URL — inspection runs automatically after debounce
  const url = opts.url || `https://example.com/e2e-resource-${Date.now()}`;
  await enterResourceUrl(page, url);
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);

  // Now on the Basic step — title input should be visible
  await expect(page.locator('#amb-title')).toBeVisible({ timeout: 10000 });
}

/**
 * Pick a Bildungsbereich radio on step 1 of the AMB wizard.
 * @param {import('@playwright/test').Page} page
 * @param {'schule' | 'hochschule' | 'extra'} key
 */
export async function selectBildungsbereich(page, key) {
  await page.locator(`input[name="bildungsbereich"][value="${key}"]`).check();
}

/**
 * Fill the URL input on step 2. Inspection runs automatically:
 *   - debounced 500 ms after the value changes, and
 *   - immediately on paste.
 * `fill()` in Playwright dispatches an `input` event (not a paste), so we
 * wait out the debounce plus a small buffer for the async resolve.
 * Does NOT click Next — caller decides.
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
export async function enterResourceUrl(page, url) {
  const urlInput = page.locator('#metadata-input');
  await expect(urlInput).toBeVisible({ timeout: 5000 });
  await urlInput.fill(url);
  // 500 ms debounce + async resolve. Metadata fetch is mocked → near-instant.
  await page.waitForTimeout(1000);
}

/**
 * @deprecated Use navigateToAMBCreation instead
 * Alias for backwards compatibility with existing test imports
 */
export const openAMBCreationModal = navigateToAMBCreation;

/**
 * Helper to navigate to a calendar event detail page.
 * Uses client-side navigation since SSR is disabled for naddr routes.
 * @param {import('@playwright/test').Page} page
 * @param {string} naddr
 */
export async function navigateToCalendarEvent(page, naddr) {
  // First ensure we're on a page where SPA is loaded
  const currentUrl = page.url();
  if (!currentUrl.includes('localhost')) {
    await page.goto('/discover');
    await page.waitForTimeout(2000);
  }

  // Navigate via programmatic anchor click (works with SSR-disabled routes)
  await page.evaluate((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, `/calendar/event/${naddr}`);

  // Wait for page to load (timedPool timeout + rendering)
  await page.waitForTimeout(4000);
}

// ============================================================================
// SKOS Mock Helpers
// ============================================================================

/**
 * Setup SKOS vocabulary mocks using Playwright route interception.
 * IMPORTANT: Must be called BEFORE navigating to pages that use SKOSDropdown.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function setupSKOSMocks(page) {
  // Mock learning resource types vocabulary
  await page.route('**/w3id.org/kim/hcrt/scheme.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_HCRT_VOCABULARY)
    });
  });

  // Mock subjects vocabulary
  await page.route('**/w3id.org/kim/hochschulfaechersystematik/scheme.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SUBJECTS_VOCABULARY)
    });
  });

  // Mock intended end user role vocabulary (optional, may not be used)
  await page.route('**/w3id.org/kim/intendedEndUserRole/scheme.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_END_USER_ROLE_VOCABULARY)
    });
  });
}

/**
 * Clear SKOS vocabulary cache from localStorage.
 * Useful to ensure fresh mock data is fetched.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function clearSKOSCache(page) {
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('skos_vocab_'))
      .forEach((k) => localStorage.removeItem(k));
  });
}

// ============================================================================
// AMB Creation Step Helpers
// ============================================================================

/**
 * Complete AMB wizard Basic Info step (step 3 in the new wizard; the caller is
 * expected to arrive here via `navigateToAMBCreation`, which auto-advances past
 * the new Bildungsbereich + URL steps).
 *
 * NOTE: the `identifier` field is now **read-only** and derives from the URL
 * entered on step 2; `data.identifier` is accepted only for backwards
 * compatibility with old tests and is silently ignored.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] - Form data
 * @param {string} [data.title] - Resource title (default: 'Test Educational Resource')
 * @param {string} [data.description] - Description (default: 'Test description for E2E')
 * @param {string} [data.language] - Language code (default: 'en')
 * @param {string} [data.identifier] - Ignored (see note above)
 * @param {string} [data.image] - Optional image URL
 */
export async function completeAMBStep1(page, data = {}) {
  const title = data.title || 'Test Educational Resource';
  const description = data.description || 'Test description for E2E testing';
  const language = data.language || 'en';

  await page.locator('#amb-title').fill(title);
  await page.locator('#amb-description').fill(description);
  await page.locator('#amb-language').selectOption(language);

  if (data.image) {
    await page.locator('#amb-image').fill(data.image);
  }

  // Click Next to advance to the Classification step
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);
}

/**
 * Wait for a SKOS dropdown to finish loading and be ready for interaction.
 * The dropdown button shows "Loading..." while fetching vocabulary data.
 *
 * SKOSDropdown structure:
 *   <div class="form-control">
 *     <div class="label"><span>Label Text</span></div>
 *     <div class="dropdown">
 *       <button class="select-trigger">...</button>
 *       <div class="dropdown-content">...</div>
 *     </div>
 *   </div>
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} labelText - The label text to find the dropdown (e.g., 'Resource Type')
 * @returns {Promise<import('@playwright/test').Locator>} The dropdown locator (.dropdown element)
 */
async function waitForSkosDropdownReady(page, labelText) {
  // Find the form-control wrapper that contains the label text
  const formControl = page.locator('.form-control').filter({ hasText: labelText }).first();
  // Get the dropdown element inside it
  const dropdown = formControl.locator('.dropdown');
  // Wait for the select trigger button (has .select-trigger class) to NOT show "Loading..."
  const triggerButton = dropdown.locator('button.select-trigger');
  await expect(triggerButton).toBeVisible({ timeout: 15000 });
  // Wait for loading to complete - button text should NOT contain "Loading"
  await expect(triggerButton).not.toContainText('Loading', { timeout: 15000 });
  return dropdown;
}

/**
 * Complete AMB wizard Step 2 (Classification).
 * Selects resource type and subject from SKOS dropdowns.
 * Requires SKOS mocks to be set up via setupSKOSMocks().
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] - Selection data
 * @param {string} [data.resourceType] - Resource type label (default: 'Text')
 * @param {string} [data.subject] - Subject label (default: 'Computer Science')
 * @param {string[]} [data.keywords] - Keywords to add
 */
export async function completeAMBStep2(page, data = {}) {
  const resourceType = data.resourceType || 'Text';
  const subject = data.subject || 'Computer Science';

  // Wait for step 2 to be visible
  await expect(page.locator('text=Resource Type').first()).toBeVisible({ timeout: 10000 });

  // Wait for Resource Type SKOS dropdown to finish loading
  const resourceTypeDropdown = await waitForSkosDropdownReady(page, 'Resource Type');

  // Click Resource Type dropdown trigger (use .select-trigger to avoid matching option buttons)
  await resourceTypeDropdown.locator('button.select-trigger').click();

  // Wait for THIS dropdown's content to render (scoped to avoid navbar dropdowns)
  await expect(resourceTypeDropdown.locator('.dropdown-content')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(200);

  // Select the resource type option (scoped to this dropdown)
  await resourceTypeDropdown
    .locator(`.dropdown-content button:has-text("${resourceType}")`)
    .click();
  await page.waitForTimeout(300);

  // Close dropdown by clicking outside it (on the page title)
  // Clicking the trigger toggles, which might not work reliably
  await page
    .locator('h2:has-text("Share Educational Resource"), h1:has-text("Share Educational Resource")')
    .first()
    .click();
  await page.waitForTimeout(300);

  // Wait for Subject SKOS dropdown to finish loading
  const subjectDropdown = await waitForSkosDropdownReady(page, 'Subject');

  // Click Subject dropdown trigger (use .select-trigger to avoid matching option buttons)
  await subjectDropdown.locator('button.select-trigger').click();

  // Wait for THIS dropdown's content to render (scoped to avoid navbar dropdowns)
  await expect(subjectDropdown.locator('.dropdown-content')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(200);

  // Select the subject option (scoped to this dropdown)
  await subjectDropdown.locator(`.dropdown-content button:has-text("${subject}")`).click();
  await page.waitForTimeout(300);

  // Close dropdown by clicking outside it (on the modal title)
  await page.locator('h2:has-text("Share Educational Resource")').click();
  await page.waitForTimeout(200);

  // Add keywords if provided
  if (data.keywords && data.keywords.length > 0) {
    const keywordsInput = page
      .locator('input[placeholder*="keyword"]')
      .or(page.locator('#amb-keywords'));
    for (const keyword of data.keywords) {
      await keywordsInput.fill(keyword);
      await keywordsInput.press('Enter');
      await page.waitForTimeout(200);
    }
  }

  // Click Next to advance to step 3
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);
}

/**
 * Complete AMB wizard Step 3 (Content & Creators).
 * The creator is auto-filled with the logged-in user.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] - Step data
 * @param {string[]} [data.externalUrls] - External URLs to add
 */
export async function completeAMBStep3(page, data = {}) {
  // Wait for step 3 to load
  await expect(page.getByText('Creators / Authors')).toBeVisible({
    timeout: 5000
  });

  // Add external URLs if provided
  if (data.externalUrls && data.externalUrls.length > 0) {
    const urlInput = page
      .locator('input[placeholder*="URL"]')
      .or(page.locator('input[placeholder*="https://"]'));
    for (const url of data.externalUrls) {
      await urlInput.fill(url);
      await urlInput.press('Enter');
      await page.waitForTimeout(200);
    }
  }

  // Click Next to advance to step 4
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);
}

/**
 * Complete AMB wizard Step 4 (License & Publish).
 * Selects license and clicks publish.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] - Step data
 * @param {string} [data.license] - License value (default: CC BY 4.0)
 * @param {boolean} [data.freeAccess] - Whether to check free access (default: true)
 */
export async function completeAMBStep4(page, data = {}) {
  // Wait for step 4 to load
  await expect(page.locator('#amb-license')).toBeVisible({
    timeout: 5000
  });

  // Select license if different from default
  if (data.license) {
    await page.locator('#amb-license').selectOption(data.license);
  }

  // Free access checkbox (usually checked by default)
  if (data.freeAccess !== undefined) {
    const checkbox = page
      .locator('#amb-free-access')
      .or(page.locator('input[type="checkbox"]').first());
    const isChecked = await checkbox.isChecked();
    if (data.freeAccess !== isChecked) {
      await checkbox.click();
    }
  }

  // Click Publish to submit
  await page.locator('button:has-text("Publish Resource")').click();
}

// ============================================================================
// Relay Override Helpers
// ============================================================================

/**
 * Add a relay override for a specific content category via the Settings UI.
 * Navigates to Settings, finds the app-specific relay section, adds the relay,
 * and publishes a kind 30002 event.
 *
 * @param {import('@playwright/test').Page} page - Playwright page (must be authenticated)
 * @param {string} category - 'calendar' | 'educational' | 'communikey' | 'longform'
 * @param {string} relayUrl - The relay URL to add (e.g., 'ws://localhost:17003')
 */
export async function addRelayOverride(page, category, relayUrl) {
  // Navigate to Settings
  await page.goto('/settings');
  await page.waitForTimeout(3000);

  // Category labels as they appear in the UI
  const categoryLabels = {
    calendar: 'Calendar Events',
    educational: 'Educational Resources',
    communikey: 'Community Events',
    longform: 'Articles & Long-form Content'
  };
  const label = categoryLabels[category];
  if (!label) throw new Error(`Unknown category: ${category}`);

  // Wait for App-Specific Relays section to load and scroll to it
  await expect(page.locator('text=App-Specific Relays')).toBeVisible({ timeout: 15000 });
  await page.locator('text=App-Specific Relays').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Find the category section (rounded-lg bg-base-100 p-4 div containing the label)
  const categorySection = page.locator('.rounded-lg.bg-base-100.p-4').filter({ hasText: label });
  await expect(categorySection).toBeVisible({ timeout: 5000 });
  await categorySection.scrollIntoViewIfNeeded();

  // Click "Add relay" button to enter editing mode
  await categorySection.locator('button:has-text("Add relay")').click();
  await page.waitForTimeout(500);

  // Wait for the input field to appear
  const relayInput = categorySection.locator('input[placeholder*="relay.example.com"]');
  await expect(relayInput).toBeVisible({ timeout: 5000 });

  // Type the relay URL
  await relayInput.fill(relayUrl);

  // Click Add button (in the join group)
  await categorySection.locator('.join button:has-text("Add")').click();
  await page.waitForTimeout(1000);

  // The relay should now be added (no separate Save step needed - it auto-saves)
  // Verify the relay appears in the list
  await expect(categorySection.locator(`text=${relayUrl}`).first()).toBeVisible({ timeout: 5000 });
}

/**
 * Remove all relay overrides for a category (reset to defaults).
 *
 * @param {import('@playwright/test').Page} page - Playwright page (must be authenticated)
 * @param {string} category - 'calendar' | 'educational' | 'communikey' | 'longform'
 */
export async function resetRelayOverride(page, category) {
  await page.goto('/settings');
  await page.waitForTimeout(2000);

  await expect(page.locator('text=App-Specific Relays')).toBeVisible({ timeout: 10000 });

  const categoryLabels = {
    calendar: 'Calendar Events',
    educational: 'Educational Resources',
    communikey: 'Community Events',
    longform: 'Articles & Long-form Content'
  };
  const label = categoryLabels[category];

  const categorySection = page.locator('.bg-base-100').filter({ hasText: label });

  // Check if there's an override to reset
  const hasOverride = await categorySection.locator('button:has-text("Reset")').isVisible();
  if (hasOverride) {
    await categorySection.locator('button:has-text("Reset")').click();
    await page.waitForTimeout(1500);
  }
}

/**
 * Trigger infinite scroll on the current page by scrolling to the bottom.
 * Waits for the sentinel element to become visible and scrolls to it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [times=1] - Number of times to trigger scroll
 * @returns {Promise<void>}
 */
export async function triggerInfiniteScroll(page, times = 1) {
  for (let i = 0; i < times; i++) {
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Wait for potential new content to load
    await page.waitForTimeout(1500);
  }
}

/**
 * Get the count of content cards currently displayed on the discover page.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getContentCardCount(page) {
  return await page.locator('.card').count();
}
