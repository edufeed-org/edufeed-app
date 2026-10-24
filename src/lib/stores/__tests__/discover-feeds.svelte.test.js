// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * useDiscoverFeeds: the discover page's paging feeds (articles, learning,
 * boards) behind one reactive facade — status mirror, reveal rule, sync on
 * relay/curated changes, and the shown/paged gates for "load more".
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';
import { writable } from 'svelte/store';

const relayUpdateSignal = writable(0);
let curatedVersion = 0;
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  relayUpdateSignal
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  getCuratedCacheVersion: () => curatedVersion
}));

const { useDiscoverFeeds } = await import('../discover-feeds.svelte.js');

const IDLE = {
  pending: false,
  settled: false,
  exhausted: false,
  failing: false,
  newCount: 0,
  since: 0,
  until: 0,
  relays: []
};

function fakeFeed() {
  const status$ = new BehaviorSubject({ ...IDLE });
  const unsubscribed = vi.fn();
  return {
    events$: { subscribe: vi.fn(() => ({ unsubscribe: unsubscribed })) },
    status$,
    getStatus: () => status$.value,
    loadMore: vi.fn(),
    sync: vi.fn(),
    catchUp: vi.fn(),
    unsubscribed,
    set: (partial) => status$.next({ ...status$.value, ...partial })
  };
}

/** Mounts the hook in an effect root and returns it with the cleanup. */
function mount(options) {
  let hook;
  const cleanup = $effect.root(() => {
    hook = useDiscoverFeeds(options);
  });
  flushSync();
  return { hook, cleanup };
}

describe('useDiscoverFeeds', () => {
  beforeEach(() => {
    relayUpdateSignal.set(0);
    curatedVersion = 0;
  });

  it('starts every feed on mount, syncs it once, and stops it on cleanup', () => {
    const articles = fakeFeed();
    const boards = fakeFeed();
    const { hook, cleanup } = mount({
      feeds: [
        { type: 'articles', feed: articles },
        { type: 'boards', feed: boards }
      ],
      isShown: () => true,
      onReveal: vi.fn()
    });
    expect(articles.events$.subscribe).toHaveBeenCalledTimes(1);
    expect(boards.events$.subscribe).toHaveBeenCalledTimes(1);
    expect(articles.sync).toHaveBeenCalledTimes(1);
    expect(hook.status.articles).toEqual(IDLE);
    cleanup();
    expect(articles.unsubscribed).toHaveBeenCalled();
    expect(boards.unsubscribed).toHaveBeenCalled();
  });

  it('re-syncs the feeds when the relay overrides or the curated set change', () => {
    const feed = fakeFeed();
    mount({ feeds: [{ type: 'articles', feed }], isShown: () => true, onReveal: vi.fn() });
    relayUpdateSignal.set(1);
    flushSync();
    expect(feed.sync).toHaveBeenCalledTimes(2);
  });

  it('derives pending, failing and hasMore from the shown feeds, settled from all of them', () => {
    const articles = fakeFeed();
    const learning = fakeFeed();
    let tab = $state('articles');
    const { hook } = mount({
      feeds: [
        { type: 'articles', feed: articles },
        { type: 'learning', feed: learning }
      ],
      isShown: (type) => tab === 'all' || tab === type,
      onReveal: vi.fn()
    });
    learning.set({ pending: true, failing: true });
    flushSync();
    expect(hook.pending).toBe(false);
    expect(hook.failing).toBe(false);
    expect(hook.settled).toBe(false);

    articles.set({ settled: true, exhausted: true });
    learning.set({ pending: false, failing: false, settled: true });
    flushSync();
    expect(hook.settled).toBe(true);
    expect(hook.hasMore).toBe(false);

    tab = 'all';
    expect(hook.hasMore).toBe(true);
  });

  it('never settles without feeds (the calendar clears the page spinner then)', () => {
    const { hook } = mount({ feeds: [], isShown: () => true, onReveal: vi.fn() });
    expect(hook.settled).toBe(false);
    expect(hook.hasMore).toBe(false);
  });

  it('excludes feeds the caller pauses from hasMore and loadMore', () => {
    const articles = fakeFeed();
    const learning = fakeFeed();
    const { hook } = mount({
      feeds: [
        { type: 'articles', feed: articles },
        { type: 'learning', feed: learning }
      ],
      isShown: () => true,
      isPaged: (type) => type !== 'learning',
      onReveal: vi.fn()
    });
    articles.set({ exhausted: true, settled: true });
    flushSync();
    expect(hook.hasMore).toBe(false);
    hook.loadMore();
    expect(articles.loadMore).toHaveBeenCalledTimes(1);
    expect(learning.loadMore).not.toHaveBeenCalled();
  });

  it('reveals when a shown feed finishes the page it was waiting for, not for a hidden one', () => {
    const articles = fakeFeed();
    const boards = fakeFeed();
    const onReveal = vi.fn();
    mount({
      feeds: [
        { type: 'articles', feed: articles },
        { type: 'boards', feed: boards }
      ],
      isShown: (type) => type === 'articles',
      onReveal
    });
    articles.set({ pending: true });
    boards.set({ pending: true });
    expect(onReveal).not.toHaveBeenCalled();
    boards.set({ pending: false, settled: true });
    expect(onReveal).not.toHaveBeenCalled();
    articles.set({ pending: false, settled: true });
    expect(onReveal).toHaveBeenCalledTimes(1);
    articles.set({ settled: true });
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});
