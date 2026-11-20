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
    expect(loader).toHaveBeenCalledWith(ACTIVE, 100, 'only');
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

  it('loads the less fitting hits on request and ranks them behind the fitting ones', () => {
    const { hook } = mount({ loader });
    hook.apply(ACTIVE);
    expect(hook.canShowRest).toBe(true);
    expect(hook.restShown).toBe(false);
    const main = stream;
    main.next({ event: resource('x'), relay: 'wss://one' });
    main.complete();

    hook.showRest();
    expect(loader).toHaveBeenLastCalledWith(ACTIVE, 100, 'rest');
    expect(hook.restShown).toBe(true);
    expect(hook.isLoadingRest).toBe(true);
    stream.next({ event: resource('r1'), relay: 'wss://one' });
    stream.next({ event: resource('x'), relay: 'wss://two' }); // fits on one relay: stays a fitting hit
    stream.next({ event: resource('r2'), relay: 'wss://one' });
    stream.complete();

    expect(hook.isLoadingRest).toBe(false);
    expect([...hook.restIds]).toEqual(['id-r1', 'id-r2']);
    expect(hook.resultIds.has('id-r1')).toBe(true); // the page's gate lets them through
    expect(hook.rank.get(`30142:${A}:x`)).toBe(0);
    expect(hook.rank.get(`30142:${A}:r1`)).toBeGreaterThan(hook.rank.get(`30142:${A}:x`));
    expect(hook.rank.get(`30142:${A}:r2`)).toBeGreaterThan(hook.rank.get(`30142:${A}:r1`));

    hook.showRest(); // already shown: no second request
    expect(loader).toHaveBeenCalledTimes(2);

    hook.apply({ ...ACTIVE, searchText: 'physik' }); // a new search starts folded
    expect(hook.restShown).toBe(false);
    expect(hook.restIds.size).toBe(0);
  });

  it('offers no less fitting section for a search without text', () => {
    const { hook } = mount({ loader });
    hook.apply({ ...EMPTY, about: [{ id: 'https://x/s1', label: 'Mathe' }] });
    expect(hook.isActive).toBe(true);
    expect(hook.canShowRest).toBe(false);
    hook.showRest();
    expect(loader).toHaveBeenCalledTimes(1);
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

describe('useLearningSearch with a search coordinator', () => {
  let stream;
  let loader;
  const addr = (d) => `30142:${A}:${d}`;
  const order = (hook) => [...hook.rank.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  beforeEach(() => {
    vi.useFakeTimers();
    loader = vi.fn(() => {
      stream = new Subject();
      return stream;
    });
  });
  afterEach(() => vi.useRealTimers());

  it('re-orders the held results once when the coordinator answers', async () => {
    let answer;
    const coordinator = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { hook } = mount({ loader, coordinator });
    hook.apply(ACTIVE);
    for (const d of ['a', 'b', 'c']) stream.next({ event: resource(d), relay: 'wss://r1' });
    flushSync();
    expect(coordinator).not.toHaveBeenCalled(); // only after the typing pause
    vi.advanceTimersByTime(600);
    expect(coordinator).toHaveBeenCalledWith('mathe');
    expect(order(hook)).toEqual([addr('a'), addr('b'), addr('c')]);

    answer([addr('c'), addr('a')]);
    await vi.runAllTimersAsync();
    flushSync();
    expect(order(hook)).toEqual([addr('c'), addr('a'), addr('b')]);

    // a result arriving after the answer is ranked too, behind the coordinator's picks
    stream.next({ event: resource('d'), relay: 'wss://r1' });
    flushSync();
    expect(order(hook)).toEqual([addr('c'), addr('a'), addr('b'), addr('d')]);
  });

  it('drops a late answer that belongs to a previous search', async () => {
    const answers = [];
    const coordinator = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
    const { hook } = mount({ loader, coordinator });
    hook.apply(ACTIVE);
    vi.advanceTimersByTime(600);
    hook.apply({ ...ACTIVE, searchText: 'physik' });
    for (const d of ['a', 'b']) stream.next({ event: resource(d), relay: 'wss://r1' });
    answers[0]([addr('b'), addr('a')]); // answer for "mathe", but "physik" is the current search
    await vi.runAllTimersAsync();
    flushSync();
    expect(order(hook)).toEqual([addr('a'), addr('b')]);
  });

  it('asks the coordinator once, for the latest text, when searches follow within the delay', () => {
    const coordinator = vi.fn(() => Promise.resolve(null));
    const { hook } = mount({ loader, coordinator, coordinatorDelayMs: 300 });
    hook.apply(ACTIVE);
    vi.advanceTimersByTime(299);
    hook.apply({ ...ACTIVE, searchText: 'physik' });
    vi.advanceTimersByTime(300);
    expect(coordinator).toHaveBeenCalledTimes(1);
    expect(coordinator).toHaveBeenCalledWith('physik');
  });

  it('does not ask the coordinator after stop() or teardown', () => {
    const coordinator = vi.fn(() => Promise.resolve(null));
    const { hook, cleanup } = mount({ loader, coordinator });
    hook.apply(ACTIVE);
    hook.stop();
    hook.apply(ACTIVE);
    cleanup();
    vi.advanceTimersByTime(1000);
    expect(coordinator).not.toHaveBeenCalled();
  });

  it('does not ask the coordinator when a facet filter is set', () => {
    const coordinator = vi.fn(() => Promise.resolve(null));
    const { hook } = mount({ loader, coordinator });
    hook.apply({
      ...ACTIVE,
      learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video', prefLabel: {} }]
    });
    vi.advanceTimersByTime(600);
    expect(coordinator).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalled();
  });

  it('keeps the relay order when the coordinator has no answer or fails', async () => {
    for (const coordinator of [
      () => Promise.resolve(null),
      () => Promise.reject(new Error('down'))
    ]) {
      const { hook } = mount({ loader, coordinator });
      hook.apply(ACTIVE);
      for (const d of ['a', 'b']) stream.next({ event: resource(d), relay: 'wss://r1' });
      await vi.runAllTimersAsync();
      flushSync();
      expect(order(hook)).toEqual([addr('a'), addr('b')]);
    }
  });
});
