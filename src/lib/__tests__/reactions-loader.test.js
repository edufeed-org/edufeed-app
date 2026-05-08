/**
 * Unit tests for reactions loader wrapper
 * Tests that reactionsLoader queries both seen relays AND author inbox relays
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

// Track all calls to the base loader
/** @type {{event: any, relays: any}[]} */
let baseLoaderCalls = [];
/** @type {import('rxjs').Subject<any>[]} */
let baseLoaderSubjects = [];

vi.mock('applesauce-loaders/loaders', () => ({
  createReactionsLoader: vi.fn(() => {
    // Return a function that acts as the base loader
    return (/** @type {any} */ event, /** @type {any} */ relays) => {
      const subject = new Subject();
      baseLoaderCalls.push({ event, relays });
      baseLoaderSubjects.push(subject);
      return subject.asObservable();
    };
  })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: {}
}));

vi.mock('$lib/loaders/base.js', () => ({
  createCachedTimelineLoader: vi.fn()
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [] }
}));

// Mock getReadRelays — resolved value controlled per test
let mockGetReadRelays = vi.fn();
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getReadRelays: (/** @type {any[]} */ ...args) => mockGetReadRelays(...args)
}));

describe('reactionsLoader wrapper', () => {
  beforeEach(() => {
    baseLoaderCalls = [];
    baseLoaderSubjects = [];
    mockGetReadRelays.mockReset();
  });

  it('calls base loader with original relays', async () => {
    mockGetReadRelays.mockResolvedValue([]);

    const { reactionsLoader } = await import('$lib/loaders/reactions.js');

    const event = /** @type {any} */ ({ id: 'evt1', pubkey: 'author1', tags: [] });
    const relays = ['wss://seen.relay'];

    reactionsLoader(event, relays).subscribe();

    // Base loader called immediately with original args
    expect(baseLoaderCalls[0]).toEqual({ event, relays });
  });

  it('also queries author inbox relays from getReadRelays', async () => {
    mockGetReadRelays.mockResolvedValue(['wss://inbox1.relay', 'wss://inbox2.relay']);

    const { reactionsLoader } = await import('$lib/loaders/reactions.js');

    const event = /** @type {any} */ ({ id: 'evt2', pubkey: 'author2', tags: [] });
    reactionsLoader(event).subscribe();

    // Wait for async getReadRelays to resolve
    await vi.waitFor(() => {
      expect(baseLoaderCalls.length).toBe(2);
    });

    expect(mockGetReadRelays).toHaveBeenCalledWith('author2');
    expect(baseLoaderCalls[1]).toEqual({
      event,
      relays: ['wss://inbox1.relay', 'wss://inbox2.relay']
    });
  });

  it('merges events from both sources', async () => {
    mockGetReadRelays.mockResolvedValue(['wss://inbox.relay']);

    const { reactionsLoader } = await import('$lib/loaders/reactions.js');

    const event = /** @type {any} */ ({ id: 'evt3', pubkey: 'author3', tags: [] });
    /** @type {any[]} */
    const received = [];

    reactionsLoader(event).subscribe((/** @type {any} */ evt) => received.push(evt));

    // Wait for inbox loader to be created
    await vi.waitFor(() => {
      expect(baseLoaderSubjects.length).toBe(2);
    });

    // Emit from base (seen relays)
    baseLoaderSubjects[baseLoaderSubjects.length - 2].next({ id: 'reaction-from-seen' });
    // Emit from inbox
    baseLoaderSubjects[baseLoaderSubjects.length - 1].next({ id: 'reaction-from-inbox' });

    expect(received).toEqual([{ id: 'reaction-from-seen' }, { id: 'reaction-from-inbox' }]);
  });

  it('skips inbox call when getReadRelays returns empty array', async () => {
    mockGetReadRelays.mockResolvedValue([]);

    const { reactionsLoader } = await import('$lib/loaders/reactions.js');

    const event = /** @type {any} */ ({ id: 'evt4', pubkey: 'author4', tags: [] });
    reactionsLoader(event).subscribe();

    // Give async code time to resolve
    await new Promise((r) => setTimeout(r, 50));

    // Only the base call, no inbox call
    const callsForThisTest = baseLoaderCalls.filter((c) => c.event.id === 'evt4');
    expect(callsForThisTest.length).toBe(1);
  });

  it('still works when getReadRelays rejects', async () => {
    mockGetReadRelays.mockRejectedValue(new Error('relay fetch failed'));

    const { reactionsLoader } = await import('$lib/loaders/reactions.js');

    const event = /** @type {any} */ ({ id: 'evt5', pubkey: 'author5', tags: [] });
    /** @type {any[]} */
    const received = [];

    reactionsLoader(event).subscribe((/** @type {any} */ evt) => received.push(evt));

    // Give async code time to reject
    await new Promise((r) => setTimeout(r, 50));

    // Base loader still works — find the subject for this test's base call
    const baseCallIndex = baseLoaderCalls.findIndex((c) => c.event.id === 'evt5');
    baseLoaderSubjects[baseCallIndex].next({ id: 'reaction-despite-error' });

    expect(received).toEqual([{ id: 'reaction-despite-error' }]);
  });
});
