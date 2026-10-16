// @ts-nocheck
/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// useLandingShowcase starts only the loaders of enabled discover types and
// exposes picked, model-backed content plus a per-type "settled" flag.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { of, NEVER } from 'rxjs';

const loaders = vi.hoisted(() => ({
  amb: vi.fn(),
  articles: vi.fn(),
  calendar: vi.fn()
}));
const cfg = vi.hoisted(() => ({ types: ['learning', 'events'] }));
const fixtures = vi.hoisted(() => ({ amb: [], calendar: [], articles: [] }));

vi.mock('$lib/loaders/amb.js', () => ({ ambTimelineLoader: (...a) => loaders.amb(...a) }));
vi.mock('$lib/loaders/articles.js', () => ({
  articleTimelineLoader: (...a) => loaders.articles(...a)
}));
vi.mock('$lib/loaders/calendar.js', () => ({
  createDateRangeCalendarLoader: (...a) => loaders.calendar(...a)
}));
vi.mock('$lib/models', () => ({
  AMBResourceModel: 'AMB',
  CalendarEventRangeModel: 'CAL'
}));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TL' }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (m) =>
      of(m === 'AMB' ? fixtures.amb : m === 'CAL' ? fixtures.calendar : fixtures.articles)
  }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get discover() {
      return { contentTypes: cfg.types };
    }
  }
}));

import { useLandingShowcase } from '../landing-showcase.svelte.js';

/** @param {() => void} fn */
function mount() {
  let api;
  const cleanup = $effect.root(() => {
    api = useLandingShowcase();
  });
  flushSync();
  return { api, cleanup };
}

const NOW = Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cfg.types = ['learning', 'events'];
  loaders.amb.mockReturnValue(() => of());
  loaders.articles.mockReturnValue(() => of());
  loaders.calendar.mockReturnValue(() => of());
  fixtures.amb = [
    { id: 'old', pubkey: 'a1', identifier: 'x', name: 'Old', created_at: 1 },
    { id: 'new', pubkey: 'a2', identifier: 'y', name: 'New', created_at: 9, image: 'https://i' }
  ];
  fixtures.calendar = [
    { id: 'e1', pubkey: 'c1', start: NOW + 3600, originalEvent: { kind: 31923, tags: [] } }
  ];
  fixtures.articles = [
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
  ];
});
afterEach(() => vi.useRealTimers());

describe('useLandingShowcase', () => {
  it('exposes picked materials and events of enabled types', () => {
    const { api, cleanup } = mount();
    expect(api.materials().map((r) => r.id)).toEqual(['new', 'old']);
    expect(api.heroMaterial().id).toBe('new');
    expect(api.events().map((e) => e.id)).toEqual(['e1']);
    cleanup();
  });

  it('never loads a disabled type and reports it settled and empty', () => {
    const { api, cleanup } = mount();
    expect(loaders.articles).not.toHaveBeenCalled();
    expect(api.articles()).toEqual([]);
    expect(api.settled('articles')).toBe(true);
    cleanup();
  });

  it('starts each enabled loader once, even when another type is disabled', () => {
    // articles disabled (cfg default) — settling it must not re-run the effect
    loaders.calendar.mockReturnValue(() => NEVER);
    const { cleanup } = mount();
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(loaders.amb).toHaveBeenCalledTimes(1);
    expect(loaders.calendar).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('settles a type when its loader completes', () => {
    const { api, cleanup } = mount();
    expect(api.settled('learning')).toBe(true);
    cleanup();
  });

  it('settles a hanging loader after 5 s', () => {
    loaders.calendar.mockReturnValue(() => NEVER);
    const { api, cleanup } = mount();
    expect(api.settled('events')).toBe(false);
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(api.settled('events')).toBe(true);
    cleanup();
  });

  it('collects the authors of everything it shows', () => {
    cfg.types = ['learning', 'events', 'articles'];
    const { api, cleanup } = mount();
    expect(api.authors().sort()).toEqual(['a1', 'a2', 'c1', 'w1']);
    cleanup();
  });
});
