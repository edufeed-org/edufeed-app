/**
 * E2E test for Concord private channels (Task 15).
 *
 * Two real browser contexts drive the full lifecycle over the real strfry
 * relay (docker compose, ws://localhost:17003 — see e2e/global-setup.js and
 * playwright.config.js's CONCORD_RELAYS wiring): an owner creates a
 * community + a private channel, invites the guest via a link, the guest
 * joins, both exchange messages, then the owner bans the guest and the test
 * verifies the guest stops receiving new messages (key rotation severance).
 *
 * This is also the deferred runtime smoke test for the app's
 * applesauce-relay@6.2.1 `pool` instance being passed into ConcordClient
 * (see src/lib/concord/client.svelte.js) — a structural type mismatch is
 * cast away there (`pool: /** @type {any} *\/ (pool)`) and this is the first
 * test that actually exercises that pool at runtime (join, publish, and
 * subscribe all flow through it). If the pool were runtime-incompatible with
 * applesauce-concord's internal RelayPool expectations, this test would fail
 * with a pool-shaped error rather than a selector/timing issue.
 *
 * Locale note: e2e Chromium reports en-US, so paraglide resolves to the
 * English message catalog (messages/en.json) even though 'de' is the base
 * locale — text assertions below use the English strings.
 *
 * Double-mount note: `src/routes/c/+layout.svelte` renders
 * `{@render children()}` up to 3× (desktop / mobile-logged-in / mobile-anon
 * responsive variants — see docs/superpowers or the
 * community-layout-double-mount project note), so every element inside the
 * `/c/[pubkey]` tree (including all of PrivateChannelsView/ChannelChat) is
 * mounted multiple times with CSS hiding the inactive variants. `vis()`
 * below scopes every such locator to the one actually-visible instance.
 */
import { test, expect } from '@playwright/test';
import { loginWithNsec } from './fixtures.js';
import { generateSecretKey, nip19 } from 'nostr-tools';

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
 * Create a community owned by the currently logged-in keypair via the UI
 * ("Use Current Keypair" flow), mirroring e2e/community-creation.test.js's
 * "can complete community creation" test verbatim. Returns the resulting
 * community npub, read back from the post-creation URL (not re-derived
 * locally) so it's guaranteed to match whatever the app canonicalized.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} community npub
 */
async function createCommunityWithCurrentKeypair(page) {
  await page.goto('/discover');
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="tab-communities"]').click();
  await page.waitForTimeout(2000);

  const createButton = page.locator('button', { hasText: 'Create Community' });
  await expect(createButton).toBeVisible({ timeout: 10000 });
  await createButton.click();
  await page.waitForTimeout(500);

  const useCurrentButton = page.locator('button', { hasText: 'Use Current Keypair' });
  await useCurrentButton.click();
  await page.waitForTimeout(500);

  const nextButton = page.locator('.modal-box button', { hasText: 'Next' });
  await nextButton.click();
  await page.waitForTimeout(500);

  const confirmCreateButton = page.locator('.modal-box button', { hasText: 'Create Community' });
  await expect(confirmCreateButton).toBeVisible({ timeout: 5000 });
  await confirmCreateButton.click();

  await page.waitForURL(/\/c\//, { timeout: 15000 });
  const url = new URL(page.url());
  const npub = url.pathname.split('/').filter(Boolean)[1];
  expect(npub).toMatch(/^npub1/);
  return npub;
}

