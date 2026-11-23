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
/** @type {Record<string, any>[]} */
let sent = [];
/** @type {any[]} */
let options = [];
/** @type {string[]} the deployment's learning-resource relays */
let appRelays = [];
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: (/** @type {string} */ url) => ({
      request: (/** @type {Record<string, any>} */ filter, /** @type {any} */ opts) => (
        sent.push(filter), options.push({ url, opts }), answers[url]
      )
    })
  },
  eventStore: { add: () => {} }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => Object.keys(answers)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: () => appRelays
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

  // When EVERY relay fails the stream errors, so useLearningSearch can fall
  // back to filtering the loaded feed (rankedRequest's doc comment). This test
  // asserted a clean empty completion, from a PR that predates that rule; the
  // two were merged on 2026-11-22 and the test was left behind.
  it('errors when every relay fails, so the caller can fall back', async () => {
    answers = { 'wss://one': throwError(() => new Error('x')) };
    await expect(search()).rejects.toThrow('x');
  });

  it('asks for fitting hits or the rest only when told to, and only for a text search', async () => {
    answers = { 'wss://good': of() };
    /** @param {any} filters @param {'only' | 'rest'} [fit] */
    const searchSent = async (filters, fit) => {
      sent = [];
      await lastValueFrom(ambRankedSearchLoader(filters, 10, fit).pipe(toArray()));
      return sent[0].search;
    };
    expect(await searchSent({ searchText: 'mathe' })).toBe('mathe');
    expect(await searchSent({ searchText: 'mathe' }, 'only')).toBe('mathe fit:only');
    expect(await searchSent({ searchText: 'mathe' }, 'rest')).toBe('mathe fit:rest');
    // facets alone are a filter, the relay does not judge them
    const facets = await searchSent(
      { searchText: '', about: [{ id: 'https://x/s1', label: 'Mathe' }] },
      'only'
    );
    expect(facets ?? '').not.toContain('fit:');
  });

  // A search opened as a link runs while the page starts up: the socket is
  // not open yet and the relay's answer queues behind megabytes of other
  // traffic. Measured on dev: OERSI answered 8 s after the request started,
  // and a 5 s budget dropped its hits ("Keine passenden Treffer").
  it('gives a relay enough time to answer during a busy page load', async () => {
    answers = { 'wss://good': of() };
    appRelays = [];
    options = [];
    await search();
    expect(options[0].opts.timeout).toBeGreaterThanOrEqual(12000);
  });

  // The fallback relays have no search for learning resources: one never
  // answers, and an empty search then waits out the whole budget before it
  // can say that nothing was found.
  it('asks only the learning-resource relays when the deployment names some', async () => {
    answers = { 'wss://amb': of(event('a')), 'wss://fallback': of(event('b')) };
    appRelays = ['wss://amb'];
    options = [];
    const results = await search();
    expect(options.map((o) => o.url)).toEqual(['wss://amb']);
    expect(results.map((r) => r.event.id)).toEqual(['a']);
    appRelays = [];
  });
});
