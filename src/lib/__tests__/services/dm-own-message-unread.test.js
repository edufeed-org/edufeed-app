/**
 * QA round 3 B2: the organiser's own meeting invitation — a DM sent from the
 * schedule dialog, not the DM composer, so no read marker was set — counted
 * as an unread conversation: inbox "… hat dir eine Nachricht gesendet", bell
 * and DM badges. A conversation whose newest message is the user's own has
 * nothing unread, however it was sent (invites, approvals, calendar invites,
 * another device).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, BehaviorSubject } from 'rxjs';

const conversations$ = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
vi.mock('$lib/models/wrapped-dm.js', () => ({ DmConversationsModel: 'DmConversationsModel' }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: vi.fn(() => undefined),
    add: vi.fn(),
    model: vi.fn((model) => (model === 'DmConversationsModel' ? conversations$.current : of([]))),
    replaceable: vi.fn(() => of(undefined)),
    timeline: vi.fn(() => of([]))
  },
  pool: {
    request: vi.fn(() => of()),
    group: vi.fn(() => ({ subscription: vi.fn(() => of()) })),
    relay: vi.fn(() => ({ challenge$: of(null), authenticated: false }))
  }
}));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader: vi.fn(() => of()) }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getWriteRelays: async () => [],
  getReadRelays: async () => []
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { fallbackRelays: [] } }));
vi.mock('applesauce-common/helpers/encrypted-content-cache', () => ({
  persistEncryptedContent: () => () => {}
}));
vi.mock('applesauce-common/models', () => ({
  GiftWrapsModel: 'GiftWrapsModel',
  WrappedMessagesGroups: 'WrappedMessagesGroups',
  WrappedMessagesModel: 'WrappedMessagesModel'
}));

const {
  initializeDMs,
  cleanup,
  getUnreadDmCount,
  getUnreadDmConversations,
  isDmConversationUnread
} = await import('$lib/services/dm-service.svelte.js');

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const SIGNER = /** @type {any} */ ({ getPublicKey: async () => ME });
const CONV_ID = [ME, PEER].sort().join(':');

/** @param {string} author @param {number} at */
function conversation(author, at) {
  return {
    id: CONV_ID,
    participants: [ME, PEER],
    lastMessage: {
      id: `m-${at}`,
      kind: 14,
      pubkey: author,
      created_at: at,
      tags: [['p', author === ME ? PEER : ME]],
      content: 'Einladung: …'
    }
  };
}

beforeEach(() => {
  localStorage.clear();
  conversations$.current = new BehaviorSubject([]);
});
afterEach(() => cleanup());

describe('own messages are never unread', () => {
  it('a conversation whose newest message is mine counts nowhere', () => {
    initializeDMs(ME, SIGNER);
    conversations$.current.next([conversation(ME, 1000)]);
    expect(getUnreadDmCount()).toBe(0);
    expect(getUnreadDmConversations()).toEqual([]);
    expect(isDmConversationUnread(CONV_ID, 1000)).toBe(false);
  });

  it("the peer's answer after it is unread", () => {
    initializeDMs(ME, SIGNER);
    conversations$.current.next([conversation(ME, 1000)]);
    conversations$.current.next([conversation(PEER, 1100)]);
    expect(getUnreadDmCount()).toBe(1);
    expect(isDmConversationUnread(CONV_ID, 1100)).toBe(true);
  });
});
