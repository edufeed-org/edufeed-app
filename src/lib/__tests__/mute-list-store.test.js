/**
 * Mute list store: the effective muted words are the instance-wide words
 * (unless the user switched them off) plus the user's own, and the user's
 * own include the NIP-51 private entries once the signer unlocked them.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

const replaceable$ = vi.hoisted(() => ({
  subject: /** @type {any} */ (null),
  latest: /** @type {any} */ (undefined)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => replaceable$.subject, getReplaceable: () => replaceable$.latest }
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
const config = vi.hoisted(() => ({ moderation: { mutedWords: ['damus airdrop'] } }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: config }));
const settings = vi.hoisted(() => ({ instanceMutedWordsEnabled: true }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));
const unlock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('applesauce-core/helpers/hidden-tags', async (importOriginal) => ({
  ...(await importOriginal()),
  unlockHiddenTags: (/** @type {any[]} */ ...args) => unlock.fn(...args)
}));

import {
  getMutedWords,
  getMutedPubkeys,
  initializeMuteList,
  cleanupMuteList,
  EditMuteList
} from '$lib/stores/mute-list.svelte.js';
import { getHiddenMutedThings, isHiddenMutesUnlocked } from 'applesauce-common/helpers/mute';

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
  replaceable$.latest = undefined;
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

describe('EditMuteList (private by default, NIP-51)', () => {
  const SPAMMER = 'b'.repeat(64);
  const OTHER = 'c'.repeat(64);
  // Fake signer: "encryption" is a readable prefix per method.
  const signer = {
    getPublicKey: async () => ME,
    signEvent: async (/** @type {any} */ draft) => ({ ...draft, id: 'new', pubkey: ME, sig: 's' }),
    nip44: {
      encrypt: async (/** @type {string} */ _pk, /** @type {string} */ text) => 'n44:' + text,
      decrypt: async (/** @type {string} */ _pk, /** @type {string} */ c) => c.slice(4)
    },
    nip04: {
      decrypt: async (/** @type {string} */ _pk, /** @type {string} */ c) => c.split('?iv=')[0]
    }
  };
  /** @param {string[]} tag @param {boolean} add @param {any} [ctxSigner] */
  const run = async (tag, add, ctxSigner = signer) => {
    const publish = vi.fn();
    await EditMuteList(tag, add)({ signer: ctxSigner, publish });
    return publish;
  };
  const hiddenOf = (/** @type {any} */ e) => JSON.parse(e.content.slice(4));

  it('adds an entry privately (nip44), keeping public tags and earlier private ones', async () => {
    replaceable$.latest = {
      ...muteEvent(
        [
          ['word', 'public'],
          ['p', SPAMMER]
        ],
        'n44:' + JSON.stringify([['p', OTHER]])
      ),
      created_at: 50
    };
    const publish = await run(['p', SPAMMER], true);
    const sent = publish.mock.calls[0][0];
    expect(sent.kind).toBe(10000);
    expect(sent.created_at).toBeGreaterThan(50);
    expect(sent.tags).toEqual([['word', 'public']]); // moved out of the public half
    expect(hiddenOf(sent)).toEqual([
      ['p', OTHER],
      ['p', SPAMMER]
    ]);
    // Our own new list needs no second decrypt prompt
    expect(isHiddenMutesUnlocked(sent)).toBe(true);
  });

  it('reads a legacy nip04 private half and rewrites it as nip44', async () => {
    replaceable$.latest = muteEvent([], JSON.stringify([['p', OTHER]]) + '?iv=abc');
    const publish = await run(['word', 'spam'], true);
    const sent = publish.mock.calls[0][0];
    expect(sent.content.startsWith('n44:')).toBe(true);
    expect(hiddenOf(sent)).toEqual([
      ['p', OTHER],
      ['word', 'spam']
    ]);
  });

  it('removes an entry from both halves', async () => {
    replaceable$.latest = muteEvent([['p', SPAMMER]], 'n44:' + JSON.stringify([['p', SPAMMER]]));
    const publish = await run(['p', SPAMMER], false);
    const sent = publish.mock.calls[0][0];
    expect(sent.tags).toEqual([]);
    expect(sent.content).toBe('');
  });

  it('round-trips with real nip44: another reader unlocks what we wrote', async () => {
    const { PrivateKeySigner } = await import('applesauce-signers');
    const { unlockHiddenTags: realUnlock } = /** @type {any} */ (
      await vi.importActual('applesauce-core/helpers/hidden-tags')
    );
    const real = new PrivateKeySigner();
    const publish = vi.fn();
    await EditMuteList(['p', SPAMMER], true)({ signer: real, publish });
    const sent = publish.mock.calls[0][0];
    expect(sent.content).not.toContain('?iv='); // nip44, not nip04
    const fresh = { ...sent }; // a reader without our cache
    expect(await realUnlock(fresh, real, 'nip44')).toEqual([['p', SPAMMER]]);
  });

  it('removes a word whatever its capitalisation', async () => {
    replaceable$.latest = muteEvent([['word', 'Spam']]);
    const publish = await run(['word', 'spam'], false);
    expect(publish.mock.calls[0][0].tags).toEqual([]);
  });

  it('publishes nothing when the private half cannot be decrypted', async () => {
    replaceable$.latest = muteEvent([], 'n44:garbage');
    const bad = { ...signer, nip44: { ...signer.nip44, decrypt: async () => 'not json' } };
    const publish = vi.fn();
    await expect(EditMuteList(['p', SPAMMER], true)({ signer: bad, publish })).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });

  it('falls back to a public entry for a signer without nip44, leaving content untouched', async () => {
    replaceable$.latest = muteEvent([], 'opaque?iv=x');
    const { nip44: _, ...noNip44 } = signer;
    const publish = await run(['p', SPAMMER], true, noNip44);
    const sent = publish.mock.calls[0][0];
    expect(sent.tags).toEqual([['p', SPAMMER]]);
    expect(sent.content).toBe('opaque?iv=x');
  });
});
