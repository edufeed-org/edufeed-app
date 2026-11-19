/**
 * The ranked learning search asks every educational relay, fallback relays
 * included. One relay that fails must not take the search down with it.
 */
import { describe, it, expect, vi } from 'vitest';
import { of, throwError, concat } from 'rxjs';
import { lastValueFrom, toArray } from 'rxjs';

/** @param {string} id */
const event = (id) => ({ id, kind: 30142, pubkey: 'p', created_at: 1, tags: [], content: '' });

/** @type {Record<string, import('rxjs').Observable<any>>} */
let answers = {};
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (/** @type {string} */ url) => ({ request: () => answers[url] }) },
  eventStore: { add: () => {} }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => Object.keys(answers)
}));

const { ambRankedSearchLoader } = await import('../amb-search.js');
const search = () =>
  lastValueFrom(ambRankedSearchLoader({ searchText: 'mathe' }, 10).pipe(toArray()));

describe('ambRankedSearchLoader', () => {
  it('keeps the other relays results when one relay errors', async () => {
    answers = {
      'wss://good': of(event('a'), event('b')),
      // a relay without NIP-50 that never answers the REQ: the request times out
      'wss://silent': throwError(() => new Error('Timeout has occurred')),
      'wss://refuses': concat(
        of(event('c')),
        throwError(() => new Error('error: bad req'))
      )
    };
    const results = await search();
    expect(results.map((r) => [r.event.id, r.relay, r.rank])).toEqual([
      ['a', 'wss://good', 1],
      ['b', 'wss://good', 2],
      ['c', 'wss://refuses', 1]
    ]);
  });

  it('still completes when every relay fails', async () => {
    answers = { 'wss://one': throwError(() => new Error('x')) };
    expect(await search()).toEqual([]);
  });
});
