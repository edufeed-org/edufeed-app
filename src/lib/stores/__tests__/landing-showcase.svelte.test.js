// @ts-nocheck
/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// useLandingShowcase: the landing shows only content BY the accounts on the
// deployment's showcase lists or h-tagged INTO the listed communities. No
// lists, no live content. Disabled discover types are never loaded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { of, NEVER } from 'rxjs';

const loader = vi.hoisted(() => ({ create: vi.fn(), sources: vi.fn() }));
const cfg = vi.hoisted(() => ({
  types: ['learning', 'events'],
  lists: ['naddr1list'],
  byType: {}
}));
const store = vi.hoisted(() => ({ byKind: {}, modelFilters: [] }));

vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: (...a) => loader.create(...a) }));
vi.mock('$lib/loaders/landing-showcase-sources.js', () => ({
  loadShowcaseSources: (...a) => loader.sources(...a)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://amb'],
  getCalendarRelays: () => ['wss://cal'],
  getArticleRelays: () => ['wss://long']
}));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TL' }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (_m, filters) => {
      store.modelFilters.push(filters);
      return of(store.byKind[filters[0].kinds[0]] || []);
    }
  }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get discover() {
      return { contentTypes: cfg.types };
    },
    get landing() {
      return { showcaseLists: cfg.lists, showcaseListsByType: cfg.byType };
    }
  }
}));

import { useLandingShowcase, _resetShowcaseSourcesCache } from '../landing-showcase.svelte.js';

