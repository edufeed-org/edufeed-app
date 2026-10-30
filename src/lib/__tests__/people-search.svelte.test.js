// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * usePeopleSearch(getQuery) — the page-level profile search behind the
 * discover "Personen" tab. Same sources and order as ContactSearchInput's
 * searchProfiles mode (follows → locally known → NIP-50 relays, each pubkey
 * once, non-follows by NIP-85 rank), exposed as a reactive result list
 * instead of a dropdown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';
import { trust } from '../components/__tests__/fixtures/trust-scores-mock.svelte.js';
import { directory } from '../components/__tests__/fixtures/member-directory-mock.svelte.js';
import { nip19 } from 'nostr-tools';

const ALICE = 'a'.repeat(64);
const REAL = 'd'.repeat(64);
const FAKE = 'e'.repeat(64);
const NOBODY = '9'.repeat(64);

const contact = (pubkey, name) => ({
  pubkey,
  name,
  display_name: name,
  picture: null,
  nip05: null,
  about: null
});

const profileSearch = vi.hoisted(() => ({
  searchKnownProfiles: vi.fn(() => []),
  profileNameSearchLoader: vi.fn(),
  remote: /** @type {any} */ (null),
  unsubscribed: 0
}));
const contacts = vi.hoisted(() => ({ searchContacts: vi.fn(() => []) }));

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: { searchContacts: contacts.searchContacts }
}));
vi.mock('$lib/loaders/profile-search.js', () => ({
  searchKnownProfiles: profileSearch.searchKnownProfiles,
  profileNameSearchLoader: profileSearch.profileNameSearchLoader,
  profileToContact: (event) => {
    const c = JSON.parse(event.content);
    return {
      pubkey: event.pubkey,
      name: c.name ?? null,
      display_name: null,
      picture: null,
      nip05: null,
      about: null
    };
  },
  profileMatches: (c, term) => (c.name || '').toLowerCase().includes(term.toLowerCase())
}));
vi.mock(
  '$lib/stores/trust-scores.svelte.js',
  () => import('../components/__tests__/fixtures/trust-scores-mock.svelte.js')
);
vi.mock(
  '$lib/stores/member-directory.svelte.js',
  () => import('../components/__tests__/fixtures/member-directory-mock.svelte.js')
);

const kind0 = (pubkey, name) => ({ kind: 0, pubkey, tags: [], content: JSON.stringify({ name }) });