test.describe('concord private channels', () => {
  test('create → invite via link → join → exchange → ban', async ({ browser }) => {
    test.setTimeout(240_000);
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();

    const ownerSk = generateSecretKey();
    const ownerNsec = nip19.nsecEncode(ownerSk);
    const guestNsec = nip19.nsecEncode(generateSecretKey());

    // --- owner: login, create a community owned by their own keypair
    await bootstrapLogin(owner, ownerNsec);
    const communityNpub = await createCommunityWithCurrentKeypair(owner);

    // --- owner: open the private channels tab directly (avoids clicking
    // through the sidebar, which is one of the triple-mounted trees)
    await owner.goto(`/c/${communityNpub}?view=channels`);
    await expect(vis(owner.getByTestId('concord-new-channel'))).toBeVisible({ timeout: 20_000 });

    // --- owner: create wizard (name → skip invitees → ack → create)
    await vis(owner.getByTestId('concord-new-channel')).click();
    await vis(owner.getByTestId('concord-channel-name-input')).fill('E2E Secret');
    await vis(owner.getByTestId('concord-wizard-next')).click();
    await owner.waitForTimeout(300);
    await vis(owner.getByTestId('concord-wizard-next')).click();
    await owner.waitForTimeout(300);
    await vis(owner.getByTestId('concord-wizard-ack-checkbox')).check();
    await vis(owner.getByTestId('concord-wizard-create')).click();
    await expect(vis(owner.getByText('E2E Secret'))).toBeVisible({ timeout: 20_000 });
    await expect(vis(owner.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 20_000 });

    // --- owner: invite link
    await vis(owner.getByTestId('concord-chat-menu')).click();
    await vis(owner.getByTestId('concord-menu-invite')).click();
    const link = await vis(owner.getByTestId('concord-invite-link')).textContent();
    expect(link).toContain('/invite/');
    // Close the invite sheet so it doesn't block the chat composer below.
    // Scope to .modal-box: the chat pane's key-backup bar also has a ✕.
    await vis(owner.locator('.modal-box').getByRole('button', { name: '✕' })).click();
    await expect(owner.getByTestId('concord-invite-link')).not.toBeVisible();

    // --- guest: login, follow the invite link, join
    await bootstrapLogin(guest, guestNsec);
    await guest.goto(/** @type {string} */ (link));
    await expect(guest.getByTestId('concord-join-button')).toBeEnabled({ timeout: 20_000 });
    await guest.getByTestId('concord-join-button').click();
    await expect(guest.getByText(/Beigetreten|Joined/)).toBeVisible({ timeout: 30_000 });

    // --- guest: navigate to the same community's channels view
    await guest.goto(`/c/${communityNpub}?view=channels`);
    await expect(vis(guest.getByText('E2E Secret'))).toBeVisible({ timeout: 30_000 });
    await expect(vis(guest.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 30_000 });

    // --- exchange messages both directions
    const ownerInput = vis(owner.getByTestId('concord-chat-input'));
    await ownerInput.fill('hello from owner');
    await ownerInput.press('Enter');
    await expect(vis(guest.getByText('hello from owner'))).toBeVisible({ timeout: 30_000 });

    const guestInput = vis(guest.getByTestId('concord-chat-input'));
    await guestInput.fill('hello from guest');
    await guestInput.press('Enter');
    await expect(vis(owner.getByText('hello from guest'))).toBeVisible({ timeout: 30_000 });

    // --- owner: ban the guest (rotates the channel key)
    await vis(owner.getByTestId('concord-members-button')).click();
    await expect(vis(owner.getByTestId('concord-member-ban'))).toBeVisible({ timeout: 10_000 });
    await vis(owner.getByTestId('concord-member-ban')).click();
    await vis(owner.getByTestId('concord-confirm-action')).click();
    await expect(vis(owner.getByText(/neues Schloss|new lock/))).toBeVisible({ timeout: 30_000 });
    // Close the members modal so it doesn't block the chat composer below.
    // (Same .modal-box scoping as the invite sheet above.)
    await vis(owner.locator('.modal-box').getByRole('button', { name: '✕' })).click();

    // --- post-ban message: owner sees it, banned guest must not decrypt it
    await ownerInput.fill('after the ban');
    await ownerInput.press('Enter');
    await expect(vis(owner.getByText('after the ban'))).toBeVisible({ timeout: 30_000 });
    // Bounded wait for rekey delivery to settle, then assert the negative —
    // the guest's client never receives the new channel key, so this
    // message (encrypted under the rotated key) must never decrypt/render.
    await guest.waitForTimeout(10_000);
    await expect(guest.getByText('after the ban')).not.toBeVisible();

    await ownerContext.close();
    await guestContext.close();
  });
});
