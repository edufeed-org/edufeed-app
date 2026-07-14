// @ts-nocheck
/**
 * CommunityShare Component Tests
 *
 * Tests for NIP-18 repost (kind 6/16) community sharing with h-tags,
 * detection of shares by any user, native h-tag detection on original events,
 * plus backward-compat detection of legacy kind 30222 shares.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

import CommunityShare from '../shared/CommunityShare.svelte';

// --- Mocks ---

const mockCommunityPubkey1 = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222';
const mockCommunityPubkey2 = 'bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333';

const mockJoinedCommunities = [mockCommunityPubkey1, mockCommunityPubkey2];

const mockEvent = {
  id: 'event-123',
  kind: 30142,
  pubkey: 'author-pubkey',
  tags: [['d', 'test-resource-id']],
  created_at: 1700000000,
  content: ''
};

const mockActiveUser = {
  pubkey: 'user-pubkey',
  signer: { sign: vi.fn() }
};

// NIP-18 repost: current user shared mockEvent with community1 via kind 16 + h-tag
const mockRepostEvent = {
  id: 'repost-event-1',
  kind: 16,
  pubkey: 'user-pubkey',
  tags: [
    ['e', 'event-123'],
    ['a', '30142:author-pubkey:test-resource-id'],
    ['k', '30142'],
    ['p', 'author-pubkey'],
    ['h', mockCommunityPubkey1]
  ],
  created_at: 1700000100,
  content: JSON.stringify(mockEvent)
};

// NIP-18 repost by a DIFFERENT user targeting community2
const mockOtherUserRepostEvent = {
  id: 'repost-event-2',
  kind: 16,
  pubkey: 'other-user-pubkey',
  tags: [
    ['e', 'event-123'],
    ['a', '30142:author-pubkey:test-resource-id'],
    ['k', '30142'],
    ['p', 'author-pubkey'],
    ['h', mockCommunityPubkey2]
  ],
  created_at: 1700000200,
  content: JSON.stringify(mockEvent)
};

// Legacy kind 30222 share: user shared mockEvent with community2
const mockLegacyShareEvent = {
  id: 'share-event-1',
  kind: 30222,
  pubkey: 'user-pubkey',
  tags: [
    ['d', 'test-resource-id'],
    ['a', '30142:author-pubkey:test-resource-id'],
    ['e', 'event-123'],
    ['k', '30142'],
    ['p', mockCommunityPubkey2]
  ],
  created_at: 1700000100,
  content: ''
};

// Event with native h-tags (directly targeting communities)
const mockEventWithHTags = {
  id: 'event-456',
  kind: 30142,
  pubkey: 'author-pubkey',
  tags: [
    ['d', 'test-resource-with-htags'],
    ['h', mockCommunityPubkey1]
  ],
  created_at: 1700000000,
  content: ''
};

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => mockJoinedCommunities
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

// Track the SharesModel callback so tests can emit events
let _sharesModelCallback = (/** @type {any[]} */ _events) => {};
let _timelineCallback = (/** @type {any[]} */ _events) => {};

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn((_model, _arg) => ({
      subscribe: (/** @type {Function} */ cb) => {
        _sharesModelCallback = cb;
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    timeline: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        _timelineCallback = cb;
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    add: vi.fn()
  },
  pool: vi.fn()
}));

const mockCreateTimelineLoader = vi.fn(() => () => ({
  subscribe: () => ({ unsubscribe: vi.fn() })
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: (...args) => mockCreateTimelineLoader(...args)
}));

vi.mock('applesauce-common/models', () => ({
  SharesModel: 'SharesModel'
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: vi.fn(async (/** @type {any} */ draft) => await draft)
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(),
  publishEventOptimistic: vi.fn()
}));

vi.mock('applesauce-core/helpers', () => ({
  getTagValue: (/** @type {any} */ event, /** @type {string} */ tag) =>
    event?.tags?.find((/** @type {string[]} */ t) => t[0] === tag)?.[1] || '',
  getDisplayName: (/** @type {any} */ profile) => profile?.name || null,
  getAddressPointerForEvent: (/** @type {any} */ event) => ({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || ''
  }),
  getReplaceableIdentifier: (/** @type {any} */ event) =>
    event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '',
  getReplaceableAddress: (/** @type {any} */ event) =>
    event
      ? `${event.kind}:${event.pubkey}:${event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || ''}`
      : null
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: (/** @type {string[]} */ aTag) => {
    if (!aTag?.[1]) return null;
    const parts = aTag[1].split(':');
    if (parts.length < 3) return null;
    return {
      kind: parseInt(parts[0]),
      pubkey: parts[1],
      identifier: parts.slice(2).join(':')
    };
  }
}));

// Stub icon components as no-op Svelte components
function StubComponent() {}
vi.mock('$lib/components/icons', () => ({
  PlusIcon: StubComponent,
  CheckIcon: StubComponent,
  AlertIcon: StubComponent
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.test.com', 'wss://app.relay.com'],
  getEventLoaderLookupRelays: () => []
}));

