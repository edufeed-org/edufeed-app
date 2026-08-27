/**
 * E2E tests for the moderated-community lifecycle + type-flip (Task 10).
 *
 * Runs against the shared webServer, whose env now carries GROUPS_ENABLED=true
 * + GROUPS_RELAYS=ws://localhost:17004 (see playwright.config.js) — an
 * in-process NIP-29 mock relay started by e2e/global-setup.js
 * (e2e/nip29-relay.js, Task 9). This lights up CreateCommunityModal's
 * flag-gated 'type' step for every wizard flow on this server (see
 * moderatedCreationAvailable() in src/lib/groups/feature.js), which is why
 * community-creation.test.js has to force group features off for its own
 * hermeticity (see that file's header comment) — this file is the opposite:
 * it deliberately exercises the type step live.
 *
 * Two specs, copying concord-channels.test.js's scaffolding (two browser
 * contexts, the vis() triple-mount helper, createCommunityWithCurrentKeypair
 * shape, bootstrapLogin/loginWithNsec, English strings, fresh keys per run):
 *
 *   1. Moderated lifecycle: owner creates a MODERATED community through the
 *      wizard, mints an invite code, a second (fresh-key) context redeems it
 *      via the community hero, and the owner's MembershipPane reflects the
 *      new member.
 *   2. Flip lifecycle: owner creates an OPEN community, flips it to
 *      moderated via Settings, then flips back to open.
 *
 * Locale note (mirrors concord-channels.test.js): e2e Chromium reports
 * en-US, so paraglide resolves to messages/en.json even though 'de' is the
 * base locale — text assertions below use the English strings.
 *
 * Double-mount note (mirrors concord-channels.test.js): `src/routes/c/+layout.svelte`
 * renders `{@render children()}` up to 3x for responsive variants, so every
 * element inside `/c/[pubkey]` is mounted multiple times with CSS hiding the
 * inactive variants. `vis()` scopes every such locator to the one
 * actually-visible instance. CreateCommunityModal (rendered from /discover)
 * is NOT inside that tree, so its locators don't need vis().
 */
import { test, expect } from '@playwright/test';
import { loginWithNsec } from './fixtures.js';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

/**
 * Scope a locator to its visible match (community pages triple-mount their
 * content tree for responsive variants — see header comment).
 * @param {import('@playwright/test').Locator} locator
 */
function vis(locator) {
  return locator.filter({ visible: true }).first();
}

/**
 * Log a fresh nsec into a page that hasn't loaded the app yet.
 * @param {import('@playwright/test').Page} page
 * @param {string} nsec
 */
async function bootstrapLogin(page, nsec) {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await loginWithNsec(page, nsec);
}

/**
 * Create a community owned by the currently logged-in keypair via the UI,
 * driving the wizard's 'type' step (visible because GROUPS_ENABLED is on for
 * this server — see file header) explicitly rather than relying on its
 * default. For 'moderated', also drives the skippable 'people' step (no
 * invitees — see ContactSearchInput below, they're added post-creation via
 * the invite-code flow this file exercises). Returns the resulting
 * community npub, read back from the post-creation URL.
 * @param {import('@playwright/test').Page} page
 * @param {'open' | 'moderated'} communityType
 * @returns {Promise<string>} community npub
 */
async function createCommunityViaWizard(page, communityType) {
  await page.goto('/discover');
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="tab-communities"]').click();
  await page.waitForTimeout(2000);

  const createButton = page.locator('button', { hasText: 'Create Community' });
  await expect(createButton).toBeVisible({ timeout: 10000 });
  await createButton.click();
  await page.waitForTimeout(500);

  // selectCurrentKeypair() auto-advances past step 0, landing directly on
  // the 'type' step (typeStepVisible is true on this server).
  const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
  await useCurrentButton.click();
  await page.waitForTimeout(500);

  const typeTestId =
    communityType === 'moderated' ? 'community-type-moderated' : 'community-type-open';
  const typeCard = page.locator(`[data-testid="${typeTestId}"]`);
  await expect(typeCard).toBeVisible({ timeout: 10000 });
  await typeCard.click();
  await page.waitForTimeout(300);

  const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
  await nextButton.click(); // type -> settings
  await page.waitForTimeout(500);

  // Settings step: content types are pre-enabled and the default relay is
  // pre-populated (see community-creation.test.js's equivalent assertions),
  // and for moderated the default access tier radio is already 'members' —
  // no form interaction needed here.
  await nextButton.click(); // settings -> people (moderated) | confirm (open)
  await page.waitForTimeout(500);

  if (communityType === 'moderated') {
    await expect(page.locator('[data-testid="wizard-people-step"]')).toBeVisible({
      timeout: 10000
    });
    await nextButton.click(); // people -> confirm (skip: no invitees)
    await page.waitForTimeout(500);
  }

  const confirmCreateButton = page.locator('.modal-box button', { hasText: 'Create Community' });
  await expect(confirmCreateButton).toBeVisible({ timeout: 10000 });
  await confirmCreateButton.click();

  // Moderated creation provisions a NIP-29 root group first (relay
  // round-trip + a confirm query), so give this more room than a plain
  // create.
  await page.waitForURL(/\/c\//, { timeout: 30_000 });
  const url = new URL(page.url());
  const npub = url.pathname.split('/').filter(Boolean)[1];
  expect(npub).toMatch(/^npub1/);
  return npub;
}

