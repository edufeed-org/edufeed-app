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
 * TWO channels are load-bearing for observing the channel-ROW dot:
 * PrivateChannelsView falls back to `channels[0]` (alphabetical, 'de') only
 * when this session has no stored selection for the community; otherwise it
 * re-derives the shared per-community selection (`active-channel.svelte.js`,
 * session-only, survives unmount/remount across tab switches — see
 * bff91f2c) and marks THAT channel read on (re)mount. With a single channel
 * the row dot would clear the instant the view opens either way, so a
 * second channel is needed to observe an unread ROW dot at all. The guest's
 * channel is named to sort SECOND ("Beta Talk" after "Alpha Planung"), and
 * the test explicitly reselects Alpha after creating Beta (see below) so
 * that the later Kanäle remount lands on Alpha instead of the
 * still-selected-from-creation Beta, leaving Beta's unread row dot standing
 * until the row is explicitly clicked.
 *
 * The invite link is channel-scoped (ChannelInviteSheet gets the ACTIVE
 * channel), so minting it right after creating Beta — which onCreated makes
 * active — grants the guest exactly Beta's key. Alpha stays owner-only.
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
 * Run the 3-step channel wizard (name → skip invitees → ack → create) and
 * wait for the resulting channel chat — same steps as
 * concord-channels.test.js. The wizard's onCreated selects the new channel,
 * so on return the NEW channel is the active one.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function createChannel(page, name) {
  await vis(page.getByTestId('concord-new-channel')).click();
  await vis(page.getByTestId('concord-channel-name-input')).fill(name);
  await vis(page.getByTestId('concord-wizard-next')).click();
  await page.waitForTimeout(300);
  await vis(page.getByTestId('concord-wizard-next')).click();
  await page.waitForTimeout(300);
  await vis(page.getByTestId('concord-wizard-ack-checkbox')).check();
  await vis(page.getByTestId('concord-wizard-create')).click();
  await expect(vis(page.getByText(name))).toBeVisible({ timeout: 20_000 });
  await expect(vis(page.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 20_000 });
}