describe('CommunityShare', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _sharesModelCallback = () => {};
    _timelineCallback = () => {};
    mockCreateTimelineLoader.mockImplementation(() => () => ({
      subscribe: () => ({ unsubscribe: vi.fn() })
    }));

    // Reset eventStore mocks to defaults (vi.clearAllMocks doesn't reset implementations)
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    vi.mocked(eventStore.model).mockImplementation(
      (_model, _arg) =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            _sharesModelCallback = cb;
            cb([]);
            return { unsubscribe: vi.fn() };
          }
        })
    );
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            _timelineCallback = cb;
            cb([]);
            return { unsubscribe: vi.fn() };
          }
        })
    );
  });

  it('renders community checkboxes without effect_update_depth_exceeded', () => {
    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
  });

  it('detects existing NIP-18 reposts (kind 16) with h-tag as shared', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel emits NIP-18 repost events (kind 16 with h-tag)
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // Community1 should show as shared (via h-tag on the repost) and deletable by current user
    const sharedLabels = container.querySelectorAll('.text-success');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toContain('Shared');
  });

  it('detects legacy kind 30222 shares (backward compat)', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel returns empty (no kind 6/16), timeline returns legacy share
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([]);
            return { unsubscribe: vi.fn() };
          }
        })
    );
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockLegacyShareEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // Community2 should show as shared (via legacy p-tag)
    const sharedLabels = container.querySelectorAll('.text-success');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toContain('Shared');
  });

  it('detects both NIP-18 reposts and legacy 30222 shares simultaneously', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel returns repost, timeline returns legacy
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockLegacyShareEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // Both communities should show as shared
    const sharedLabels = container.querySelectorAll('.text-success');
    expect(sharedLabels.length).toBe(2);
  });

  it('renders with synchronous model emissions without infinite loop', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    let emissionCount = 0;
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            emissionCount++;
            cb([mockRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect(emissionCount).toBe(1);
  });

  it('uses getAllLookupRelays for share detection (not just fallbackRelays)', () => {
    render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // All loader calls should use the full relay set from getAllLookupRelays
    for (const call of mockCreateTimelineLoader.mock.calls) {
      const relays = call[1];
      expect(relays).toEqual(['wss://relay.test.com', 'wss://app.relay.com']);
    }
  });

  it('detects shares with a SINGLE batched loader (one REQ, merged filters)', () => {
    render(CommunityShare, {
      props: {
        event: mockEvent, // kind 30142 is addressable (30000-40000)
        activeUser: mockActiveUser
      }
    });

    // One loader call total — every extra loader costs a relay REQ slot
    // against strfry's 20-per-connection budget (edufeed-app#18).
    expect(mockCreateTimelineLoader).toHaveBeenCalledTimes(1);

    const filters = mockCreateTimelineLoader.mock.calls[0][2];
    expect(Array.isArray(filters)).toBe(true);

    const byE = filters.find((f) => f['#e']);
    expect([...byE.kinds].sort((a, b) => a - b)).toEqual([6, 16, 30222]);
    expect(byE['#e']).toEqual(['event-123']);
    expect(byE.authors).toBeUndefined(); // detect shares by ALL users

    const byA = filters.find((f) => f['#a']);
    expect([...byA.kinds].sort((a, b) => a - b)).toEqual([6, 16, 30222]);
    expect(byA['#a']).toEqual(['30142:author-pubkey:test-resource-id']);
    expect(byA.authors).toBeUndefined();
  });

  it('omits the #a filter for non-addressable events', () => {
    render(CommunityShare, {
      props: {
        event: { ...mockEvent, kind: 1, tags: [] },
        activeUser: mockActiveUser
      }
    });

    const filters = mockCreateTimelineLoader.mock.calls[0][2];
    expect(filters.some((f) => f['#a'])).toBe(false);
    expect(filters.some((f) => f['#e'])).toBe(true);
  });

  it('shows loading state when checking shares', () => {
    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const spinners = container.querySelectorAll('.loading-spinner');
    expect(spinners.length).toBe(0);
  });

  // --- New tests for all-user share detection ---

  it('detects shares by other users as non-deletable', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel returns a repost by a DIFFERENT user
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockOtherUserRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // Community2 should show as shared by others (non-deletable)
    const sharedLabels = container.querySelectorAll('[class*="text-success"]');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toBe('(Shared by others)');

    // The checkbox should NOT be disabled — user can still share themselves
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const community2Checkbox = checkboxes[1]; // second community
    expect(community2Checkbox.disabled).toBe(false);
  });

  it('detects native h-tags on original event as non-deletable shares', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel returns empty — no reposts exist
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEventWithHTags, // has h-tag for community1
        activeUser: mockActiveUser
      }
    });

    // Community1 should show as shared via native h-tag (non-deletable, shared by others)
    const sharedLabels = container.querySelectorAll('[class*="text-success"]');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toBe('(Shared by others)');

    // The checkbox should NOT be disabled — user can still share themselves
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const community1Checkbox = checkboxes[0];
    expect(community1Checkbox.disabled).toBe(false);
  });

  it('distinguishes deletable (own) from non-deletable (other user) shares', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // SharesModel returns both: own repost for community1, other user's repost for community2
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockRepostEvent, mockOtherUserRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const sharedLabels = container.querySelectorAll('[class*="text-success"]');
    expect(sharedLabels.length).toBe(2);

    // Community1 (own share) should show "Shared - click to unshare"
    expect(sharedLabels[0].textContent).toContain('click to unshare');

    // Community2 (other user's share) should show "(Shared by others)"
    expect(sharedLabels[1].textContent).toBe('(Shared by others)');

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].disabled).toBe(false); // own share — can unshare
    expect(checkboxes[1].disabled).toBe(false); // other user's share — user can still share themselves
  });

  it('renders shared communities with a CHECKED box (checkbox reflects current state)', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockRepostEvent, mockOtherUserRepostEvent]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true); // shared (own) → checked
    expect(checkboxes[1].checked).toBe(true); // shared (by others) → checked
  });
});
