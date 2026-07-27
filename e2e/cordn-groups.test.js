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

    // Bob first: reaching "ready" publishes his KeyPackage to the coordinator.
    await pageB.goto('/labs/cordn');
    await loginWithNsec(pageB, bob.nsec);
    await pageB.goto('/labs/cordn');
    await expect(pageB.getByTestId('cordn-status')).toBeVisible({ timeout: 90_000 });

    await pageA.goto('/labs/cordn');
    await loginWithNsec(pageA, alice.nsec);
    await pageA.goto('/labs/cordn');
    await expect(pageA.getByTestId('cordn-status')).toBeVisible({ timeout: 90_000 });

    // The post-login onboarding redirect can pull pages back to Home — pin
    // both pages to the probe route before interacting.
    await pageA.goto('/labs/cordn');
    await expect(pageA.getByTestId('cordn-status')).toBeVisible({ timeout: 90_000 });

    // Alice creates a group and invites Bob by pubkey.
    await pageA.getByTestId('cordn-new-group-name').fill('E2E Spike');
    await pageA.getByTestId('cordn-new-group-name').press('Enter');
    await expect(pageA.getByTestId('cordn-group-list')).toContainText('E2E Spike');

    await pageA.getByTestId('cordn-invitee-pubkey').fill(bob.pubkey);
    await pageA.getByTestId('cordn-invitee-pubkey').press('Enter');
    // Member count badge reflects the add (2 members) once the commit posts.
    await expect(pageA.getByTestId('cordn-group-list')).toContainText('2', { timeout: 60_000 });

    // Bob refreshes invitations until Alice's storeWelcome (async over the
    // relay) has landed, then accepts (re-pin the route first). The
    // invitations tools live in a collapsed <details> in the rail.
    await pageB.goto('/labs/cordn');
    await expect(pageB.getByTestId('cordn-status')).toBeVisible({ timeout: 90_000 });
    await pageB.getByText('Einladungen', { exact: false }).first().click();
    await expect(async () => {
      await pageB.getByRole('button', { name: 'Aktualisieren' }).click();
      await expect(pageB.getByRole('button', { name: 'Annehmen' })).toBeVisible({
        timeout: 10_000
      });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    await pageB.getByRole('button', { name: 'Annehmen' }).click();
    await expect(pageB.getByTestId('cordn-group-list')).toContainText('Gruppe', {
      timeout: 60_000
    });

    // Alice → Bob.
    await pageA.getByTestId('cordn-message-input').fill('Hallo Bob, MLS klappt');
    await pageA.getByTestId('cordn-message-input').press('Enter');
    await expect(pageB.getByTestId('cordn-message-list')).toContainText('Hallo Bob, MLS klappt', {
      timeout: 60_000
    });

    // Bob → Alice.
    await pageB.getByTestId('cordn-message-input').fill('Hallo Alice, Antwort kommt an');
    await pageB.getByTestId('cordn-message-input').press('Enter');
    await expect(pageA.getByTestId('cordn-message-list')).toContainText(
      'Hallo Alice, Antwort kommt an',
      { timeout: 60_000 }
    );

    await contextA.close();
    await contextB.close();
  });
});
