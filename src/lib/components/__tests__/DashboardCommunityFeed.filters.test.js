// @ts-nocheck
/** @vitest-environment jsdom */
// The community dashboard feed offers the same content-type chips as the
// follows feed (issue: "Content types filter missing in community feed").
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const COMMUNITY = 'c'.repeat(64);

const fixtures = vi.hoisted(() => ({ activity: /** @type {any[]} */ ([]) }));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => [COMMUNITY]
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/stores/contacts.svelte.js', () => ({ contactsStore: { contacts: [] } }));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/loaders/profile-feed-loaders.js', () => ({ startProfileFeedLoaders: () => [] }));
vi.mock('$lib/helpers/relay-helper.js', async (orig) => ({
  ...(await orig()),
  getCommunikeyRelays: () => []
}));
vi.mock('$lib/loaders/community-activity.js', () => ({
  useCommunityActivityLoader: () => ({ cleanup: () => {} })
}));
vi.mock('$lib/loaders/social-bookmarks.js', () => ({
  useSocialBookmarksCommunityLoader: () => ({ cleanup: () => {} })
}));
vi.mock('$lib/groups/community-access-subscription.js', () => ({
  subscribeToCommunityAccess: () => ({ cleanup: () => {}, hasRestrictedSections: false })
}));
vi.mock('$lib/models/community-content.js', () => ({
  CommunityActivityModel: 'activity',
  CommunitySocialBookmarkModel: 'bookmarks'
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (model) => ({
      subscribe: (obs) => {
        obs.next(model === 'activity' ? fixtures.activity : []);
        return { unsubscribe: () => {} };
      }
    }),
    replaceable: () => ({
      subscribe: (cb) => {
        cb(undefined);
        return { unsubscribe: () => {} };
      }
    })
  },
  pool: {}
}));
vi.mock('$lib/components/shared/FeedCard.svelte', async () => ({
  default: (await import('./fixtures/FeedCardStub.svelte')).default
}));
vi.mock('$lib/components/dashboard/DashboardFeedSelector.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/dashboard/FeedComposer.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/dashboard/RichFeedEntry.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));

const { feedStateCache } = await import('$lib/stores/feed-state-cache.js');
const { default: DashboardCommunityFeed } = await import(
  '$lib/components/dashboard/DashboardCommunityFeed.svelte'
);

/** @param {number} kind @param {number} ts @param {object} [extra] */
const ev = (kind, ts, extra = {}) => ({
  id: `id-${kind}-${ts}`,
  kind,
  created_at: ts,
  pubkey: 'a'.repeat(64),
  tags: [
    ['h', COMMUNITY],
    ['d', `d-${ts}`],
    ['title', `t${ts}`]
  ],
  content: '',
  ...extra
});

const renderedKinds = () =>
  screen.queryAllByTestId('feed-card').map((el) => Number(el.getAttribute('data-kind')));

const chip = (id) =>
  screen.getAllByTestId('feed-filter-chip').find((el) => el.dataset.category === id);

describe('DashboardCommunityFeed — content type chips', () => {
  beforeEach(() => {
    feedStateCache.clear();
    fixtures.activity = [];
  });

  it('renders community content chips (no notes chip without follows)', () => {
    fixtures.activity = [ev(30142, 100)];
    render(DashboardCommunityFeed);
    const ids = screen.getAllByTestId('feed-filter-chip').map((el) => el.dataset.category);
    expect(ids).toEqual(expect.arrayContaining(['calendar', 'resources', 'forum', 'shared']));
    expect(ids).not.toContain('notes');
  });

  it('offers a notes chip in the combined (follows merged) feed', () => {
    render(DashboardCommunityFeed, { props: { includeFollows: true } });
    const ids = screen.getAllByTestId('feed-filter-chip').map((el) => el.dataset.category);
    expect(ids[0]).toBe('notes');
  });

  it('selecting a chip narrows the feed to that category', async () => {
    fixtures.activity = [ev(30142, 300), ev(11, 200), ev(30023, 100)];
    render(DashboardCommunityFeed);
    expect(renderedKinds()).toEqual([30142, 11, 30023]);

    await fireEvent.click(chip('forum').querySelectorAll('button')[0]);
    expect(renderedKinds()).toEqual([11]);
  });

  it('the eye button hides a category; reposts count as shared', async () => {
    fixtures.activity = [ev(30142, 300, { _sharedBy: 'b'.repeat(64) }), ev(30142, 200)];
    render(DashboardCommunityFeed);
    await fireEvent.click(chip('shared').querySelectorAll('button')[1]);
    expect(screen.getAllByTestId('feed-card').map((el) => el.dataset.id)).toEqual(['id-30142-200']);
  });

  it('pagination counts filtered items, so a filter never strands the view', async () => {
    // 30 forum threads, then 5 resources (older). Unfiltered the first page
    // (15) holds only forum; filtering to resources must show all 5.
    fixtures.activity = [
      ...Array.from({ length: 30 }, (_, i) => ev(11, 1000 - i)),
      ...Array.from({ length: 5 }, (_, i) => ev(30142, 500 - i))
    ];
    render(DashboardCommunityFeed);
    expect(renderedKinds()).toHaveLength(15);
    await fireEvent.click(chip('resources').querySelectorAll('button')[0]);
    expect(renderedKinds()).toEqual([30142, 30142, 30142, 30142, 30142]);
    expect(screen.queryByText(/load more|mehr laden/i)).toBeNull();
  });

  it('persists the selection across remounts', async () => {
    fixtures.activity = [ev(30142, 300), ev(11, 200)];
    const first = render(DashboardCommunityFeed);
    await fireEvent.click(chip('forum').querySelectorAll('button')[0]);
    first.unmount();
    render(DashboardCommunityFeed);
    expect(renderedKinds()).toEqual([11]);
    expect(chip('forum').querySelector('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a separate selection per feed source when the prop switches', async () => {
    fixtures.activity = [ev(30142, 300), ev(11, 200)];
    const view = render(DashboardCommunityFeed, { props: { includeFollows: true } });
    await fireEvent.click(chip('notes').querySelectorAll('button')[0]);
    expect(renderedKinds()).toEqual([]);
    await view.rerender({ includeFollows: false });
    expect(
      screen.queryAllByTestId('feed-filter-chip').map((el) => el.dataset.category)
    ).not.toContain('notes');
    // RichFeedEntry is stubbed in combined mode, so FeedCards only render here
    expect(renderedKinds()).toEqual([30142, 11]);
    await view.rerender({ includeFollows: true });
    expect(chip('notes').querySelector('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('hides chips and ignores the selection in preview mode', async () => {
    fixtures.activity = [ev(30142, 300), ev(11, 200)];
    const first = render(DashboardCommunityFeed);
    await fireEvent.click(chip('forum').querySelectorAll('button')[0]);
    first.unmount();
    render(DashboardCommunityFeed, { props: { previewCount: 5 } });
    expect(screen.queryAllByTestId('feed-filter-chip')).toHaveLength(0);
    expect(renderedKinds()).toEqual([30142, 11]);
  });
});
