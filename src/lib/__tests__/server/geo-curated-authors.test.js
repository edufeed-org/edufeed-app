/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  resolveAuthors,
  resolveCuratedAuthorSet,
  createCuratedAuthorsCache
} from '$lib/server/geo/curated-authors.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('resolveAuthors', () => {
  it('returns null (nothing configured) without curation', async () => {
    expect(await resolveAuthors({ sets: [], direct: [] }, [], vi.fn())).toBeNull();
    expect(await resolveAuthors(null, [], vi.fn())).toBeNull();
  });

  it('unions set members, direct pubkeys (npub or hex) and WoT anchors', async () => {
    const set = nip19.naddrEncode({
      kind: 30000,
      pubkey: A,
      identifier: 'list',
      relays: ['wss://r.example']
    });
    const fetchFirst = vi.fn(async () => ({
      kind: 30000,
      pubkey: A,
      tags: [
        ['d', 'list'],
        ['p', B],
        ['p', 'junk']
      ]
    }));
    const authors = await resolveAuthors(
      { sets: [set], direct: [nip19.npubEncode(A)] },
      [C],
      /** @type {any} */ (fetchFirst)
    );
    expect(authors?.sort()).toEqual([A, B, C].sort());
    expect(fetchFirst).toHaveBeenCalledWith(
      { kinds: [30000], authors: [A], '#d': ['list'], limit: 1 },
      expect.arrayContaining(['wss://r.example'])
    );
  });

  it('returns an empty list when curated sets cannot be resolved', async () => {
    const set = nip19.naddrEncode({ kind: 30000, pubkey: A, identifier: 'list', relays: [] });
    expect(
      await resolveAuthors(
        { sets: [set], direct: [] },
        [],
        vi.fn(async () => null)
      )
    ).toEqual([]);
  });
});

describe('resolveCuratedAuthorSet', () => {
  it('unions the article and learning-resource categories', async () => {
    const set = await resolveCuratedAuthorSet(
      { CURATED_PUBKEYS_LONGFORM: A, CURATED_PUBKEYS_EDUCATIONAL: B, CURATED_PUBKEYS_CALENDAR: C },
      /** @type {any} */ (vi.fn())
    );
    expect([...set].sort()).toEqual([A, B].sort());
  });

  it('adds WoT anchors only when WoT is enabled', async () => {
    const off = await resolveCuratedAuthorSet(
      { WOT_ANCHOR_PUBKEYS: C },
      /** @type {any} */ (vi.fn())
    );
    expect(off.size).toBe(0);
    const on = await resolveCuratedAuthorSet(
      { WOT_ENABLED: 'true', WOT_ANCHOR_PUBKEYS: C },
      /** @type {any} */ (vi.fn())
    );
    expect([...on]).toEqual([C]);
  });
});

describe('createCuratedAuthorsCache', () => {
  it('waits at most maxWaitMs for the first resolution', async () => {
    const cache = createCuratedAuthorsCache({ resolve: () => new Promise(() => {}), ttlMs: 1000 });
    expect(await cache.get(20)).toBeNull();
  });

  it('serves the cached set and refreshes it in the background when stale', async () => {
    let now = 0;
    let n = 0;
    const resolve = vi.fn(async () => new Set([`k${++n}`]));
    const cache = createCuratedAuthorsCache({ resolve, ttlMs: 1000, now: () => now });
    expect([.../** @type {Set<string>} */ (await cache.get(1000))]).toEqual(['k1']);
    now = 2000;
    expect([.../** @type {Set<string>} */ (await cache.get(1000))]).toEqual(['k1']);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect([.../** @type {Set<string>} */ (await cache.get(1000))]).toEqual(['k2']);
  });

  it('keeps the last good set when a refresh fails', async () => {
    let now = 0;
    let fail = false;
    const cache = createCuratedAuthorsCache({
      resolve: async () => {
        if (fail) throw new Error('down');
        return new Set(['ok']);
      },
      ttlMs: 1000,
      now: () => now
    });
    await cache.get(1000);
    fail = true;
    now = 5000;
    expect([.../** @type {Set<string>} */ (await cache.get(1000))]).toEqual(['ok']);
  });
});