describe('usePeopleSearch', () => {
  let usePeopleSearch;
  let cleanup;

  beforeEach(async () => {
    vi.useFakeTimers();
    trust.scores = new Map();
    directory.members = new Set();
    directory.ensured = 0;
    contacts.searchContacts.mockReset();
    contacts.searchContacts.mockReturnValue([]);
    profileSearch.searchKnownProfiles.mockReset();
    profileSearch.searchKnownProfiles.mockReturnValue([]);
    profileSearch.unsubscribed = 0;
    profileSearch.remote = new Subject();
    profileSearch.profileNameSearchLoader.mockReset();
    profileSearch.profileNameSearchLoader.mockImplementation(() => {
      const subject = profileSearch.remote;
      const subscribe = subject.subscribe.bind(subject);
      subject.subscribe = (...args) => {
        const sub = subscribe(...args);
        const unsub = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
          if (!sub.closed) profileSearch.unsubscribed++;
          unsub();
        };
        return sub;
      };
      return subject;
    });
    ({ usePeopleSearch } = await import('$lib/stores/people-search.svelte.js'));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
  });

  function mountWith(initial) {
    let query = $state(initial);
    let get;
    cleanup = $effect.root(() => {
      get = usePeopleSearch(() => query);
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

  it('does nothing for a query shorter than two characters', () => {
    const { get } = mountWith(' l ');
    vi.advanceTimersByTime(1000);
    expect(get()).toMatchObject({ term: 'l', results: [], busy: false, tooShort: true });
    expect(profileSearch.profileNameSearchLoader).not.toHaveBeenCalled();
    expect(contacts.searchContacts).not.toHaveBeenCalled();
  });

  it('lists follows and known profiles synchronously, then appends debounced relay hits once', () => {
    contacts.searchContacts.mockReturnValue([contact(ALICE, 'Alice')]);
    profileSearch.searchKnownProfiles.mockReturnValue([
      contact(ALICE, 'Alice (stale)'),
      contact(REAL, 'Laeserin')
    ]);
    const { get } = mountWith('la');
    expect(get().results.map((c) => c.pubkey)).toEqual([ALICE, REAL]);
    expect(get().busy).toBe(false);
    expect(profileSearch.profileNameSearchLoader).not.toHaveBeenCalled();

    vi.advanceTimersByTime(350);
    flushSync();
    expect(profileSearch.profileNameSearchLoader).toHaveBeenCalledWith('la', expect.any(Number));
    expect(get().busy).toBe(true);

    profileSearch.remote.next(kind0(FAKE, 'Laeserin (fake)'));
    profileSearch.remote.next(kind0(REAL, 'Laeserin')); // duplicate of a known row
    profileSearch.remote.next(kind0(NOBODY, 'Framasoft')); // fuzzy relay hit, no match
    flushSync();
    expect(get().results.map((c) => c.pubkey)).toEqual([ALICE, REAL, FAKE]);

    profileSearch.remote.complete();
    flushSync();
    expect(get().busy).toBe(false);
  });

  it('keeps follows first and orders everyone else by trust rank, unscored last', () => {
    contacts.searchContacts.mockReturnValue([contact(ALICE, 'Alice')]);
    profileSearch.searchKnownProfiles.mockReturnValue([
      contact(FAKE, 'Laeserin (fake)'),
      contact(NOBODY, 'Laeserin (new)'),
      contact(REAL, 'Laeserin')
    ]);
    trust.scores = new Map([
      [REAL, { pubkey: REAL, rank: 69 }],
      [FAKE, { pubkey: FAKE, rank: 3 }],
      [ALICE, { pubkey: ALICE, rank: 1 }]
    ]);
    const { get } = mountWith('lae');
    expect(get().results.map((c) => c.pubkey)).toEqual([ALICE, REAL, FAKE, NOBODY]);
    expect(get().scores.get(REAL)).toMatchObject({ rank: 69 });
  });

  it('re-sorts when a score arrives after the results', () => {
    profileSearch.searchKnownProfiles.mockReturnValue([
      contact(NOBODY, 'Laeserin (new)'),
      contact(REAL, 'Laeserin')
    ]);
    const { get } = mountWith('lae');
    expect(get().results.map((c) => c.pubkey)).toEqual([NOBODY, REAL]);
    trust.scores = new Map([[REAL, { pubkey: REAL, rank: 69 }]]);
    trust.bump();
    flushSync();
    expect(get().results.map((c) => c.pubkey)).toEqual([REAL, NOBODY]);
  });

  it('a new query cancels the pending timer and the in-flight relay request', () => {
    const { get, set } = mountWith('la');
    vi.advanceTimersByTime(100);
    set('lae');
    vi.advanceTimersByTime(350);
    flushSync();
    expect(profileSearch.profileNameSearchLoader).toHaveBeenCalledTimes(1);
    expect(profileSearch.profileNameSearchLoader).toHaveBeenCalledWith('lae', expect.any(Number));

    profileSearch.remote = new Subject();
    set('laes');
    expect(profileSearch.unsubscribed).toBe(1);
    expect(get().busy).toBe(false);
    expect(get().term).toBe('laes');
  });

  it('a relay error leaves the local results in place and clears busy', () => {
    profileSearch.searchKnownProfiles.mockReturnValue([contact(REAL, 'Laeserin')]);
    const { get } = mountWith('lae');
    vi.advanceTimersByTime(350);
    flushSync();
    profileSearch.remote.error(new Error('relay down'));
    flushSync();
    expect(get().results.map((c) => c.pubkey)).toEqual([REAL]);
    expect(get().busy).toBe(false);
  });

  it('tears down the relay subscription with the owner', () => {
    mountWith('lae');
    vi.advanceTimersByTime(350);
    flushSync();
    cleanup();
    cleanup = undefined;
    expect(profileSearch.unsubscribed).toBe(1);
  });

  function mountWithOptions(initial, options) {
    let query = $state(initial);
    let get;
    cleanup = $effect.root(() => {
      get = usePeopleSearch(() => query, options);
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

  it('with minTerm 0 lists follows for an empty term and never fires the remote leg under two chars', () => {
    contacts.searchContacts.mockReturnValue([contact(ALICE, 'Alice')]);
    const { get, set } = mountWithOptions('', { minTerm: 0, limit: 8 });
    expect(get().tooShort).toBe(false);
    expect(get().results.map((c) => c.pubkey)).toEqual([ALICE]);
    expect(contacts.searchContacts).toHaveBeenCalledWith('', 8);
    vi.advanceTimersByTime(1000);
    expect(profileSearch.profileNameSearchLoader).not.toHaveBeenCalled();

    set('a');
    vi.advanceTimersByTime(1000);
    expect(profileSearch.profileNameSearchLoader).not.toHaveBeenCalled();

    set('al');
    vi.advanceTimersByTime(350);
    flushSync();
    expect(profileSearch.profileNameSearchLoader).toHaveBeenCalledWith('al', 8);
  });
  describe("members of the deployment's NIP-05 directory", () => {
    /** Known-profile mock: the members leg (authors option) answers from `members`. */
    function knownBy({ members = [], everyone = [] }) {
      profileSearch.searchKnownProfiles.mockImplementation((_term, _limit, opts = {}) =>
        opts.authors ? members.filter((c) => opts.authors.includes(c.pubkey)) : everyone
      );
    }

    it('loads the directory when the search mounts', () => {
      mountWith('');
      expect(directory.ensured).toBe(1);
    });

    it('puts verified members first, as their own group', () => {
      directory.members = new Set([REAL]);
      knownBy({ everyone: [contact(FAKE, 'Laeserin (fake)'), contact(REAL, 'Laeserin')] });
      trust.scores = new Map([[FAKE, { pubkey: FAKE, rank: 90 }]]);
      const { get } = mountWith('lae');
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
      expect(get().otherResults.map((c) => c.pubkey)).toEqual([FAKE]);
      expect(get().results.map((c) => c.pubkey)).toEqual([REAL, FAKE]);
    });

    it('a followed member sits in the members group, other follows lead the rest', () => {
      directory.members = new Set([REAL]);
      contacts.searchContacts.mockReturnValue([contact(ALICE, 'Alice'), contact(REAL, 'Al')]);
      knownBy({ everyone: [contact(FAKE, 'Alfons')] });
      const { get } = mountWith('al');
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
      expect(get().otherResults.map((c) => c.pubkey)).toEqual([ALICE, FAKE]);
    });

    it('finds members among their own profiles, however many others match', () => {
      directory.members = new Set([REAL]);
      knownBy({
        members: [contact(REAL, 'Paula GR')],
        everyone: [contact(FAKE, 'Paula Vieira')] // capped list without the member
      });
      const { get } = mountWith('paula');
      expect(profileSearch.searchKnownProfiles).toHaveBeenCalledWith(
        'paula',
        expect.any(Number),
        expect.objectContaining({ authors: [REAL] })
      );
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
    });

    it('re-runs the query once the directory and its profiles arrive', () => {
      const { get } = mountWith('paula');
      expect(get().memberResults).toEqual([]);
      directory.members = new Set([REAL]);
      knownBy({ members: [contact(REAL, 'Paula GR')] });
      directory.bump();
      flushSync();
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
    });

    it('relay hits from members join the members group', () => {
      directory.members = new Set([REAL]);
      const { get } = mountWith('lae');
      vi.advanceTimersByTime(350);
      flushSync();
      profileSearch.remote.next(kind0(FAKE, 'Laeserin (fake)'));
      profileSearch.remote.next(kind0(REAL, 'Laeserin'));
      flushSync();
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
      expect(get().otherResults.map((c) => c.pubkey)).toEqual([FAKE]);
    });
  });

  describe('a pasted key', () => {
    it.each([
      ['npub', () => nip19.npubEncode(REAL)],
      ['nprofile', () => nip19.nprofileEncode({ pubkey: REAL, relays: ['wss://r.example'] })],
      ['nostr: URI', () => `nostr:${nip19.npubEncode(REAL)}`],
      ['hex', () => REAL]
    ])('an %s shows exactly that person and skips the name search', (_label, key) => {
      const { get } = mountWith(key());
      vi.advanceTimersByTime(1000);
      flushSync();
      expect(get().tooShort).toBe(false);
      expect(get().results.map((c) => c.pubkey)).toEqual([REAL]);
      expect(profileSearch.profileNameSearchLoader).not.toHaveBeenCalled();
      expect(contacts.searchContacts).not.toHaveBeenCalled();
    });

    it('a pasted member key lands in the members group', () => {
      directory.members = new Set([REAL]);
      const { get } = mountWith(nip19.npubEncode(REAL));
      expect(get().memberResults.map((c) => c.pubkey)).toEqual([REAL]);
    });
  });
});
