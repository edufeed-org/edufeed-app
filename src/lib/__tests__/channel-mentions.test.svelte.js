/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { nip19 } from 'nostr-tools';

const VIEWER = 'c'.repeat(64);
const COMMUNITY = 'd'.repeat(64);

const inbox = vi.hoisted(() => ({
  notifications: /** @type {any[]} */ ([]),
  read: new Set(),
  markItemsAsRead: vi.fn()
}));
vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getNotifications: () => inbox.notifications,
  isNotificationUnread: (/** @type {any} */ e) => !inbox.read.has(e.id),
  getInboxPubkey: () => VIEWER,
  markItemsAsRead: inbox.markItemsAsRead
}));

const communityEvent = {
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [['group', 'chanA', 'wss://groups.example', 'arbeitszimmer']]
};
const store = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: store, pool: {} }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
const addressLoader = vi.hoisted(() => vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay.example'],
  getAllLookupRelays: () => []
}));

const { useCommunityMention, useMarkChannelMentionsRead } = await import(
  '$lib/groups/channel-mentions.svelte.js'
);

const mention = (/** @type {string} */ id) => ({
  kind: 9,
  id,
  pubkey: 'b'.repeat(64),
  created_at: 1,
  content: `hi nostr:${nip19.npubEncode(VIEWER)}`,
  tags: [
    ['h', 'chanA'],
    ['p', VIEWER]
  ]
});

/** @param {() => void} fn */
function inRoot(fn) {
  /** @type {any} */
  let out;
  const destroy = $effect.root(() => {
    out = fn();
  });
  flushSync();
  return { out, destroy };
}

beforeEach(() => {
  inbox.notifications = [mention('m1'), mention('m2')];
  inbox.read = new Set();
  inbox.markItemsAsRead.mockReset();
  store.model.mockImplementation(() => ({
    subscribe: (/** @type {Function} */ cb) => {
      cb([communityEvent]);
      return { unsubscribe() {} };
    }
  }));
  addressLoader.mockClear();
});

describe('useCommunityMention', () => {
  it('is true while one of the community channels holds an unread mention', () => {
    const { out: get, destroy } = inRoot(() => useCommunityMention(() => COMMUNITY));
    expect(get()).toBe(true);
    destroy();
  });

  it('is false for a community without such a channel, and false without a pubkey', () => {
    store.model.mockImplementation(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([{ ...communityEvent, tags: [['group', 'other', 'wss://groups.example']] }]);
        return { unsubscribe() {} };
      }
    }));
    const { out: get, destroy } = inRoot(() => useCommunityMention(() => COMMUNITY));
    expect(get()).toBe(false);
    destroy();
    const none = inRoot(() => useCommunityMention(() => null));
    expect(none.out()).toBe(false);
    none.destroy();
  });

  it('loads the community event only when there is an unread channel mention at all', () => {
    inbox.notifications = [];
    const a = inRoot(() => useCommunityMention(() => COMMUNITY));
    expect(addressLoader).not.toHaveBeenCalled();
    a.destroy();
    inbox.notifications = [mention('m1')];
    // not in the store yet
    store.model.mockImplementation(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe() {} };
      }
    }));
    const b = inRoot(() => useCommunityMention(() => COMMUNITY));
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 10222, pubkey: COMMUNITY })
    );
    b.destroy();
  });
});

describe('useCommunityMention via the channel parent', () => {
  it('lights the community whose root group the mentioned channel names as parent', () => {
    const root = { kind: 10222, pubkey: COMMUNITY, tags: [['membership', 'root1', 'wss://g']] };
    const meta = {
      kind: 39000,
      tags: [
        ['d', 'chanA'],
        ['parent', 'root1']
      ]
    };
    store.model.mockImplementation((/** @type {any} */ _m, /** @type {any} */ filter) => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb(filter.kinds[0] === 39000 ? [meta] : [root]);
        return { unsubscribe() {} };
      }
    }));
    const { out: get, destroy } = inRoot(() => useCommunityMention(() => COMMUNITY));
    expect(get()).toBe(true);
    destroy();
  });
});

describe('useMarkChannelMentionsRead', () => {
  it('marks the open channel’s unread mention rows read in the inbox', () => {
    const { destroy } = inRoot(() => useMarkChannelMentionsRead(() => 'chanA'));
    expect(inbox.markItemsAsRead).toHaveBeenCalledWith(['m1', 'm2']);
    destroy();
  });

  it('leaves other channels alone and does nothing while the tab is hidden', () => {
    const other = inRoot(() => useMarkChannelMentionsRead(() => 'chanB'));
    expect(inbox.markItemsAsRead).not.toHaveBeenCalled();
    other.destroy();

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const hidden = inRoot(() => useMarkChannelMentionsRead(() => 'chanA'));
    expect(inbox.markItemsAsRead).not.toHaveBeenCalled();
    spy.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(inbox.markItemsAsRead).toHaveBeenCalledWith(['m1', 'm2']);
    spy.mockRestore();
    hidden.destroy();
  });
});
