/**
 * Mute list store: the effective muted words are the instance-wide words
 * (unless the user switched them off) plus the user's own, and the user's
 * own include the NIP-51 private entries once the signer unlocked them.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

const replaceable$ = vi.hoisted(() => ({ subject: /** @type {any} */ (null) }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => replaceable$.subject }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getWriteRelays: async () => []
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: vi.fn() }
}));
vi.mock('applesauce-actions/actions', () => ({
  MuteUser: vi.fn(),
  UnmuteUser: vi.fn(),
  MuteWord: vi.fn(),
  UnmuteWord: vi.fn()
}));
const config = vi.hoisted(() => ({ moderation: { mutedWords: ['damus airdrop'] } }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: config }));
const settings = vi.hoisted(() => ({ instanceMutedWordsEnabled: true }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));
const unlock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('applesauce-core/helpers/hidden-tags', () => ({
  unlockHiddenTags: (/** @type {any[]} */ ...args) => unlock.fn(...args)
}));

import {
  getMutedWords,
  getMutedPubkeys,
  initializeMuteList,
  cleanupMuteList
} from '$lib/stores/mute-list.svelte.js';
import { getHiddenMutedThings } from 'applesauce-common/helpers/mute';

const ME = 'f'.repeat(64);
/** @param {string[][]} tags @param {string} [content] */
const muteEvent = (tags, content = '') => ({
  id: 'mute-' + Math.random().toString(16).slice(2),
  kind: 10000,
  pubkey: ME,
  created_at: 1,
  sig: 'x',
  content,
  tags
});

beforeEach(() => {
  replaceable$.subject = new Subject();
  unlock.fn.mockReset();
  settings.instanceMutedWordsEnabled = true;
  cleanupMuteList();
});

describe('mute list store', () => {
  it('merges the instance-wide words with the user public words', () => {
    initializeMuteList(ME, null);
    replaceable$.subject.next(muteEvent([['word', 'Free SATS']]));
    expect(getMutedWords()).toEqual(new Set(['damus airdrop', 'free sats']));
  });

  it('drops the instance-wide words when the user switched the spam filter off', () => {
    settings.instanceMutedWordsEnabled = false;
    initializeMuteList(ME, null);
    replaceable$.subject.next(muteEvent([['word', 'free sats']]));
    expect(getMutedWords()).toEqual(new Set(['free sats']));
  });

  it('unlocks the private entries with the signer and adds them (nip44 payload)', async () => {
    const signer = { nip44: {} };
    unlock.fn.mockImplementation(async (event) => {
      // Behave like applesauce: cache the decrypted hidden tags on the event.
      const { setHiddenTagsCache } = /** @type {any} */ (
        await vi.importActual('applesauce-core/helpers/hidden-tags')
      );
      setHiddenTagsCache(event, [
        ['word', 'Secret Spam'],
        ['p', 'a'.repeat(64)]
      ]);
    });
    initializeMuteList(ME, signer);
    const event = muteEvent([['word', 'public']], 'ciphertext-nip44');
    replaceable$.subject.next(event);
    expect(getMutedWords()).toEqual(new Set(['damus airdrop', 'public']));
    await vi.waitFor(() => expect(getMutedWords().has('secret spam')).toBe(true));
    expect(getMutedPubkeys().has('a'.repeat(64))).toBe(true);
    expect(unlock.fn).toHaveBeenCalledWith(event, signer, 'nip44');
    expect(getHiddenMutedThings(event)?.words.has('secret spam')).toBe(true);
  });

  it('picks nip04 for legacy ?iv= payloads and tries each event version once', async () => {
    const signer = { nip04: {} };
    unlock.fn.mockRejectedValue(new Error('user declined'));
    initializeMuteList(ME, signer);
    const event = muteEvent([], 'abc?iv=def');
    replaceable$.subject.next(event);
    replaceable$.subject.next(event);
    await vi.waitFor(() => expect(unlock.fn).toHaveBeenCalledTimes(1));
    expect(unlock.fn).toHaveBeenCalledWith(event, signer, 'nip04');
    expect(getMutedWords()).toEqual(new Set(['damus airdrop']));
  });

  it('never asks a readonly session (no signer) to decrypt', () => {
    initializeMuteList(ME, null);
    replaceable$.subject.next(muteEvent([], 'ciphertext'));
    expect(unlock.fn).not.toHaveBeenCalled();
  });
});
