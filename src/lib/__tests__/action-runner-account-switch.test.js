/** @vitest-environment node */
/**
 * ActionRunner must follow the ACTIVE account across switches.
 *
 * applesauce's ActionRunner caches its action context (`self` pubkey +
 * `castUser(self)`) on the first run and never invalidates it, even though
 * the AccountManager docs promise "manager.setActive(other); actions.run(...)
 * automatically uses new account". With a session-lifetime runner singleton
 * and a proxy signer, every action after an account switch therefore READ
 * the previous account's lists while SIGNING as the new one: joining one
 * community as account B republished account A's whole communities follow
 * set under B's key (2026-10-07).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventStore } from 'applesauce-core';
import { AddUserToFollowSet } from 'applesauce-actions/actions';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { includeClientTag: false }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { clientName: '' }
}));

const eventStore = new EventStore();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore }));

/** @type {import('nostr-tools').NostrEvent[]} */
const published = [];
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async (/** @type {any} */ event) => {
    published.push(event);
    return { success: true };
  })
}));
vi.mock('$lib/services/gift-wrap-publish.js', () => ({
  publishGiftWrap: vi.fn(async () => ({ success: true })),
  GIFT_WRAP_KIND: 1059
}));

const skA = generateSecretKey();
const skB = generateSecretKey();
const pkA = getPublicKey(skA);
const pkB = getPublicKey(skB);

/** Mirrors AccountManager.signer: a proxy that always targets the active account. */
let activeSk = skA;
const proxySigner = {
  getPublicKey: async () => getPublicKey(activeSk),
  signEvent: async (/** @type {any} */ draft) => finalizeEvent(draft, activeSk),
  nip04: undefined,
  nip44: undefined
};
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { signer: proxySigner }
}));

const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');

const COMMUNITY_X = '1'.repeat(64);
const COMMUNITY_Y = '2'.repeat(64);
const COMMUNITY_Z = '3'.repeat(64);
const COMMUNITY_NEW = '4'.repeat(64);

/**
 * @param {Uint8Array} sk
 * @param {string[]} communities
 */
function followSet(sk, communities) {
  return finalizeEvent(
    {
      kind: 30000,
      created_at: 1_700_000_000,
      content: '',
      tags: [['d', 'communities'], ...communities.map((p) => ['p', p])]
    },
    sk
  );
}

/** @param {Uint8Array} sk */
function relayList(sk) {
  return finalizeEvent(
    { kind: 10002, created_at: 1_700_000_000, content: '', tags: [['r', 'wss://x.example/']] },
    sk
  );
}

/** @param {import('nostr-tools').NostrEvent} event */
const pTags = (event) => event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);

describe('ActionRunner across account switches', () => {
  beforeEach(() => {
    published.length = 0;
    eventStore.removeByFilters({});
    eventStore.add(followSet(skA, [COMMUNITY_X, COMMUNITY_Y]));
    eventStore.add(followSet(skB, [COMMUNITY_Z]));
    eventStore.add(relayList(skA));
    eventStore.add(relayList(skB));
  });

  it('reads the NEW active account lists after a switch, not the previous account', async () => {
    // Account A runs an action first — this is what primes the runner context.
    activeSk = skA;
    await actionRunnerOptimistic.run(AddUserToFollowSet, COMMUNITY_NEW, 'communities');
    expect(published).toHaveLength(1);
    expect(published[0].pubkey).toBe(pkA);
    expect(pTags(published[0]).sort()).toEqual([COMMUNITY_X, COMMUNITY_Y, COMMUNITY_NEW].sort());

    // Switch to account B and join one community.
    activeSk = skB;
    await actionRunnerOptimistic.run(AddUserToFollowSet, COMMUNITY_NEW, 'communities');

    expect(published).toHaveLength(2);
    const second = published[1];
    expect(second.pubkey).toBe(pkB);
    // B's list is Z + the new community. It must NOT contain A's X / Y.
    expect(pTags(second).sort()).toEqual([COMMUNITY_Z, COMMUNITY_NEW].sort());
  });
});
