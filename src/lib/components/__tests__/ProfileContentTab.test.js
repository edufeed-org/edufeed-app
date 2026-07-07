// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

// --- Captured model subscribers, repopulated in beforeEach ---
/** @type {Function[]} */
let _modelSubscribers;
/** @type {any[]} */
let _modelFilters;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn((Model, filter) => ({
      subscribe: (handlers) => {
        const next = typeof handlers === 'function' ? handlers : handlers.next;
        _modelSubscribers.push(next);
        _modelFilters.push(filter);
        next([]);
        return { unsubscribe: vi.fn() };
      }
    }))
  },
  pool: {}
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

// Card components pull loaders/relay config — stub them all.
// (vi.mock factories are hoisted, so each must be self-contained.)
vi.mock('$lib/components/educational/AMBResourceCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('$lib/components/article/ArticleCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('$lib/components/calendar/CalendarEventCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('$lib/components/polls/PollCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('$lib/components/bookmarks/UrlCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('$lib/components/bookmarks/EventHighlightCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));

import ProfileContentTab from '../profile/ProfileContentTab.svelte';

const PUBKEY = 'a'.repeat(64);

function ev(kind, extra = {}) {
  return {
    id: Math.random().toString(16).slice(2).padEnd(64, '0'),
    kind,
    pubkey: PUBKEY,
    created_at: 100,
    content: '',
    tags: [['d', 'x']],
    ...extra
  };
}

async function emit(events) {
  for (const cb of _modelSubscribers) cb(events);
  await tick();
}

describe('<ProfileContentTab>', () => {
  beforeEach(() => {
    _modelSubscribers = [];
    _modelFilters = [];
  });

  it('subscribes with the tab kinds and the profile author', () => {
    render(ProfileContentTab, { pubkey: PUBKEY, tabId: 'content' });
    expect(_modelFilters[0]).toEqual({ kinds: [30142], authors: [PUBKEY] });
  });

  it('shows the empty state when nothing is loaded', () => {
    const { container } = render(ProfileContentTab, { pubkey: PUBKEY, tabId: 'articles' });
    expect(container.querySelector('[data-testid="tab-empty"]')).toBeTruthy();
  });

  it('renders one card per resource event on the content tab', async () => {
    const { container } = render(ProfileContentTab, { pubkey: PUBKEY, tabId: 'content' });
    await emit([ev(30142), ev(30142)]);
    expect(container.querySelectorAll('[data-testid="stub-component"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="tab-empty"]')).toBeFalsy();
  });

  it('renders poll cards on the polls tab', async () => {
    const { container } = render(ProfileContentTab, { pubkey: PUBKEY, tabId: 'polls' });
    await emit([ev(1068)]);
    expect(container.querySelectorAll('[data-testid="stub-component"]')).toHaveLength(1);
  });

  it('renders grouped bookmark cards on the bookmarks tab', async () => {
    const { container } = render(ProfileContentTab, { pubkey: PUBKEY, tabId: 'bookmarks' });
    await emit([
      ev(39701, { tags: [['d', 'example.com/a']] }),
      ev(39701, { tags: [['d', 'example.com/a']] })
    ]);
    // Two web bookmarks of the same URL group into a single card
    expect(container.querySelectorAll('[data-testid="stub-component"]')).toHaveLength(1);
  });
});
