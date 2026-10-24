// @ts-nocheck
/* eslint-disable no-undef -- runes are available in .svelte.js context */
/**
 * useLearningSearch: the discover page's NIP-50 learning search — one ranked
 * stream per relay, merged into a relevance index, with the "searching"
 * spinner gate and its safety backstop.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

vi.mock('$lib/loaders/amb-search.js', () => ({ ambRankedSearchLoader: vi.fn() }));

const { useLearningSearch } = await import('../learning-search.svelte.js');

const A = 'a'.repeat(64);
const resource = (d) => ({
  id: `id-${d}`,
  kind: 30142,
  pubkey: A,
  tags: [['d', d]],
  content: '{}',
  created_at: 1
});
const ACTIVE = { searchText: 'mathe', learningResourceType: [], about: [], audience: [] };
const EMPTY = { searchText: '', learningResourceType: [], about: [], audience: [] };

function mount(options) {
  let hook;
  const cleanup = $effect.root(() => {
    hook = useLearningSearch(options);
  });
  flushSync();
  return { hook, cleanup };
}

describe('useLearningSearch', () => {
  let stream;
  let loader;
  beforeEach(() => {
    vi.useFakeTimers();
    // A fresh stream per request: an errored Subject re-errors on subscribe
    loader = vi.fn(() => {
      stream = new Subject();
      return stream;
    });
  });
  afterEach(() => vi.useRealTimers());

  it('is inactive with empty filters and does not query', () => {
    const { hook } = mount({ loader });
    hook.apply(EMPTY);
    expect(hook.isActive).toBe(false);
    expect(hook.isSearching).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it('starts a ranked search, collects results once per id and ranks them across relays', () => {
    const onActivate = vi.fn();
    const { hook } = mount({ loader, onActivate });
    hook.apply(ACTIVE);
    expect(loader).toHaveBeenCalledWith(ACTIVE, 100);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(hook.isActive).toBe(true);
    expect(hook.isSearching).toBe(true);

    stream.next({ event: resource('x'), relay: 'wss://one' });
    stream.next({ event: resource('y'), relay: 'wss://one' });
    stream.next({ event: resource('x'), relay: 'wss://two' });
    expect(hook.results.map((e) => e.id)).toEqual(['id-x', 'id-y']);
    expect(hook.resultIds.has('id-y')).toBe(true);
    expect(hook.rank.get(`30142:${A}:x`)).toBe(0);
    expect(hook.rank.get(`30142:${A}:y`)).toBe(1);

    stream.complete();
    expect(hook.isSearching).toBe(false);
    expect(hook.isActive).toBe(true);
  });

  it('stops showing the spinner after the safety backstop even if no relay answers', () => {
    const { hook } = mount({ loader });
    hook.apply(ACTIVE);
    vi.advanceTimersByTime(8000);
    expect(hook.isSearching).toBe(false);
    expect(hook.isActive).toBe(true);
  });

  it('cancels the previous request when the filters change again', () => {
    const { hook } = mount({ loader });
    hook.apply(ACTIVE);
    expect(stream.observed).toBe(true);
    const second = new Subject();
    loader.mockReturnValueOnce(second);
    hook.apply({ ...ACTIVE, searchText: 'physik' });
    expect(stream.observed).toBe(false);
    expect(second.observed).toBe(true);
  });

  it('deactivates and drops the rank on a loader error, on empty filters and on stop()', () => {
    const onDeactivate = vi.fn();
    const { hook } = mount({ loader, onDeactivate });
    hook.apply(ACTIVE);
    stream.next({ event: resource('x'), relay: 'wss://one' });
    stream.error(new Error('relay'));
    expect(hook.isActive).toBe(false);
    expect(hook.rank.size).toBe(0);
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    hook.apply(ACTIVE);
    hook.apply(EMPTY);
    expect(hook.isActive).toBe(false);
    expect(hook.results).toEqual([]);
    expect(onDeactivate).toHaveBeenCalledTimes(2);

    hook.apply(ACTIVE);
    hook.stop();
    expect(hook.isActive).toBe(false);
    expect(stream.observed).toBe(false);
    expect(onDeactivate).toHaveBeenCalledTimes(3);
  });

  it('unsubscribes the running request when the component goes away', () => {
    const { hook, cleanup } = mount({ loader });
    hook.apply(ACTIVE);
    cleanup();
    expect(stream.observed).toBe(false);
  });
});
