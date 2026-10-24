// @ts-nocheck

/**
 * BLOCKED_PUBKEYS: authors a deployment does not want to show anywhere. The
 * gate sits at the EventStore — a blocked author's events never enter the
 * store, so every surface (feeds, previews, community lists, calendar) is
 * covered at once; events already stored when the list resolves are removed.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

const store = vi.hoisted(() => ({
  verifyEvent: vi.fn(() => true),
  removed: [],
  stored: []
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    get verifyEvent() {
      return store.verifyEvent;
    },
    set verifyEvent(fn) {
      store.verifyEvent = fn;
    },
    getByFilters: () => store.stored,
    remove: (e) => {
      store.removed.push(e.id);
      store.stored = store.stored.filter((x) => x.id !== e.id);
    }
  },
  pool: { request: () => of() }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));
const config = vi.hoisted(() => ({ runtimeConfig: { blockedPubkeys: [] } }));
vi.mock('$lib/stores/config.svelte.js', () => config);

const { initBlockedAuthors, isBlockedAuthor, _resetBlockedAuthorsForTesting } = await import(
  '../blocked-authors.svelte.js'
);

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ev = (pubkey, id = 'e') => ({
  id,
  pubkey,
  kind: 1,
  created_at: 1,
  tags: [],
  content: '',
  sig: ''
});

describe('blocked authors', () => {
  beforeEach(() => {
    _resetBlockedAuthorsForTesting();
    localStorage.clear();
    store.verifyEvent = vi.fn(() => true);
    store.removed = [];
    store.stored = [];
  });

  it('does nothing without a configured list', async () => {
    const before = store.verifyEvent;
    await initBlockedAuthors();
    expect(store.verifyEvent).toBe(before);
    expect(isBlockedAuthor(A)).toBe(false);
  });

  it('refuses a blocked author at the store gate and keeps verifying the others', async () => {
    config.runtimeConfig.blockedPubkeys = [A];
    const previous = vi.fn((e) => e.sig !== 'bad');
    store.verifyEvent = previous;
    await initBlockedAuthors();
    expect(store.verifyEvent(ev(A))).toBe(false);
    expect(store.verifyEvent(ev(B))).toBe(true);
    expect(store.verifyEvent({ ...ev(B), sig: 'bad' })).toBe(false);
    expect(previous).toHaveBeenCalled();
    expect(isBlockedAuthor(A)).toBe(true);
  });

  it('removes events of blocked authors that were stored before the list applied', async () => {
    config.runtimeConfig.blockedPubkeys = [A];
    store.stored = [ev(A, 'one'), ev(A, 'two')];
    await initBlockedAuthors();
    expect(store.removed).toEqual(['one', 'two']);
  });
});