function mount() {
  let api;
  const cleanup = $effect.root(() => {
    api = useLandingShowcase();
  });
  flushSync();
  return { api, cleanup };
}
/** Let the sources promise resolve and the loader effect run. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  flushSync();
}

const NOW = Math.floor(Date.now() / 1000);
const amb = (id, pubkey, created_at, image) => ({
  id,
  pubkey,
  kind: 30142,
  created_at,
  content: '',
  tags: [['d', id], ['name', `M ${id}`], ...(image ? [['image', image]] : [])]
});
const cal = (id, pubkey, start) => ({
  id,
  pubkey,
  kind: 31923,
  created_at: 1,
  content: '',
  tags: [
    ['d', id],
    ['title', `T ${id}`],
    ['start', String(start)]
  ]
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _resetShowcaseSourcesCache();
  localStorage.clear();
  store.modelFilters = [];
  cfg.types = ['learning', 'events'];
  cfg.lists = ['naddr1list'];
  cfg.byType = {};
  loader.sources.mockResolvedValue(['src1', 'src2']);
  loader.create.mockReturnValue(of());
  store.byKind = {
    30142: [amb('old', 'a1', 1), amb('new', 'a2', 9, 'https://i')],
    31922: [cal('e1', 'c1', NOW + 3600)],
    30023: [
      {
        id: 'r1',
        pubkey: 'w1',
        kind: 30023,
        created_at: 5,
        tags: [
          ['d', 'r'],
          ['title', 'R']
        ]
      }
    ]
  };
});
afterEach(() => vi.useRealTimers());

describe('useLandingShowcase', () => {
  it('without showcase lists it loads nothing and shows nothing', async () => {
    cfg.lists = [];
    const { api, cleanup } = mount();
    await settle();
    expect(loader.sources).not.toHaveBeenCalled();
    expect(loader.create).not.toHaveBeenCalled();
    expect(api.materials()).toEqual([]);
    expect(api.events()).toEqual([]);
    expect(api.settled('learning')).toBe(true);
    expect(api.settled('events')).toBe(true);
    cleanup();
  });

  it('loads only content by or into the listed sources', async () => {
    const { cleanup } = mount();
    await settle();
    expect(loader.sources).toHaveBeenCalledWith(['naddr1list']);
    const [relays, filters] = loader.create.mock.calls[0];
    expect(relays).toEqual(['wss://amb']);
    expect(filters).toEqual([
      { kinds: [30142], authors: ['src1'], limit: 3 },
      { kinds: [30142], authors: ['src2'], limit: 3 },
      { kinds: [30142], '#h': ['src1', 'src2'], limit: 12 }
    ]);
    // the store side is restricted the same way (no limit on the model)
    expect(store.modelFilters[0]).toEqual([
      { kinds: [30142], authors: ['src1', 'src2'] },
      { kinds: [30142], '#h': ['src1', 'src2'] }
    ]);
    cleanup();
  });

  it('exposes picked materials and events', async () => {
    const { api, cleanup } = mount();
    await settle();
    expect(api.materials().map((r) => r.id)).toEqual(['new', 'old']);
    expect(api.heroMaterial().id).toBe('new');
    expect(api.events().map((e) => e.id)).toEqual(['e1']);
    expect(api.sources()).toEqual(['src1', 'src2']);
    cleanup();
  });

  it('coming back to the landing does not wait for the list again', async () => {
    const first = mount();
    await settle();
    first.cleanup();
    // the relay now hangs: the second visit must use the remembered sources
    loader.sources.mockReturnValue(new Promise(() => {}));
    loader.create.mockClear();
    const { api, cleanup } = mount();
    flushSync();
    expect(api.sources()).toEqual(['src1', 'src2']);
    expect(api.materials().map((r) => r.id)).toEqual(['new', 'old']);
    expect(loader.create).toHaveBeenCalled();
    cleanup();
  });

  it('a cold start uses the sources stored from the last visit', async () => {
    localStorage.setItem(
      'landing-showcase-sources',
      JSON.stringify({ lists: ['naddr1list'], pubkeys: ['srcX'] })
    );
    loader.sources.mockReturnValue(new Promise(() => {}));
    const { api, cleanup } = mount();
    flushSync();
    expect(api.sources()).toEqual(['srcX']);
    cleanup();
  });

  it('an unreachable list (empty answer) keeps the remembered sources', async () => {
    localStorage.setItem(
      'landing-showcase-sources',
      JSON.stringify({ lists: ['naddr1list'], pubkeys: ['srcX'] })
    );
    loader.sources.mockResolvedValue([]);
    const { api, cleanup } = mount();
    await settle();
    expect(api.sources()).toEqual(['srcX']);
    const stored = JSON.parse(localStorage.getItem('landing-showcase-sources'));
    expect([stored].flat().find((e) => e.lists[0] === 'naddr1list').pubkeys).toEqual(['srcX']);
    cleanup();
  });

  it('stored sources for other lists are ignored', async () => {
    localStorage.setItem(
      'landing-showcase-sources',
      JSON.stringify({ lists: ['naddr1other'], pubkeys: ['srcX'] })
    );
    loader.sources.mockReturnValue(new Promise(() => {}));
    const { api, cleanup } = mount();
    flushSync();
    expect(api.sourcesResolved()).toBe(false);
    cleanup();
  });

  it('is not settled while the lists are still resolving', () => {
    loader.sources.mockReturnValue(new Promise(() => {}));
    const { api, cleanup } = mount();
    expect(api.settled('learning')).toBe(false);
    cleanup();
  });

  it('never loads a disabled type and reports it settled and empty', async () => {
    const { api, cleanup } = mount();
    await settle();
    expect(loader.create.mock.calls.every(([, f]) => f[0].kinds[0] !== 30023)).toBe(true);
    expect(api.articles()).toEqual([]);
    expect(api.settled('articles')).toBe(true);
    cleanup();
  });

  it('starts each enabled loader once', async () => {
    loader.create.mockReturnValue(NEVER);
    const { cleanup } = mount();
    await settle();
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(loader.create).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('settles a hanging loader after 5 s', async () => {
    loader.create.mockReturnValue(NEVER);
    const { api, cleanup } = mount();
    await settle();
    expect(api.settled('events')).toBe(false);
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(api.settled('events')).toBe(true);
    cleanup();
  });

  it('an unreachable list settles everything empty', async () => {
    loader.sources.mockRejectedValue(new Error('offline'));
    const { api, cleanup } = mount();
    await settle();
    expect(loader.create).not.toHaveBeenCalled();
    expect(api.settled('learning')).toBe(true);
    expect(api.materials()).toEqual([]);
    cleanup();
  });
});

describe('useLandingShowcase with per-type lists', () => {
  /** @param {Record<string, string[]>} byList */
  const sourcesFor = (byList) =>
    loader.sources.mockImplementation(async (lists) => byList[lists.join(',')] ?? []);
  const authorsOf = (kind) =>
    loader.create.mock.calls
      .find(([, f]) => f[0].kinds[0] === kind)?.[1]
      .flatMap((f) => f.authors ?? []);

  it('a per-type list feeds only its own panel; the rest keep the global list', async () => {
    cfg.byType = { learning: ['naddr1mat'] };
    sourcesFor({ naddr1list: ['src1', 'src2'], naddr1mat: ['m1', 'm2'] });
    const { api, cleanup } = mount();
    await settle();
    expect(authorsOf(30142)).toEqual(['m1', 'm2']);
    expect(authorsOf(31922)).toEqual(['src1', 'src2']);
    // the community wall stays on the global list
    expect(api.sources()).toEqual(['src1', 'src2']);
    cleanup();
  });

  it('a per-type list works without a global list', async () => {
    cfg.lists = [];
    cfg.byType = { learning: ['naddr1mat'] };
    sourcesFor({ naddr1mat: ['m1'] });
    const { api, cleanup } = mount();
    await settle();
    expect(authorsOf(30142)).toEqual(['m1']);
    expect(authorsOf(31922)).toBeUndefined();
    expect(api.settled('events')).toBe(true);
    expect(api.sources()).toEqual([]);
    cleanup();
  });

  it('a list resolving later does not restart the other panels', async () => {
    cfg.byType = { learning: ['naddr1mat'] };
    loader.create.mockReturnValue(NEVER);
    loader.sources.mockImplementation((lists) =>
      lists[0] === 'naddr1mat'
        ? new Promise((resolve) => setTimeout(() => resolve(['m1']), 1000))
        : Promise.resolve(['src1'])
    );
    const { cleanup } = mount();
    await settle();
    expect(loader.create).toHaveBeenCalledTimes(1); // events
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();
    expect(loader.create).toHaveBeenCalledTimes(2); // + learning, events kept
    cleanup();
  });

  it('remembers each list set separately', async () => {
    cfg.byType = { learning: ['naddr1mat'] };
    sourcesFor({ naddr1list: ['src1'], naddr1mat: ['m1'] });
    const first = mount();
    await settle();
    first.cleanup();
    _resetShowcaseSourcesCache();
    loader.sources.mockReturnValue(new Promise(() => {}));
    loader.create.mockClear();
    const { api, cleanup } = mount();
    flushSync();
    expect(api.sources()).toEqual(['src1']);
    expect(authorsOf(30142)).toEqual(['m1']);
    cleanup();
  });
});
