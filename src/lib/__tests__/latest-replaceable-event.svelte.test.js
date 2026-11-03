// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * useLatestReplaceableEvent — the calendar event detail page must end up on
 * the NEWEST revision (NIP-01: newest created_at, lowest id on a tie) even
 * when its first paint came from a stale IDB/store copy or from the first
 * relay that answered, and must switch to a "deleted" state when the author's
 * NIP-09 deletion is (or becomes) known.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

let replaceableSubject;
const replaceableMock = vi.fn();
const addressLoaderMock = vi.fn();
const deletionsMock = vi.fn();
const deleted = new Set();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (...args) => {
      replaceableMock(...args);
      return replaceableSubject;
    }
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: (pointer) => {
    addressLoaderMock(pointer);
    return new Subject();
  },
  fetchAuthorsDeletions: (pubkeys) => {
    deletionsMock(pubkeys);
    return new Subject();
  }
}));

vi.mock('$lib/helpers/communityRepost.js', () => ({
  isDeletedEvent: (event) => !!event && deleted.has(event.id)
}));

const PUBKEY = 'a'.repeat(64);
const POINTER = {
  kind: 31923,
  pubkey: PUBKEY,
  identifier: 'workshop',
  relays: ['wss://relay.test']
};

/** @param {string} id @param {number} created_at @param {string} [title] */
const revision = (id, created_at, title = id) => ({
  id,
  kind: 31923,
  pubkey: PUBKEY,
  created_at,
  content: '',
  tags: [
    ['d', 'workshop'],
    ['title', title]
  ]
});

describe('useLatestReplaceableEvent', () => {
  /** @type {typeof import('$lib/stores/latest-replaceable-event.svelte.js').useLatestReplaceableEvent} */
  let useLatestReplaceableEvent;

  beforeEach(async () => {
    replaceableSubject = new Subject();
    replaceableMock.mockClear();
    addressLoaderMock.mockClear();
    deletionsMock.mockClear();
    deleted.clear();
    const mod = await import('$lib/stores/latest-replaceable-event.svelte.js');
    useLatestReplaceableEvent = mod.useLatestReplaceableEvent;
  });

  /** @param {any} initial */
  function mount(initial) {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useLatestReplaceableEvent(
        () => POINTER,
        () => initial
      );
    });
    flushSync();
    return { getState, cleanup };
  }

  it('paints the initial (cached) revision first', () => {
    const cached = revision('b'.repeat(64), 100, 'old');
    const { getState, cleanup } = mount(cached);

    expect(getState().event).toBe(cached);
    expect(getState().deleted).toBe(false);
    cleanup();
  });

  it('replaces a stale cached revision with the newer one the relays deliver', () => {
    const cached = revision('b'.repeat(64), 100, 'old');
    const newer = revision('c'.repeat(64), 200, 'new');
    const { getState, cleanup } = mount(cached);

    // Store emits the cached copy first, then the newer relay revision
    replaceableSubject.next(cached);
    flushSync();
    expect(getState().event).toBe(cached);

    replaceableSubject.next(newer);
    flushSync();
    expect(getState().event).toBe(newer);
    cleanup();
  });

  it('subscribes to the store address and forces a relay round-trip past the cache', () => {
    const { cleanup } = mount(revision('b'.repeat(64), 100));

    expect(replaceableMock).toHaveBeenCalledWith(31923, PUBKEY, 'workshop');
    expect(addressLoaderMock).toHaveBeenCalledWith({ ...POINTER, cache: false });
    cleanup();
  });

  it("loads the author's NIP-09 deletions", () => {
    const { cleanup } = mount(revision('b'.repeat(64), 100));

    expect(deletionsMock).toHaveBeenCalledWith([PUBKEY]);
    cleanup();
  });

  it('never goes back to an older revision', () => {
    const newer = revision('c'.repeat(64), 200, 'new');
    const older = revision('b'.repeat(64), 100, 'old');
    const { getState, cleanup } = mount(newer);

    replaceableSubject.next(older);
    flushSync();
    expect(getState().event).toBe(newer);
    cleanup();
  });

  it('breaks a created_at tie towards the lowest id', () => {
    const high = revision('e'.repeat(64), 100, 'high-id');
    const low = revision('1'.repeat(64), 100, 'low-id');
    const { getState, cleanup } = mount(high);

    replaceableSubject.next(low);
    flushSync();
    expect(getState().event).toBe(low);

    replaceableSubject.next(high);
    flushSync();
    expect(getState().event).toBe(low);
    cleanup();
  });

  it('shows the deleted state when the deletion arrives while the page is open', () => {
    const cached = revision('b'.repeat(64), 100);
    const { getState, cleanup } = mount(cached);
    replaceableSubject.next(cached);
    flushSync();

    // A kind 5 lands: the store drops the event and the model emits undefined
    deleted.add(cached.id);
    replaceableSubject.next(undefined);
    flushSync();

    expect(getState().deleted).toBe(true);
    expect(getState().event).toBeNull();
    cleanup();
  });

  it('shows the deleted state when the deletion was already known', () => {
    const cached = revision('b'.repeat(64), 100);
    deleted.add(cached.id);
    const { getState, cleanup } = mount(cached);

    expect(getState().deleted).toBe(true);
    expect(getState().event).toBeNull();
    cleanup();
  });

  it('shows a revision published after the deletion', () => {
    const old = revision('b'.repeat(64), 100);
    const republished = revision('c'.repeat(64), 300);
    deleted.add(old.id);
    const { getState, cleanup } = mount(old);
    expect(getState().deleted).toBe(true);

    replaceableSubject.next(republished);
    flushSync();
    expect(getState().deleted).toBe(false);
    expect(getState().event).toBe(republished);
    cleanup();
  });

  it('keeps the shown revision when the store emits undefined without a deletion', () => {
    const cached = revision('b'.repeat(64), 100);
    const { getState, cleanup } = mount(cached);

    replaceableSubject.next(undefined);
    flushSync();
    expect(getState().event).toBe(cached);
    expect(getState().deleted).toBe(false);
    cleanup();
  });

  it('picks up an event that was not found at load time', () => {
    const arrived = revision('c'.repeat(64), 200);
    const { getState, cleanup } = mount(null);
    expect(getState().event).toBeNull();

    replaceableSubject.next(arrived);
    flushSync();
    expect(getState().event).toBe(arrived);
    cleanup();
  });
});
