/**
 * NIP-89 handler discovery for an event kind the app cannot render.
 *
 * Two legs, per the NIP's user flow: recommendations (kind 31989, `d` =
 * the kind) by the user and their follows come first — their `a` tags name
 * the kind 31990 handler events to fetch — then a direct `#k` query for
 * handlers nobody in the follow graph vouched for. Recommended handlers
 * sort first; the rest newest first. Everything degrades to "no handlers":
 * relay down, feature off, no follows.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, EMPTY, throwError } from 'rxjs';

const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);
const APP_C = 'c'.repeat(64);
const ME = 'e'.repeat(64);
const FRIEND = 'f'.repeat(64);

const infra = vi.hoisted(() => ({
  request: vi.fn(),
  add: vi.fn()
}));
const cfg = vi.hoisted(() => ({ relays: ['wss://handlers.example'] }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: infra.request },
  eventStore: { add: infra.add }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAppHandlerRelays: () => cfg.relays
}));

/**
 * @param {string} pubkey
 * @param {string} d
 * @param {number} created_at
 * @param {string} [name]
 */
function handlerEvent(pubkey, d, created_at, name = d) {
  return {
    kind: 31990,
    id: `${d}-${created_at}`,
    pubkey,
    created_at,
    content: JSON.stringify({ name }),
    tags: [
      ['d', d],
      ['k', '30617'],
      ['web', `https://${d}.example/<bech32>`]
    ]
  };
}

/**
 * @param {string} recommender
 * @param {string[]} addresses
 */
function recommendation(recommender, addresses) {
  return {
    kind: 31989,
    id: `rec-${recommender.slice(0, 4)}`,
    pubkey: recommender,
    created_at: 1,
    content: '',
    tags: [['d', '30617'], ...addresses.map((a) => ['a', a, 'wss://relay1', 'web'])]
  };
}

/** Route pool.request by filter shape. @param {(filter: any) => any[]} answer */
function answerWith(answer) {
  infra.request.mockImplementation((_relays, filters) => {
    const filter = Array.isArray(filters) ? filters[0] : filters;
    return of(...answer(filter));
  });
}

describe('loadAppHandlers', () => {
  beforeEach(() => {
    infra.request.mockReset();
    infra.add.mockReset();
    cfg.relays = ['wss://handlers.example'];
  });

  it('puts handlers recommended by the follow graph first, then the direct #k hits newest first', async () => {
    const recA = handlerEvent(APP_A, 'alpha', 10);
    const direct = [handlerEvent(APP_B, 'beta', 50), handlerEvent(APP_C, 'gamma', 90)];
    answerWith((filter) => {
      if (filter.kinds?.[0] === 31989) {
        expect(filter['#d']).toEqual(['30617']);
        expect(filter.authors).toEqual([ME, FRIEND]);
        return [recommendation(FRIEND, [`31990:${APP_A}:alpha`])];
      }
      if (filter.kinds?.[0] === 31990 && filter.authors) {
        expect(filter.authors).toEqual([APP_A]);
        expect(filter['#d']).toEqual(['alpha']);
        return [recA];
      }
      if (filter.kinds?.[0] === 31990 && filter['#k']) {
        expect(filter['#k']).toEqual(['30617']);
        return [...direct, recA]; // the direct query may return the recommended one too
      }
      throw new Error(`unexpected filter ${JSON.stringify(filter)}`);
    });

    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');
    const result = await loadAppHandlers(30617, { authors: [ME, FRIEND] });

    expect(result.map((h) => [h.identifier, h.recommended])).toEqual([
      ['alpha', true],
      ['gamma', false],
      ['beta', false]
    ]);
    // Every handler event lands in the EventStore (profiles & co. can reuse it).
    expect(infra.add).toHaveBeenCalledWith(recA);
    expect(infra.add).toHaveBeenCalledWith(direct[0]);
  });

  it('skips the recommendation leg when there are no authors to ask about', async () => {
    answerWith((filter) => {
      expect(filter.kinds).toEqual([31990]);
      expect(filter['#k']).toEqual(['30617']);
      return [handlerEvent(APP_B, 'beta', 50)];
    });
    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');
    const result = await loadAppHandlers(30617, { authors: [] });
    expect(infra.request).toHaveBeenCalledTimes(1);
    expect(result.map((h) => h.identifier)).toEqual(['beta']);
  });

  it('keeps only the newest event per handler address and drops unparsable ones', async () => {
    answerWith(() => [
      handlerEvent(APP_B, 'beta', 50, 'Old'),
      handlerEvent(APP_B, 'beta', 70, 'New'),
      { kind: 31990, id: 'x', pubkey: APP_C, created_at: 1, content: '', tags: [['d', 'nourl']] }
    ]);
    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');
    const result = await loadAppHandlers(30617, { authors: [] });
    expect(result.map((h) => h.name)).toEqual(['New']);
  });

  it('does not offer handlers that do not list the kind in a k tag', async () => {
    // A relay that ignores `#k` must not make us advertise a kind-1-only app.
    const wrongKind = {
      ...handlerEvent(APP_B, 'beta', 50),
      tags: [
        ['d', 'beta'],
        ['k', '1'],
        ['web', 'https://b/<bech32>']
      ]
    };
    answerWith(() => [wrongKind]);
    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');
    expect(await loadAppHandlers(30617, { authors: [] })).toEqual([]);
  });

  it('resolves to [] when the feature has no relays or a relay errors', async () => {
    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');

    cfg.relays = [];
    expect(await loadAppHandlers(30617, { authors: [ME] })).toEqual([]);
    expect(infra.request).not.toHaveBeenCalled();

    cfg.relays = ['wss://handlers.example'];
    infra.request.mockImplementation(() => throwError(() => new Error('boom')));
    expect(await loadAppHandlers(30617, { authors: [ME] })).toEqual([]);

    infra.request.mockImplementation(() => EMPTY);
    expect(await loadAppHandlers(30617, { authors: [] })).toEqual([]);
  });

  it('chunks long follow lists so no single REQ carries more than 250 authors', async () => {
    const authors = Array.from({ length: 600 }, (_, i) => i.toString(16).padStart(64, '0'));
    /** @type {number[]} */
    const sizes = [];
    answerWith((filter) => {
      if (filter.kinds?.[0] === 31989) sizes.push(filter.authors.length);
      return [];
    });
    const { loadAppHandlers } = await import('$lib/loaders/app-handlers.js');
    await loadAppHandlers(30617, { authors });
    expect(sizes).toEqual([250, 250, 100]);
  });
});
