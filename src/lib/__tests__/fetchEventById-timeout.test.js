/**
 * fetchEventById must give relays enough time to answer. The event for a
 * thinly-replicated note can arrive several seconds after the request once a
 * cold WebSocket has connected; a too-aggressive timeout returns null and the
 * UI shows "Event not found" for an event that actually exists.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { nip19 } from 'nostr-tools';

vi.mock('$lib/loaders', () => ({
  eventLoader: vi.fn(),
  addressLoader: vi.fn(),
  loadReferencedEvent: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getEvent: () => null, getReplaceable: () => null }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => []
}));

const { fetchEventById } = await import('$lib/helpers/nostrUtils.js');
const { loadReferencedEvent } = await import('$lib/loaders');

const EVENT_ID = 'c'.repeat(64);

describe('fetchEventById timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves an event that arrives ~4s after the request', async () => {
    const event = {
      id: EVENT_ID,
      kind: 1,
      pubkey: 'a'.repeat(64),
      tags: [],
      content: '',
      sig: '',
      created_at: 0
    };
    // Relay answers 4s in — past the old 3s window, within a sane one.
    vi.mocked(loadReferencedEvent).mockReturnValue(of(event).pipe(delay(4000)));

    const nevent = nip19.neventEncode({ id: EVENT_ID });
    const promise = fetchEventById(nevent);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await promise).toEqual(event);
  });

  // Hints + lookup relays first, then the author's outboxes: a note found
  // only in the second stage arrives well after the old 8 s window.
  it('waits for the outbox stage of a reference', async () => {
    const event = {
      id: EVENT_ID,
      kind: 1,
      pubkey: 'a'.repeat(64),
      tags: [],
      content: '',
      sig: '',
      created_at: 0
    };
    vi.mocked(loadReferencedEvent).mockReturnValue(of(event).pipe(delay(12000)));

    const promise = fetchEventById(nip19.neventEncode({ id: EVENT_ID, author: 'a'.repeat(64) }));
    await vi.advanceTimersByTimeAsync(13000);

    expect(await promise).toEqual(event);
  });
});
