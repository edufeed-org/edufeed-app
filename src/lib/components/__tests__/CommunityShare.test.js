/**
 * CommunityShare Component Tests
 *
 * Regression tests for the infinite loop bug (effect_update_depth_exceeded)
 * caused by SvelteMap/SvelteSet reactive collections inside $effect callbacks.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import CommunityShare from '../shared/CommunityShare.svelte';

// --- Mocks ---

const mockCommunityPubkey1 = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222';
const mockCommunityPubkey2 = 'bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333';

// Joined communities are now string[] (pubkeys from kind 30000 follow set)
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

// Share event: user shared mockEvent with community1
const mockShareEvent = {
  id: 'share-event-1',
  kind: 30222,
  pubkey: 'user-pubkey',
  tags: [
    ['d', 'test-resource-id'],
    ['a', '30142:author-pubkey:test-resource-id'],
    ['e', 'event-123'],
    ['k', '30142'],
    ['p', mockCommunityPubkey1]
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
        // Emit synchronously (this is what triggers the infinite loop bug)
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
    // This test would fail with the SvelteMap bug: the synchronous model emission
    // inside $effect triggers read→write→re-run→infinite loop
    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
  });

  it('shows existing shares as checked when model emits share events', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    // Make model emit share events synchronously (simulates cached data)
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([mockShareEvent]);
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

    // The first community should show as shared
    const sharedLabels = container.querySelectorAll('.text-success');
    expect(sharedLabels.length).toBe(1);
    expect(sharedLabels[0].textContent).toContain('Shared');
  });

  it('renders with synchronous model emissions without infinite loop', async () => {
    // Regression: with SvelteMap, synchronous emission of non-empty share events
    // caused effect_update_depth_exceeded because loadedShares.has() (read) and
    // loadedShares.set() (write) in the same callback triggered re-runs
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    let emissionCount = 0;
    vi.mocked(eventStore.model).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            emissionCount++;
            // Emit synchronously with share events (this triggered the bug)
            cb([mockShareEvent]);
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

    // Should render without hitting effect depth limit
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    // Model subscription should only happen once (no re-runs from reactive cycle)
    expect(emissionCount).toBe(1);
  });

  it('shows loading state when checking shares', () => {
    const { container } = render(CommunityShare, {
      props: {
        event: mockEvent,
        activeUser: mockActiveUser
      }
    });

    // Component should not be stuck in infinite loading state
    const spinners = container.querySelectorAll('.loading-spinner');
    // No spinner visible (isCheckingShares should be false after model emits)
    expect(spinners.length).toBe(0);
  });
});