/**
 * Click a top-level community content tab (desktop ContentNavSidebar's
 * `nav.menu`) by its visible label, scoped to the one visible triple-mount
 * instance.
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function clickContentTab(page, label) {
  const tab = vis(page.locator('nav.menu button', { hasText: label }));
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await page.waitForTimeout(500);
}

/**
 * Locator for a channel's rail row (the `<aside>` channel list), scoped to
 * the visible mount.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
function channelRow(page, name) {
  return vis(page.locator('aside button', { hasText: name }));
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

    // --- owner: login, create a community + TWO channels (see header — the
    // second channel makes the ROW dot observable past auto-select)
    await bootstrapLogin(owner, ownerNsec);
    const communityNpub = await createCommunityWithCurrentKeypair(owner);

    await owner.goto(`/c/${communityNpub}?view=channels`);
    await expect(vis(owner.getByTestId('concord-new-channel'))).toBeVisible({ timeout: 20_000 });
    await createChannel(owner, 'Alpha Planung');

    // Post into Alpha now (while it's active) — this message doubles as the
    // post-reload readiness signal: Alpha is what auto-selects on a fresh
    // Kanäle mount, so seeing this text again after reload proves the rumor
    // history re-hydrated from IDB before we assert on badge absence.
    const ownerInput = () => vis(owner.getByTestId('concord-chat-input'));
    await ownerInput().fill('alpha checkpoint');
    await ownerInput().press('Enter');
    await expect(vis(owner.getByText('alpha checkpoint'))).toBeVisible({ timeout: 30_000 });

    await createChannel(owner, 'Beta Talk');

    // --- owner: mint the invite from Beta (active after createChannel), so
    // the guest is granted exactly Beta's key
    await vis(owner.getByTestId('concord-chat-menu')).click();
    await vis(owner.getByTestId('concord-menu-invite')).click();
    const link = await vis(owner.getByTestId('concord-invite-link')).textContent();
    expect(link).toContain('/invite/');
    // Close the invite sheet so it doesn't block the chat composer below.
    await vis(owner.locator('.modal-box').getByRole('button', { name: '✕' })).click();
    await expect(owner.getByTestId('concord-invite-link')).not.toBeVisible();

    // --- guest: login, join via the invite link, open Beta. The guest's
    // rail auto-selects Alpha (channels[0]) which they hold no key for, so
    // an explicit row click is required to reach Beta's composer.
    await bootstrapLogin(guest, guestNsec);
    await guest.goto(/** @type {string} */ (link));
    await expect(guest.getByTestId('concord-join-button')).toBeEnabled({ timeout: 20_000 });
    await guest.getByTestId('concord-join-button').click();
    await expect(guest.getByText(/Beigetreten|Joined/)).toBeVisible({ timeout: 30_000 });
    await guest.goto(`/c/${communityNpub}?view=channels`);
    await expect(channelRow(guest, 'Beta Talk')).toBeVisible({ timeout: 30_000 });
    await channelRow(guest, 'Beta Talk').click();
    await expect(vis(guest.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 30_000 });

    // --- owner: switch back to Alpha. Creating Beta (and minting its
    // invite) left Beta as the owner's shared per-community selection
    // (active-channel.svelte.js), which now survives the Kanäle view
    // unmounting/remounting on tab switches (bff91f2c — intentional "come
    // back to the channel you were in" UX). Without this explicit reselect,
    // Beta would still be selected when the Kanäle view remounts below,
    // auto-marking it read on arrival and making the ROW-dot assertions
    // below unobservable.
    await channelRow(owner, 'Alpha Planung').click();
    await expect(vis(owner.getByText('alpha checkpoint'))).toBeVisible({ timeout: 30_000 });

    // --- owner: leave the channels view (Home tab); baseline: no badges
    await clickContentTab(owner, 'Home');
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);
    await expect(owner.locator('[data-testid="concord-mention-pill"]')).toHaveCount(0);

    // --- guest sends into Beta while the owner is on Home: the area rollup
    // lights the Channels TAB with the neutral unread dot
    const guestInput = () => vis(guest.getByTestId('concord-chat-input'));
    await guestInput().fill('are you there?');
    await guestInput().press('Enter');
    await expect(vis(owner.getByTestId('concord-unread-dot'))).toBeVisible({ timeout: 30_000 });

    // --- owner opens the Kanäle view: Alpha re-selects (persisted from the
    // explicit reselect above), so Beta's unread survives the mount — its
    // ROW carries the dot while the active Alpha row carries none
    await clickContentTab(owner, 'Channels');
    await expect(
      channelRow(owner, 'Beta Talk').locator('[data-testid="concord-unread-dot"]')
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      owner
        .locator('aside button', { hasText: 'Alpha Planung' })
        .locator('[data-testid="concord-unread-dot"]')
    ).toHaveCount(0);

    // --- owner clicks Beta's row: markChannelRead clears the dot everywhere
    // (row AND tab rollup)
    await channelRow(owner, 'Beta Talk').click();
    await expect(vis(owner.getByText('are you there?'))).toBeVisible({ timeout: 30_000 });
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);

    // --- reload persistence: the read marker must come back from IDB, not
    // just the torn-down in-memory session. Readiness is asserted POSITIVELY
    // before the negative badge check: the Kanäle rail lists Beta again and
    // Alpha's chat history (auto-selected on mount) shows the pre-reload
    // message — i.e. the Concord service re-booted and the rumor cache
    // re-hydrated. Only then is "no dot" meaningful. Note Beta is NOT
    // auto-marked read by this navigation (only active Alpha is), so a lost
    // marker would light Beta's row dot here.
    await clickContentTab(owner, 'Home');
    await owner.reload();
    await clickContentTab(owner, 'Channels');
    await expect(channelRow(owner, 'Beta Talk')).toBeVisible({ timeout: 30_000 });
    await expect(vis(owner.getByText('alpha checkpoint'))).toBeVisible({ timeout: 30_000 });
    await expect(owner.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);
    await expect(owner.locator('[data-testid="concord-mention-pill"]')).toHaveCount(0);

    // --- owner posts into Beta, then leaves; guest replies to that specific
    // message (the reply factory p-tags the owner) — the mention pill must
    // light even off-channel
    await channelRow(owner, 'Beta Talk').click();
    await expect(vis(owner.getByTestId('concord-chat-input'))).toBeVisible({ timeout: 30_000 });
    await ownerInput().fill('reply to me please');
    await ownerInput().press('Enter');
    await expect(vis(owner.getByText('reply to me please'))).toBeVisible({ timeout: 30_000 });
    await clickContentTab(owner, 'Home');

    const targetMessage = vis(guest.locator('.chat').filter({ hasText: 'reply to me please' }));
    await expect(targetMessage).toBeVisible({ timeout: 30_000 });
    await targetMessage.hover();
    // exact: the thread feature added a sibling "Reply in thread" button whose
    // title substring-matches 'Reply' and trips strict mode.
    await targetMessage.getByTitle('Reply', { exact: true }).click();
    await guestInput().fill('here I am');
    await guestInput().press('Enter');

    await expect(vis(owner.getByTestId('concord-mention-pill'))).toBeVisible({ timeout: 30_000 });

    await ownerContext.close();
    await guestContext.close();
  });
});
