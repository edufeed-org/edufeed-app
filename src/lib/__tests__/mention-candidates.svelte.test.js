// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useMentionCandidates(getQuery) — rows for the composer's `@` people
 * picker: the people search (follows → known → NIP-50, trust-ranked) capped
 * at 8, minus the active user, shaped for MentionAutocomplete. `null` from
 * the query getter means the picker is closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const ME = 'e'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const search = vi.hoisted(() => ({ results: [], lastArgs: null }));

vi.mock('$lib/stores/people-search.svelte.js', () => ({
  usePeopleSearch: (getQuery, options) => {
    search.lastArgs = options;
    return () => ({
      term: getQuery() ?? '',
      tooShort: false,
      busy: false,
      results: search.results,
      scores: new Map()
    });
  }
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));

const contact = (pubkey, name, display_name = null, picture = null) => ({
  pubkey,
  name,
  display_name,
  picture,
  nip05: null,
  about: null
});

describe('useMentionCandidates', () => {
  let useMentionCandidates;
  let cleanup;

  beforeEach(async () => {
    search.results = [];
    search.lastArgs = null;
    ({ useMentionCandidates } = await import('$lib/stores/mention-candidates.svelte.js'));
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function mount(initial) {
    let query = $state(initial);
    let get;
    cleanup = $effect.root(() => {
      get = useMentionCandidates(() => query);
    });
    flushSync();
    return {
      get: () => get(),
      set: (q) => {
        query = q;
        flushSync();
      }
    };
  }

  it('asks people search for 8 results with minTerm 0', () => {
    mount('');
    expect(search.lastArgs).toMatchObject({ limit: 8, minTerm: 0 });
  });

  it('maps contacts to rows, prefers display_name, excludes the active user', () => {
    search.results = [
      contact(ME, 'me'),
      contact(ALICE, 'alice', 'Alice W.', 'https://x/a.png'),
      contact(BOB, null)
    ];
    const { get } = mount('a');
    expect(get()).toEqual([
      {
        pubkey: ALICE,
        name: 'Alice W.',
        profile: { name: 'alice', display_name: 'Alice W.', picture: 'https://x/a.png' }
      },
      {
        pubkey: BOB,
        name: 'bbbbbbbb...',
        profile: { name: null, display_name: null, picture: null }
      }
    ]);
  });

  it('caps the rows at 8', () => {
    search.results = Array.from({ length: 12 }, (_, i) =>
      contact(String(i).padStart(64, '0'), `person${i}`)
    );
    const { get } = mount('p');
    expect(get()).toHaveLength(8);
  });

  it('returns nothing while the query is null (picker closed)', () => {
    search.results = [contact(ALICE, 'alice')];
    const { get, set } = mount(null);
    expect(get()).toEqual([]);
    set('');
    expect(get()).toHaveLength(1);
  });
});
