/**
 * Meet Presence Service Tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ── Hoisted mocks (available in vi.mock factories) ──

const { mockActive, mockGetReplaceable, mockSign, mockPublishEvent, mockDeleteEvent } = vi.hoisted(
  () => ({
    mockActive: { pubkey: 'user-pubkey' },
    mockGetReplaceable: vi.fn(() => ({ kind: 10222, pubkey: 'community-pk', tags: [] })),
    mockSign: vi.fn(async (/** @type {any} */ draft) => ({
      ...draft,
      id: 'signed-event-id',
      sig: 'fake-sig',
      pubkey: 'user-pubkey'
    })),
    mockPublishEvent: vi.fn(async () => {}),
    mockDeleteEvent: vi.fn(async () => ({ success: true }))
  })
);

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return mockActive.pubkey ? mockActive : null;
    },
    signer: vi.fn()
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: mockGetReplaceable
  }
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({ sign: mockSign }))
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: mockPublishEvent
}));

vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: mockDeleteEvent
}));

// ── Import after mocks ──

import { startPresence, stopPresence } from '$lib/services/meet-presence.svelte.js';

// ── Setup ──

beforeEach(() => {
  vi.useFakeTimers();
  mockActive.pubkey = 'user-pubkey';
  mockPublishEvent.mockClear();
  mockDeleteEvent.mockClear();
  mockSign.mockClear();
});

afterEach(async () => {
  await stopPresence();
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Tests ──

describe('meet-presence', () => {
  it('publishes presence event immediately on startPresence', async () => {
    await startPresence('30312:abc:room', 'community-pk');

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const signedEvent = mockPublishEvent.mock.calls[0][0];
    expect(signedEvent.kind).toBe(10312);
    expect(signedEvent.tags).toContainEqual(['a', '30312:abc:room']);
    expect(signedEvent.tags).toContainEqual(['h', 'community-pk']);
  });

  it('publishes presence periodically', async () => {
    await startPresence('30312:abc:room', 'community-pk');
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockPublishEvent).toHaveBeenCalledTimes(3);
  });

  it('stopPresence clears interval and deletes last event', async () => {
    await startPresence('30312:abc:room', 'community-pk');
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);

    await stopPresence();
    expect(mockDeleteEvent).toHaveBeenCalledTimes(1);

    // No more publishes after stop
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });

  it('stopPresence is idempotent when not started', async () => {
    await stopPresence();
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });

  it('startPresence stops previous presence first', async () => {
    await startPresence('30312:abc:room1', 'community-pk');
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);

    // Starting a second room should delete the first room's event
    await startPresence('30312:abc:room2', 'community-pk');
    expect(mockDeleteEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
  });

  it('does not publish when no active user', async () => {
    mockActive.pubkey = null;

    await startPresence('30312:abc:room', 'community-pk');
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});
