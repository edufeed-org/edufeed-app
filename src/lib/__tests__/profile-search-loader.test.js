/**
 * profile-search.js — the synchronous "people I have already seen" search
 * and the kind-0 → EnrichedContact adapter that ContactSearchInput's
 * `searchProfiles` mode builds on.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {any[]} */
let storedProfiles = [];

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getByFilters: vi.fn(() => storedProfiles),
    add: vi.fn()
  },
  pool: { request: vi.fn() }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup.example.com'],
  getProfileSearchRelays: () => ['wss://search.example.com']
}));

const { searchKnownProfiles, profileToContact, profileMatches } = await import(
  '$lib/loaders/profile-search.js'
);

/**
 * @param {string} pubkey
 * @param {Record<string, unknown>} content
 */
function kind0(pubkey, content) {
  return { kind: 0, pubkey, created_at: 1, tags: [], content: JSON.stringify(content) };
}

const COLIBRI = 'c'.repeat(64);
const FRAMA = 'f'.repeat(64);
const ALICE = 'a'.repeat(64);

beforeEach(() => {
  storedProfiles = [
    kind0(COLIBRI, { name: 'colibri', display_name: 'Colibri', picture: 'https://x/c.png' }),
    kind0(FRAMA, { name: 'Framasoft', nip05: 'hello@framasoft.org' }),
    kind0(ALICE, { display_name: 'Alice Smith' })
  ];
});

describe('profileToContact', () => {
  it('maps a kind-0 event to the EnrichedContact shape', () => {
    expect(profileToContact(storedProfiles[0])).toEqual({
      pubkey: COLIBRI,
      name: 'colibri',
      display_name: 'Colibri',
      picture: 'https://x/c.png',
      nip05: null,
      about: null
    });
  });

  it('returns null for an event whose content is not a profile', () => {
    expect(profileToContact({ kind: 0, pubkey: ALICE, tags: [], content: 'not json' })).toBeNull();
  });
});

describe('profileMatches', () => {
  it('matches name, display_name and nip05 case-insensitively', () => {
    const c = profileToContact(storedProfiles[1]);
    expect(profileMatches(c, 'frama')).toBe(true);
    expect(profileMatches(c, 'FRAMASOFT.ORG')).toBe(true);
    expect(profileMatches(c, 'colibri')).toBe(false);
  });
});

describe('searchKnownProfiles', () => {
  it('returns profiles already in the EventStore whose name matches', () => {
    const results = searchKnownProfiles('coli');
    expect(results.map((c) => c.pubkey)).toEqual([COLIBRI]);
  });

  it('matches on nip05 too', () => {
    expect(searchKnownProfiles('framasoft.org').map((c) => c.pubkey)).toEqual([FRAMA]);
  });

  it('returns nothing for a term shorter than two characters', () => {
    expect(searchKnownProfiles('c')).toEqual([]);
    expect(searchKnownProfiles('')).toEqual([]);
  });

  it('honours the limit and the exclude list', () => {
    storedProfiles = Array.from({ length: 5 }, (_, i) =>
      kind0(String(i).repeat(64), { name: `tester ${i}` })
    );
    expect(searchKnownProfiles('tester', 2)).toHaveLength(2);
    expect(
      searchKnownProfiles('tester', 10, { exclude: ['0'.repeat(64)] }).map((c) => c.pubkey)
    ).not.toContain('0'.repeat(64));
  });

  it('skips events with unparseable content instead of throwing', () => {
    storedProfiles = [
      { kind: 0, pubkey: ALICE, tags: [], content: '{broken' },
      kind0(COLIBRI, { name: 'colibri' })
    ];
    expect(searchKnownProfiles('coli').map((c) => c.pubkey)).toEqual([COLIBRI]);
  });
});
