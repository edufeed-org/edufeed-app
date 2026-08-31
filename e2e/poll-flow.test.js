/**
 * E2E tests for NIP-88 polls (kind 1068).
 *
 * Two tests:
 *
 * 1. **Smoke** — verifies the Create poll tile exists in the GlobalFAB create
 *    hub with the expected accessible name. Runs at the default viewport.
 *    Cheap insurance that the FAB → modalStore wiring is intact.
 *
 * 2. **Full happy path** — drives the real flow end-to-end against the
 *    Docker strfry relay (ws://localhost:17003 — see playwright.config.js
 *    FALLBACK_RELAYS). Logs in as TEST_AUTHOR, opens the modal via FAB,
 *    fills a poll, publishes (real kind 1068 hits the relay), verifies
 *    PollCard renders on the resulting nevent route, casts a vote (real
 *    kind 1018), and verifies the tally updates to 1 voter.
 *
 *    The enlarged viewport (1280×1400) is a leftover from the daisyUI
 *    speed-dial, whose 9-button column-reverse stack clipped the default
 *    720px height. GlobalFAB replaced it with a scrollable sectioned sheet
 *    (max-h-[80vh]), so the clipping is gone; the viewport is kept only
 *    because the rest of this test's geometry was tuned against it.
 *
 *    KNOWN FLAKINESS: the UI-driven nsec login flow (loginWithNsec) is
 *    globally flaky in this E2E env — sometimes the app stays in the
 *    "loading quote" splash and curatedReady never fires, so body.app-ready
 *    is never set. This is not specific to polls; chat/comment auth tests
 *    have the same pattern. When it fails on retry too, re-run after the
 *    Docker relays settle. The test is structurally correct.
 *
 * Unit/component tests cover finer-grained behavior:
 *   - src/lib/__tests__/polls.test.js                 (tallyPollVotes)
 *   - src/lib/__tests__/poll-publish-relays.test.js   (relay union)
 *   - src/lib/components/__tests__/PollCreateModal.test.js
 *   - src/lib/components/__tests__/PollCard.test.js
 *   - src/lib/components/__tests__/GlobalFAB.test.js  (poll button render)
 */
import { test as base, expect } from '@playwright/test';
import { loginWithNsec, FAB_TRIGGER, openCreateHub, clickCreateAction } from './fixtures.js';
import { TEST_AUTHOR } from './test-data.js';

base.describe('Poll FAB - Smoke', () => {
  base('Create poll button is wired into the FAB', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    await loginWithNsec(page, TEST_AUTHOR.nsec);

    // Wait for app initialization to complete (body.app-ready set by +layout.svelte
    // when curatedReady fires). This is more robust than checking the navbar
    // avatar because the splash/loading screen can mask DOM elements.
    await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
      timeout: 30_000
    });

    await page.goto('/calendar');
    // body.app-ready persists across navigation; FAB existence implies
    // authenticated state (FAB is conditionally rendered on getActiveUser()).
    await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
      timeout: 30_000
    });
    await expect(page.locator(FAB_TRIGGER)).toBeVisible({ timeout: 15_000 });

    await openCreateHub(page);

    // The tile is keyed on aria-label, not data-tip: the poll action has no
    // `description` in create-actions.js, so no tooltip attribute is rendered.
    await expect(page.locator('div[role="menu"] button[aria-label="Create poll"]')).toBeVisible();
  });
});

base.describe('Poll - Full happy path', () => {
  base('publish poll → vote → tally updates', async ({ page }) => {
    // Enlarged viewport so the 9-button FAB stack fits and the Poll button
    // (~7th up) is in-viewport for Playwright clicks. See file header.
    await page.setViewportSize({ width: 1280, height: 1400 });

    await page.goto('/');
    await page.waitForTimeout(2000);
    await loginWithNsec(page, TEST_AUTHOR.nsec);
    await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
      timeout: 30_000
    });

    await page.goto('/calendar');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
      timeout: 30_000
    });
    await expect(page.locator(FAB_TRIGGER)).toBeVisible({ timeout: 15_000 });

    // Open the Create Poll modal.
    await openCreateHub(page);
    await clickCreateAction(page, 'Create poll');
    await expect(page.locator('dialog[open] .modal-box')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('dialog[open] h3:has-text("Create poll")')).toBeVisible();

    // Fill the question.
    const question = `E2E test poll: ${Date.now()}`;
    await page.locator('dialog[open] textarea').first().fill(question);

    // Fill the two default options.
    const optionInputs = page.locator('dialog[open] input[placeholder^="Option"]');
    await expect(optionInputs).toHaveCount(2);
    await optionInputs.nth(0).fill('Option A');
    await optionInputs.nth(1).fill('Option B');

    // Submit. The modal closes and the app navigates to /<nevent> for the
    // newly published poll.
    await page.locator('dialog[open] button:has-text("Publish poll")').click();

    // Wait for navigation away from /calendar to the nevent route.
    await expect(page).toHaveURL(/\/nevent1/, { timeout: 15_000 });

    // PollCard renders the question.
    const pollQuestion = page.locator('[data-testid="poll-question"]');
    await expect(pollQuestion).toHaveText(question, { timeout: 15_000 });

    // Pre-vote: 0 voters.
    await expect(page.locator('text=0 voters')).toBeVisible();

    // Cast a vote on Option A. PollCard renders option choices as buttons
    // before the user has voted; after voting they become percentage rows.
    await page.locator('button:has-text("Option A")').first().click();
    await page.locator('button:has-text("Cast vote")').click();

    // After the kind 1018 lands in eventStore (optimistic), tally flips to
    // 1 voter and Option A shows 100% with a ✓.
    await expect(page.locator('text=1 voter')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=100%').first()).toBeVisible();
    await expect(page.locator('text=✓ Option A')).toBeVisible();
  });
});
