/**
 * Cordn groups spike — two-account round trip against the real homelab
 * coordinator over ContextVM (relay.contextvm.org). Requires
 * CORDN_GROUPS_ENABLED=true and CORDN_COORDINATOR_PUBKEY in .env; skips
 * otherwise. Real-network test: create → invite → accept welcome → exchange
 * messages, exercising ts-mls, sealed payloads, and the coordinator RPC
 * end-to-end in the browser.
 */
import { test, expect } from '@playwright/test';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { loginWithNsec } from './fixtures.js';

const enabled = process.env.CORDN_GROUPS_ENABLED === 'true';

function freshIdentity() {
  const secret = generateSecretKey();
  return { nsec: nip19.nsecEncode(secret), pubkey: getPublicKey(secret) };
}

/**
 * The /c layout mounts route children multiple times for responsive
 * variants — scope every testid lookup to the visible instance.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
const byId = (page, id) => page.locator(`[data-testid="${id}"]:visible`);

test.describe('Cordn groups (spike)', () => {
  test.skip(!enabled, 'CORDN_GROUPS_ENABLED not set');
  test.setTimeout(240_000);

  test('two accounts create, join, and message a private group', async ({ browser }) => {
    const alice = freshIdentity();
    const bob = freshIdentity();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // The «Gruppen» section is per-user opt-in — seed the settings toggle
    // before the app boots (matches enabling it in /settings).
    const optIn = `(() => {
      const key = 'app-settings';
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      stored.cordnGroupsEnabled = true;
      localStorage.setItem(key, JSON.stringify(stored));
    })()`;
    await pageA.addInitScript(optIn);
    await pageB.addInitScript(optIn);

    // Bob first: reaching "ready" publishes his KeyPackage to the coordinator.
    await pageB.goto('/c/groups');
    await loginWithNsec(pageB, bob.nsec);
    await pageB.goto('/c/groups');
    await expect(byId(pageB, 'cordn-status')).toBeVisible({ timeout: 90_000 });

    await pageA.goto('/c/groups');
    await loginWithNsec(pageA, alice.nsec);
    await pageA.goto('/c/groups');
    await expect(byId(pageA, 'cordn-status')).toBeVisible({ timeout: 90_000 });

    // The post-login onboarding redirect can pull pages back to Home — pin
    // both pages to the probe route before interacting.
    await pageA.goto('/c/groups');
    await expect(byId(pageA, 'cordn-status')).toBeVisible({ timeout: 90_000 });

    // Alice creates a group and invites Bob by pubkey.
    await byId(pageA, 'cordn-new-group-name').fill('E2E Spike');
    await byId(pageA, 'cordn-new-group-name').press('Enter');
    await expect(byId(pageA, 'cordn-group-list')).toContainText('E2E Spike');

    await byId(pageA, 'cordn-invitee-pubkey').fill(bob.pubkey);
    await byId(pageA, 'cordn-invitee-pubkey').press('Enter');
    // Member count badge reflects the add (2 members) once the commit posts.
    await expect(byId(pageA, 'cordn-group-list')).toContainText('2', { timeout: 60_000 });

    // Bob refreshes invitations until Alice's storeWelcome (async over the
    // relay) has landed, then accepts (re-pin the route first). The
    // invitations tools live in a collapsed <details> in the rail.
    await pageB.goto('/c/groups');
    await expect(byId(pageB, 'cordn-status')).toBeVisible({ timeout: 90_000 });
    await byId(pageB, 'cordn-invites-summary').click();
    await expect(async () => {
      await byId(pageB, 'cordn-invites-refresh').click();
      await expect(byId(pageB, 'cordn-invite-accept').first()).toBeVisible({
        timeout: 10_000
      });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    await byId(pageB, 'cordn-invite-accept').first().click();
    await expect(byId(pageB, 'cordn-group-list')).toContainText('Gruppe', {
      timeout: 60_000
    });

    // Alice → Bob.
    await byId(pageA, 'cordn-message-input').fill('Hallo Bob, MLS klappt');
    await byId(pageA, 'cordn-message-input').press('Enter');
    await expect(byId(pageB, 'cordn-message-list')).toContainText('Hallo Bob, MLS klappt', {
      timeout: 60_000
    });

    // Bob → Alice.
    await byId(pageB, 'cordn-message-input').fill('Hallo Alice, Antwort kommt an');
    await byId(pageB, 'cordn-message-input').press('Enter');
    await expect(byId(pageA, 'cordn-message-list')).toContainText('Hallo Alice, Antwort kommt an', {
      timeout: 60_000
    });

    await contextA.close();
    await contextB.close();
  });
});
