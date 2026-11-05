/** @vitest-environment jsdom */
/**
 * After switching account A → B, events of A that arrive late (its kind 3
 * contact list, its kind 30002 relay-set overrides) must not be applied as if
 * they were B's. The per-login subscriptions in accounts.svelte.js used to be
 * created on every active$ emission and never unsubscribed.
 */
import { describe, it, expect, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { writable } from 'svelte/store';

vi.mock('$lib/stores/config.svelte.js', () => ({ configReady: writable(true), runtimeConfig: {} }));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader: () => ({ subscribe: () => {} }) }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => ['wss://lookup.example']
}));
const appRelay = vi.hoisted(() => ({
  clearUserOverrideCache: vi.fn(),
  updateUserOverrideCache: vi.fn(),
  CATEGORIES: { calendar: {} },
  getRelaySetDTag: (/** @type {string} */ c) => `Edufeed/${c}`,
  parseRelaySetEvent: (/** @type {any} */ e) =>
    e
      ? e.tags
          .filter((/** @type {string[]} */ t) => t[0] === 'relay')
          .map((/** @type {string[]} */ t) => t[1])
      : []
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => appRelay);
const curated = vi.hoisted(() => ({
  setUserFollows: vi.fn(),
  clearUserFollows: vi.fn(),
  setActiveUserPubkey: vi.fn(),
  clearActiveUserPubkey: vi.fn()
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => curated);
vi.mock('$lib/services/session-flush.js', () => ({
  watchAccountSwitches: () => {},
  flushSessionState: () => {}
}));
vi.mock('$lib/stores/session-epoch.svelte.js', () => ({ bumpSessionEpoch: () => {} }));
vi.mock('$lib/services/identity-rebroadcast.js', () => ({ scheduleIdentityRebroadcast: () => {} }));
vi.mock('$lib/services/relay-warming-service.svelte.js', () => ({
  warmUserRelays: () => {},
  warmAppRelays: () => {},
  clearWarmStatus: () => {}
}));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({ preloadUserEmojiSets: () => {} }));
vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: { loadContacts: () => {}, clear: () => {} }
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  initializeDMs: () => {},
  cleanup: () => {}
}));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  initializeMuteList: () => {},
  cleanupMuteList: () => {}
}));

const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const { manager } = await import('$lib/stores/accounts.svelte.js');
const { ReadonlyAccount } = await import('applesauce-accounts/accounts');

const skA = generateSecretKey();
const skB = generateSecretKey();
const pkB = getPublicKey(skB);
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('accounts — subscriptions of the previous account', () => {
  it(
    'ignores the previous account’s late kind 3 and kind 30002 after a switch',
    { timeout: 60_000 },
    async () => {
      const a = ReadonlyAccount.fromPubkey(getPublicKey(skA));
      const b = ReadonlyAccount.fromPubkey(pkB);
      manager.addAccount(a);
      manager.addAccount(b);
      const timeline = vi.spyOn(eventStore, 'timeline');
      const replaceable = vi.spyOn(eventStore, 'replaceable');
      manager.setActive(a);
      await vi.waitFor(() => expect(timeline).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      await vi.waitFor(() => expect(replaceable).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      manager.setActive(b);
      await vi.waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(replaceable).toHaveBeenCalledTimes(2));
      curated.setUserFollows.mockClear();
      appRelay.updateUserOverrideCache.mockClear();

      const follow = 'f'.repeat(64);
      eventStore.add(
        finalizeEvent({ kind: 3, created_at: 1000, tags: [['p', follow]], content: '' }, skA)
      );
      eventStore.add(
        finalizeEvent(
          {
            kind: 30002,
            created_at: 1000,
            tags: [
              ['d', 'Edufeed/calendar'],
              ['relay', 'wss://a-only.example']
            ],
            content: ''
          },
          skA
        )
      );
      await settle();

      expect(curated.setUserFollows).not.toHaveBeenCalled();

      // B's own events still apply.
      eventStore.add(
        finalizeEvent({ kind: 3, created_at: 1000, tags: [['p', follow]], content: '' }, skB)
      );
      await settle();
      expect(curated.setUserFollows).toHaveBeenCalledWith([follow]);
    }
  );
});
