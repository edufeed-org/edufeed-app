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
  addressLoader: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getEvent: () => null, getReplaceable: () => null }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => []
}));

const { fetchEventById } = await import('$lib/helpers/nostrUtils.js');
const { eventLoader } = await import('$lib/loaders');

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
    vi.mocked(eventLoader).mockReturnValue(of(event).pipe(delay(4000)));

    const nevent = nip19.neventEncode({ id: EVENT_ID });
    const promise = fetchEventById(nevent);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await promise).toEqual(event);
  });
});
