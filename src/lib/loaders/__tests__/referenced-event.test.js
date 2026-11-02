/**
 * loadReferencedEvent: a referenced event (quote, inline naddr, detail page)
 * is asked from its relay hints + the lookup relays first, and from the
 * author's NIP-65 outboxes only when that misses. A dead or slow hint relay
 * plus lookup relays that never saw the note used to be the end of the road.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMPTY, of, Subject, lastValueFrom, toArray } from 'rxjs';

const eventLoader = vi.fn();
const addressLoader = vi.fn();
const fetchRelayList = vi.fn();

vi.mock('$lib/loaders/base.js', () => ({
  eventLoader: (/** @type {any} */ p) => eventLoader(p),
  addressLoader: (/** @type {any} */ p) => addressLoader(p)
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  fetchRelayList: (/** @type {string} */ pk) => fetchRelayList(pk)
}));

const { loadReferencedEvent } = await import('../referenced-event.js');

const AUTHOR = 'a'.repeat(64);
const ID = 'e'.repeat(64);
const note = { id: ID, kind: 1, pubkey: AUTHOR, created_at: 1, tags: [], content: '' };
const POINTER = { id: ID, relays: ['wss://hint.example/', 'wss://lookup.example/'] };

/** @param {import('rxjs').Observable<any>} $ */
const all = ($) => lastValueFrom($.pipe(toArray()));

describe('loadReferencedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchRelayList.mockResolvedValue({
      writeRelays: ['wss://outbox.example', 'wss://hint.example/'],
      readRelays: []
    });
  });

  it('asks hints + lookup relays first and stops there when they answer', async () => {
    eventLoader.mockReturnValueOnce(of(note));

    expect(await all(loadReferencedEvent(POINTER, { author: AUTHOR }))).toEqual([note]);
    expect(eventLoader).toHaveBeenCalledTimes(1);
    expect(eventLoader).toHaveBeenCalledWith(POINTER);
    expect(fetchRelayList).not.toHaveBeenCalled();
  });

  it("falls back to the author's outboxes not asked yet when the first stage misses", async () => {
    eventLoader.mockReturnValueOnce(EMPTY).mockReturnValueOnce(of(note));

    expect(await all(loadReferencedEvent(POINTER, { author: AUTHOR }))).toEqual([note]);
    expect(fetchRelayList).toHaveBeenCalledWith(AUTHOR);
    // The IDB cache was already asked by the first stage
    expect(eventLoader).toHaveBeenLastCalledWith({
      id: ID,
      relays: ['wss://outbox.example/'],
      cache: false
    });
  });

  it('does not start the outbox lookup before the first stage has completed', () => {
    const first = new Subject();
    eventLoader.mockReturnValueOnce(first);
    const sub = loadReferencedEvent(POINTER, { author: AUTHOR }).subscribe();
    expect(fetchRelayList).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('ends without an outbox stage when the author is unknown', async () => {
    eventLoader.mockReturnValueOnce(EMPTY);
    expect(await all(loadReferencedEvent(POINTER))).toEqual([]);
    expect(fetchRelayList).not.toHaveBeenCalled();
  });

  it('ends when the outboxes add no new relay or there is no relay list', async () => {
    fetchRelayList.mockResolvedValueOnce({ writeRelays: ['wss://hint.example'], readRelays: [] });
    eventLoader.mockReturnValue(EMPTY);
    expect(await all(loadReferencedEvent(POINTER, { author: AUTHOR }))).toEqual([]);

    fetchRelayList.mockResolvedValueOnce(null);
    expect(await all(loadReferencedEvent(POINTER, { author: AUTHOR }))).toEqual([]);
    expect(eventLoader).toHaveBeenCalledTimes(2); // the first stage of each call only
  });

  it('uses the address loader and the naddr author for addressable pointers', async () => {
    const pointer = { kind: 30023, pubkey: AUTHOR, identifier: 'post', relays: [] };
    addressLoader.mockReturnValueOnce(EMPTY).mockReturnValueOnce(EMPTY);

    await all(loadReferencedEvent(pointer));
    expect(fetchRelayList).toHaveBeenCalledWith(AUTHOR);
    expect(addressLoader).toHaveBeenLastCalledWith({
      ...pointer,
      relays: ['wss://outbox.example/', 'wss://hint.example/'],
      cache: false
    });
    expect(eventLoader).not.toHaveBeenCalled();
  });

  it('treats a failing relay-list lookup as "no outboxes", never as an error', async () => {
    eventLoader.mockReturnValueOnce(EMPTY);
    fetchRelayList.mockRejectedValueOnce(new Error('boom'));
    expect(await all(loadReferencedEvent(POINTER, { author: AUTHOR }))).toEqual([]);
  });
});
