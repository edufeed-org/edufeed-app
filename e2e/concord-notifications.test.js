/**
 * E2E: Concord unread badges + mention tier (spec §8 — the ONE e2e flow).
 *
 * Reuses the two-context owner/guest flow, wizard steps, invite round trip,
 * and env preconditions from e2e/concord-channels.test.js (real strfry relay,
 * CONCORD_ENABLED/CONCORD_RELAYS wired in playwright.config.js, nix shell for
 * Chromium). That file's helpers (`vis()`, `bootstrapLogin`,
 * `createCommunityWithCurrentKeypair`) are duplicated here rather than
 * imported — e2e spec files in this project are self-contained, none import
 * from one another.
 *
 * OS toasts are deliberately NOT tested here (headless Notification API is
 * unreliable); their gate logic is unit-tested in
 * concord-notification-helpers.test.js.
 *
 * Locale note: e2e Chromium reports en-US, so paraglide resolves to the
 * English message catalog — text assertions below use the English strings
 * ("Home", "Channels", "Reply").
 *
 * Double-mount note: `src/routes/c/+layout.svelte` renders its children up
 * to 3× for responsive variants (desktop / mobile-logged-in / mobile-anon),
 * so every testid inside the `/c/[pubkey]` tree is mounted multiple times
 * with CSS hiding the inactive variants. `vis()` scopes every such locator
 * to the one actually-visible instance. Assertions that need to hold across
 * ALL mounts (e.g. "no unread dot anywhere") deliberately skip `vis()` and
 * check the raw locator instead — ConcordUnreadDot renders no DOM node at
 * all when its flags are false, so the count is 0 regardless of mount count.
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
 * ("Use Current Keypair" flow) — verbatim copy of concord-channels.test.js's
 * helper of the same name.
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

/**
 * Click a top-level community content tab (desktop ContentNavSidebar's
 * `nav.menu`) by its visible label, scoped to the one visible triple-mount
 * instance. Used to move the owner off the channel (so it's no longer the
 * "active channel") and back onto it, exercising the same live-notification
 * path a backgrounded tab would.
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function clickContentTab(page, label) {
  await vis(page.locator('nav.menu button', { hasText: label })).click();
  await page.waitForTimeout(500);
}

test.describe('Concord notifications', () => {
  test('unread dot lights, clears on open, survives reload; reply lights mention pill', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();

    const ownerNsec = nip19.nsecEncode(generateSecretKey());
    const guestNsec = nip19.nsecEncode(generateSecretKey());

    // --- owner: login, create a community + private channel, mint an invite
    await bootstrapLogin(owner, ownerNsec);
    const communityNpub = await createCommunityWithCurrentKeypair(owner);

    await owner.goto(`/c/${communityNpub}?view=channels`);
    await expect(vis(owner.getByTestId('concord-new-channel'))).toBeVisible({ timeout: 20_000 });
    await vis(owner.getByTestId('concord-new-channel')).click();
    await vis(owner.getByTestId('concord-channel-name-input')).fill('Notif Test');
    await vis(owner.getByTestId('concord-wizard-next')).click();
    await owner.waitForTimeout(300);
    await vis(owner.getByTestId('concord-wizard-next')).click();
    await owner.waitForTimeout(300);
    await vis(owner.getByTestId('concord-wizard-ack-checkbox')).check();
    await vis(owner.getByTestId('concord-wizard-create')).click();
    await expect(vis(owner.getByText('Notif Test'))).toBeVisible({ timeout: 20_000 });
    await expect(vis(owner.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 20_000 });

    await vis(owner.getByTestId('concord-chat-menu')).click();
    await vis(owner.getByTestId('concord-menu-invite')).click();
    const link = await vis(owner.getByTestId('concord-invite-link')).textContent();
    expect(link).toContain('/invite/');
    // Close the invite sheet so it doesn't block the chat composer below.
    await vis(owner.locator('.modal-box').getByRole('button', { name: '✕' })).click();
    await expect(owner.getByTestId('concord-invite-link')).not.toBeVisible();

    // --- guest: login, join via the invite link, land on the channel
    await bootstrapLogin(guest, guestNsec);
    await guest.goto(/** @type {string} */ (link));
    await expect(guest.getByTestId('concord-join-button')).toBeEnabled({ timeout: 20_000 });
    await guest.getByTestId('concord-join-button').click();
    await expect(guest.getByText(/Beigetreten|Joined/)).toBeVisible({ timeout: 30_000 });
    await guest.goto(`/c/${communityNpub}?view=channels`);
    await expect(vis(guest.getByText('Notif Test'))).toBeVisible({ timeout: 30_000 });
    await expect(vis(guest.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 30_000 });

    // --- owner: leave the channel (Home tab) so it's no longer "active"
    await clickContentTab(owner, 'Home');
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);
    await expect(owner.locator('[data-testid="concord-mention-pill"]')).toHaveCount(0);

    // --- guest sends a message while owner is elsewhere: owner's Channels
    // tab / rail lights up with the neutral unread dot
    const guestInput = vis(guest.getByTestId('concord-chat-input'));
    await guestInput.fill('are you there?');
    await guestInput.press('Enter');
    await expect(vis(owner.getByTestId('concord-unread-dot'))).toBeVisible({ timeout: 30_000 });

    // --- owner opens the channels tab: the lone channel auto-selects and is
    // marked read, clearing the dot everywhere
    await clickContentTab(owner, 'Channels');
    await expect(vis(owner.getByText('are you there?'))).toBeVisible({ timeout: 30_000 });
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);

    // --- owner leaves again, then reloads: the read marker must have been
    // persisted to IDB, not just held in the now-gone in-memory session
    await clickContentTab(owner, 'Home');
    await owner.reload();
    await owner.waitForTimeout(3000);
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);
    await expect(owner.locator('[data-testid="concord-mention-pill"]')).toHaveCount(0);

    // --- owner posts, then leaves; guest replies to that specific message
    // (p-tags the owner) — the mention pill must light even off-channel
    await clickContentTab(owner, 'Channels');
    const ownerInput = vis(owner.getByTestId('concord-chat-input'));
    await ownerInput.fill('reply to me please');
    await ownerInput.press('Enter');
    await expect(vis(owner.getByText('reply to me please'))).toBeVisible({ timeout: 30_000 });
    await clickContentTab(owner, 'Home');

    const targetMessage = vis(guest.locator('.chat').filter({ hasText: 'reply to me please' }));
    await expect(targetMessage).toBeVisible({ timeout: 30_000 });
    await targetMessage.hover();
    await targetMessage.getByTitle('Reply').click();
    const guestReplyInput = vis(guest.getByTestId('concord-chat-input'));
    await guestReplyInput.fill('here I am');
    await guestReplyInput.press('Enter');

    await expect(vis(owner.getByTestId('concord-mention-pill'))).toBeVisible({ timeout: 30_000 });

    await ownerContext.close();
    await guestContext.close();
  });
});