test.describe('moderated community lifecycle', () => {
  test('create moderated → mint invite → guest redeems → owner sees member', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();

    const ownerNsec = nip19.nsecEncode(generateSecretKey());
    const guestSk = generateSecretKey();
    const guestPubkeyHex = getPublicKey(guestSk);
    const guestNsec = nip19.nsecEncode(guestSk);

    // --- owner: login, create a MODERATED community owned by their own keypair
    await bootstrapLogin(owner, ownerNsec);
    const communityNpub = await createCommunityViaWizard(owner, 'moderated');

    // --- owner: settings shows the Typ card in the moderated state
    await owner.goto(`/c/${communityNpub}?view=settings`);
    const typeCard = vis(owner.getByTestId('settings-type-card'));
    await expect(typeCard).toBeVisible({ timeout: 20_000 });
    await expect(typeCard.locator('p.font-semibold')).toHaveText('Moderated');

    // --- owner: mint an invite code from the MembershipPane
    const membershipPane = vis(owner.getByTestId('membership-pane'));
    await expect(membershipPane).toBeVisible({ timeout: 20_000 });
    const createInviteButton = vis(owner.getByTestId('membership-invite-create'));
    await expect(createInviteButton).toBeEnabled({ timeout: 20_000 });
    await createInviteButton.click();
    const codeLocator = vis(owner.getByTestId('membership-invite-code'));
    await expect(codeLocator).toBeVisible({ timeout: 20_000 });
    const inviteCode = (await codeLocator.textContent())?.trim();
    expect(inviteCode).toBeTruthy();

    // --- guest: login with a fresh key, visit the community — not a member yet.
    // The community was created moments ago in this same run, so the guest's
    // addressLoader fetch of its kind-10222 (a relay round-trip on a fresh
    // browser, no local EventStore/IDB warm cache) can race relay indexing
    // under sandbox contention — poll via reload rather than one long wait.
    await bootstrapLogin(guest, guestNsec);
    const inviteToggle = vis(guest.getByRole('button', { name: 'Redeem invite code' }));
    await expect(async () => {
      await guest.goto(`/c/${communityNpub}`);
      await expect(inviteToggle).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 30_000 });
    await expect(vis(guest.getByText('Member', { exact: true }))).not.toBeVisible();

    // --- guest: redeem the invite code via the hero
    await inviteToggle.click();
    const codeInput = vis(guest.getByPlaceholder('Code'));
    await expect(codeInput).toBeVisible({ timeout: 10_000 });
    await codeInput.fill(/** @type {string} */ (inviteCode));
    await vis(guest.getByRole('button', { name: 'Redeem', exact: true })).click();

    // --- guest: roster fan-out from the mock relay — member badge appears
    await expect(vis(guest.getByText('Member', { exact: true }))).toBeVisible({
      timeout: 30_000
    });

    // --- owner: MembershipPane reflects the new member (poll via reload —
    // the mock relay fans out the updated roster live to open subscriptions,
    // but a reload is the robust fallback if that subscription isn't kept
    // open across the wait above).
    await expect(async () => {
      await owner.reload();
      await expect(membershipPane).toContainText('1 members', { timeout: 5000 });
    }).toPass({ timeout: 30_000 });

    const manageMembersButton = vis(owner.getByTestId('membership-manage-members'));
    await expect(manageMembersButton).toBeEnabled({ timeout: 10_000 });
    await manageMembersButton.click();
    const memberRow = vis(
      owner.locator(`[data-testid="member-row"][data-pubkey="${guestPubkeyHex}"]`)
    );
    await expect(memberRow).toBeVisible({ timeout: 15_000 });

    await ownerContext.close();
    await guestContext.close();
  });
});

test.describe('community type flip lifecycle', () => {
  test('open → moderated → open', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const owner = await context.newPage();

    await bootstrapLogin(owner, nip19.nsecEncode(generateSecretKey()));
    const communityNpub = await createCommunityViaWizard(owner, 'open');

    await owner.goto(`/c/${communityNpub}?view=settings`);
    const typeCard = vis(owner.getByTestId('settings-type-card'));
    const typeTitle = typeCard.locator('p.font-semibold');
    await expect(typeCard).toBeVisible({ timeout: 20_000 });
    await expect(typeTitle).toHaveText('Open');

    // --- flip to moderated (provisions a root NIP-29 group)
    await vis(owner.getByTestId('settings-flip-to-moderated')).click();
    await vis(owner.getByTestId('settings-flip-confirm')).click();
    await expect(typeTitle).toHaveText('Moderated', { timeout: 30_000 });

    // --- flip back to open (confirm dialog lists channels, none here)
    await vis(owner.getByTestId('settings-flip-to-open')).click();
    await vis(owner.getByTestId('settings-flip-confirm')).click();
    await expect(typeTitle).toHaveText('Open', { timeout: 30_000 });

    await context.close();
  });
});
