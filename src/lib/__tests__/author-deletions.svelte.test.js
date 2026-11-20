// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * The app never learned about OTHER people's deletions.
 *
 * `fetchUserDeletions` exists but only the calendar paths call it, and only
 * for the active user's own pubkey; `hydrateDeletions()` replays kind-5s
 * already in IDB but never fetches new ones. So a resource its author deleted
 * keeps rendering for anyone holding a stale copy — and stays shareable,
 * which is how a repost pointing at a long-deleted resource got published
 * (laoc, 2026-08-24).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** @type {any[]} */
let loaderCalls;
/** @type {any[]} */
let subscriptions;

/** @type {any[]} */
let targetCalls;

vi.mock('$lib/loaders/base.js', () => ({
  fetchDeletionsOf: vi.fn((targets) => {
    targetCalls.push(targets);
    const subject = new Subject();
    const subscribe = subject.subscribe.bind(subject);
    // @ts-expect-error -- test double
    subject.subscribe = (...args) => {
      const sub = subscribe(...args);
      subscriptions.push(sub);
      return sub;
    };
    return subject;
  }),
  fetchAuthorsDeletions: vi.fn((pubkeys) => {
    loaderCalls.push(pubkeys);
    // Record the subscription the HOOK opens, not one of our own: the point of
    // the teardown test is that the hook closes what it opened.
    const subject = new Subject();
    const subscribe = subject.subscribe.bind(subject);
    // @ts-expect-error -- test double
    subject.subscribe = (...args) => {
      const sub = subscribe(...args);
      subscriptions.push(sub);
      return sub;
    };
    return subject;
  })
}));

describe('useAuthorDeletions', () => {
  /** @type {any} */
  let useAuthorDeletions;
  /** @type {(() => void) | undefined} */
  let cleanup;

  beforeEach(async () => {
    loaderCalls = [];
    targetCalls = [];
    subscriptions = [];
    vi.clearAllMocks();
    const mod = await import('$lib/stores/author-deletions.svelte.js');
    useAuthorDeletions = mod.useAuthorDeletions;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('asks for the deletions of the authors it is given, in one batch', () => {
    cleanup = $effect.root(() => useAuthorDeletions(() => [A, B]));
    flushSync();

    expect(loaderCalls).toHaveLength(1);
    expect([...loaderCalls[0]].sort()).toEqual([A, B].sort());
  });

  // The pubkey list is rebuilt on every unrelated re-render, and a fresh REQ
  // per render is what starves a relay connection — the same rule
  // channel-rosters.svelte.js follows.
  it('does not re-ask for an author it has already asked about', () => {
    let pubkeys = $state.raw([A]);
    cleanup = $effect.root(() => useAuthorDeletions(() => pubkeys));
    flushSync();
    pubkeys = [A];
    flushSync();

    expect(loaderCalls).toHaveLength(1);
  });

  it('asks only for the authors that are new', () => {
    let pubkeys = $state.raw([A]);
    cleanup = $effect.root(() => useAuthorDeletions(() => pubkeys));
    flushSync();
    pubkeys = [A, B];
    flushSync();

    expect(loaderCalls).toEqual([[A], [B]]);
  });

  it('ignores anything that is not a pubkey rather than asking for it', () => {
    cleanup = $effect.root(() => useAuthorDeletions(() => [A, undefined, null, '', A]));
    flushSync();

    expect(loaderCalls).toEqual([[A]]);
  });

  it('asks for nothing when there are no authors', () => {
    cleanup = $effect.root(() => useAuthorDeletions(() => []));
    flushSync();

    expect(loaderCalls).toEqual([]);
  });

  it('unsubscribes its requests when the effect root is torn down', () => {
    cleanup = $effect.root(() => useAuthorDeletions(() => [A]));
    flushSync();
    expect(subscriptions).toHaveLength(1);

    cleanup();
    cleanup = undefined;
    expect(subscriptions[0].closed).toBe(true);
  });
});

// What is on screen are events, and "every deletion of their authors" is the
// wrong question for them: a bulk importer's deletions run to megabytes. The
// content hook asks which deletions name the events themselves.
describe('useContentDeletions', () => {
  /** @type {any} */
  let useContentDeletions;
  /** @type {(() => void) | undefined} */
  let cleanup;
  const event = (id, extra = {}) => ({
    id: id.repeat(64),
    kind: 30142,
    pubkey: A,
    tags: [['d', id]],
    ...extra
  });

  beforeEach(async () => {
    loaderCalls = [];
    targetCalls = [];
    subscriptions = [];
    vi.clearAllMocks();
    useContentDeletions = (await import('$lib/stores/author-deletions.svelte.js'))
      .useContentDeletions;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('asks about the events it is given, not about their authors', () => {
    const one = event('1');
    const model = { title: 'wrapped', event: event('2') }; // a model that carries its event
    cleanup = $effect.root(() => useContentDeletions(() => [one, model]));
    flushSync();

    expect(targetCalls).toEqual([[one, model.event]]);
    expect(loaderCalls).toEqual([]);
  });

  it('asks about the people who shared an item by author: their repost is not at hand', () => {
    const shared = event('1', { _sharedBy: B });
    const sharedByMany = event('2', { _allSharers: [B, 'c'.repeat(64)] });
    cleanup = $effect.root(() => useContentDeletions(() => [shared, sharedByMany]));
    flushSync();

    expect(targetCalls).toEqual([[shared, sharedByMany]]);
    expect(loaderCalls.flat().sort()).toEqual([B, 'c'.repeat(64)]);
  });

  it('falls back to the author for an item that is not an event', () => {
    cleanup = $effect.root(() =>
      useContentDeletions(() => [{ pubkey: B, name: 'a community' }, null, {}])
    );
    flushSync();

    expect(targetCalls).toEqual([]);
    expect(loaderCalls).toEqual([[B]]);
  });

  it('asks once per event, and only about the new ones', () => {
    let items = $state.raw([event('1')]);
    cleanup = $effect.root(() => useContentDeletions(() => items));
    flushSync();
    items = [event('1'), event('2')];
    flushSync();

    expect(targetCalls.map((call) => call.map((e) => e.id[0]))).toEqual([['1'], ['2']]);
  });

  it('unsubscribes its requests when the effect root is torn down', () => {
    cleanup = $effect.root(() => useContentDeletions(() => [event('1', { _sharedBy: B })]));
    flushSync();
    expect(subscriptions).toHaveLength(2);

    cleanup();
    cleanup = undefined;
    expect(subscriptions.every((sub) => sub.closed)).toBe(true);
  });
});
