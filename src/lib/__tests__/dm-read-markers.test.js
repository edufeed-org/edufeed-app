/**
 * DM read markers only ever move forward (issue 7872bcbd).
 *
 * Reported: conversations read on an earlier visit showed as unread again
 * later. Every mark-read surface passes "the newest message it currently
 * shows" — and right after a reload that is a partial view (gift wraps still
 * restoring from the plaintext cache, the relay not yet delivering). The old
 * code overwrote the stored marker with that older timestamp, so the real
 * newest message, once it arrived, counted as unread although it had been
 * read before.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEVER, Subject } from 'rxjs';

const conversations$ = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
const DmConversationsModel = vi.hoisted(() => ({ __model: 'DmConversationsModel' }));
vi.mock('$lib/models/wrapped-dm.js', () => ({ DmConversationsModel }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: () => NEVER,
    getReplaceable: () => undefined,
    timeline: () => NEVER,
    model: (/** @type {any} */ model) =>
      model === DmConversationsModel ? conversations$.current : NEVER
  },
  pool: { relay: () => ({}), group: () => ({ subscription: () => NEVER }) }
}));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader: () => NEVER }));
vi.mock('applesauce-common/helpers/encrypted-content-cache', () => ({
  persistEncryptedContent: () => () => {}
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getWriteRelays: () => [],
  getReadRelays: () => []
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/groups/relay-auth.js', () => ({ authenticateOnce: vi.fn() }));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  getMutedPubkeys: () => new Set(),
  getMutedWords: () => []
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  parseDirectPubkeys: () => []
}));

import {
  initializeDMs,
  cleanup,
  markConversationAsRead,
  markAllDmConversationsAsRead,
  isDmConversationUnread
} from '$lib/services/dm-service.svelte.js';
import { DM_READ_TIMESTAMPS_KEY } from '$lib/helpers/dm.js';

const ME = 'me_hex';
const PEER = 'peer_hex';
const CONV = `${ME}:${PEER}`;
const STORAGE_KEY = `${DM_READ_TIMESTAMPS_KEY}:${ME}`;

/** @type {Map<string, string>} */
let storage;
const signer = /** @type {any} */ ({ nip44: { decrypt: vi.fn() } });

/** @param {number} createdAt */
const peerMessage = (createdAt) => ({
  id: `msg-${createdAt}`,
  kind: 14,
  pubkey: PEER,
  created_at: createdAt,
  tags: [['p', ME]],
  content: 'hi'
});

const stored = () => JSON.parse(storage.get(STORAGE_KEY) ?? '{}');

beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (/** @type {string} */ k) => storage.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => storage.set(k, v),
    removeItem: (/** @type {string} */ k) => storage.delete(k)
  });
  conversations$.current = new Subject();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DM read markers survive a reload with a partial view', () => {
  it('a thread marking an older message after reload does not un-read the newest one', () => {
    // Earlier visit: the user read the conversation up to message 1700.
    storage.set(STORAGE_KEY, JSON.stringify({ [CONV]: 1700 }));

    // Later visit: reload, the thread shows what has restored so far (…1500).
    initializeDMs(ME, signer);
    markConversationAsRead(CONV, 1500);

    // Then the newest message (1700) finishes restoring / arrives from the relay.
    expect(isDmConversationUnread(CONV, 1700, PEER)).toBe(false);
    expect(stored()).toEqual({ [CONV]: 1700 });
  });

  it('"mark all as read" over a partial conversation list does not lower markers', () => {
    storage.set(STORAGE_KEY, JSON.stringify({ [CONV]: 1700 }));
    initializeDMs(ME, signer);
    conversations$.current.next([
      { id: CONV, participants: [ME, PEER], lastMessage: peerMessage(1500) }
    ]);

    markAllDmConversationsAsRead();

    expect(isDmConversationUnread(CONV, 1700, PEER)).toBe(false);
    expect(stored()).toEqual({ [CONV]: 1700 });
  });

  it('still advances and persists a marker for a genuinely newer message', () => {
    storage.set(STORAGE_KEY, JSON.stringify({ [CONV]: 1700 }));
    initializeDMs(ME, signer);

    expect(isDmConversationUnread(CONV, 2000, PEER)).toBe(true);
    markConversationAsRead(CONV, 2000);

    expect(isDmConversationUnread(CONV, 2000, PEER)).toBe(false);
    expect(stored()).toEqual({ [CONV]: 2000 });
  });

  it('marking a conversation without a marker records it', () => {
    initializeDMs(ME, signer);
    markConversationAsRead(CONV, 1200);
    expect(stored()).toEqual({ [CONV]: 1200 });
  });
});
