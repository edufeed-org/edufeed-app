// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * Regression test for the /c dashboard bug: useProfileMap must invoke
 * profileLoader with explicit relays and surface profiles from ProfileModel
 * emissions — NOT rely on the broken eventStore.profile() auto-load path.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

const profileLoaderMock = vi.fn();
/** @type {Map<string, Subject<any>>} */
const modelSubjects = new Map();

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: (...args) => profileLoaderMock(...args)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn((_model, pubkey) => {
      if (!modelSubjects.has(pubkey)) modelSubjects.set(pubkey, new Subject());
      return modelSubjects.get(pubkey);
    })
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://purplepag.es']
}));

vi.mock('applesauce-core/models', () => ({
  ProfileModel: 'ProfileModel'
}));

const { useProfileMap } = await import('../profile-map.svelte.js');

describe('useProfileMap', () => {
  beforeEach(() => {
    profileLoaderMock.mockReset();
    modelSubjects.clear();
    profileLoaderMock.mockImplementation(() => ({
      subscribe: () => ({ unsubscribe: vi.fn() })
    }));
  });

  it('invokes profileLoader per pubkey with kind 0 and explicit relays', () => {
    const pubkeys = ['pk-a', 'pk-b', 'pk-c'];
    const cleanup = $effect.root(() => {
      useProfileMap(() => pubkeys);
    });
    flushSync();

    expect(profileLoaderMock).toHaveBeenCalledTimes(3);
    for (const pk of pubkeys) {
      expect(profileLoaderMock).toHaveBeenCalledWith({
        kind: 0,
        pubkey: pk,
        relays: ['wss://purplepag.es']
      });
    }

    cleanup();
  });

  it('populates the returned Map when ProfileModel emits', async () => {
    const pubkeys = ['pk-1', 'pk-2'];
    /** @type {() => Map<string, any>} */
    let getProfiles;
    const cleanup = $effect.root(() => {
      getProfiles = useProfileMap(() => pubkeys);
    });
    flushSync();

    // Emit profile for pk-1
    modelSubjects.get('pk-1').next({ name: 'Alice' });

    // Debounce window in useProfileMap is 50ms
    await new Promise((r) => setTimeout(r, 100));
    flushSync();

    const map = getProfiles();
    expect(map.get('pk-1')).toEqual({ name: 'Alice' });
    expect(map.has('pk-2')).toBe(false);

    cleanup();
  });
});
