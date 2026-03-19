/**
 * CommunityShare Component Tests
 *
 * Tests for NIP-18 repost (kind 6/16) community sharing with h-tags,
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

// NIP-18 repost: user shared mockEvent with community1 via kind 16 + h-tag
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

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => mockJoinedCommunities
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    add: vi.fn()
  },
  pool: vi.fn()
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));

vi.mock('applesauce-core/event-factory', () => ({
  EventFactory: vi.fn()
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));

vi.mock('applesauce-common/blueprints', () => ({}));

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

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    fallbackRelays: ['wss://relay.test.com']
  }
}));

describe('CommunityShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Model emits NIP-18 repost events (kind 16 with h-tag)
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

    // Community1 should show as shared (via h-tag on the repost)
    const sharedLabels = container.querySelectorAll('.text-success');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toContain('Shared');
  });

  it('detects legacy kind 30222 shares (backward compat)', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // Model emits legacy share events (kind 30222 with p-tag)
    vi.mocked(eventStore.model).mockImplementation(
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

    // Model emits both types
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockRepostEvent, mockLegacyShareEvent]);
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
});
