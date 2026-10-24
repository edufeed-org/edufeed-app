/** @vitest-environment node */
// The discover feeds: one createTimelineFeed per content type, relays and the
// curated filter re-read on every sync() (user relay overrides and curated/WoT
// authors arrive after mount).
import { describe, it, expect, vi } from 'vitest';

const CURATED = ['c'.repeat(64)];
vi.mock('$lib/loaders/timeline-feed.js', () => ({
  createTimelineFeed: vi.fn((/** @type {any} */ options) => options)
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  applyCuratedFilter: (/** @type {any} */ filter) => ({ ...filter, authors: CURATED })
}));
const getArticleRelays = () => ['wss://articles.example/'];
const getEducationalRelays = () => ['wss://amb.example/'];
const getKanbanRelays = () => ['wss://kanban.example/'];
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getArticleRelays,
  getEducationalRelays,
  getKanbanRelays
}));
vi.mock('$lib/loaders/community-content-loader.js', () => ({
  createCommunityContentLoader: () => () => ({ subscriptions: new Map(), cleanup: () => {} })
}));

describe('discover feed factories', () => {
  it('createArticleFeed pages kind 30023 from the article relays with the curated filter', async () => {
    const { createArticleFeed } = await import('$lib/loaders/articles.js');
    const feed = /** @type {any} */ (createArticleFeed(20));
    expect(feed.getRelays).toBe(getArticleRelays);
    expect(feed.getFilter()).toEqual({ kinds: [30023], authors: CURATED });
    expect(feed.pageSize).toBe(20);
  });

  it('createAmbFeed pages kind 30142 from the educational relays', async () => {
    const { createAmbFeed } = await import('$lib/loaders/amb.js');
    const feed = /** @type {any} */ (createAmbFeed(20));
    expect(feed.getRelays).toBe(getEducationalRelays);
    expect(feed.getFilter()).toEqual({ kinds: [30142], authors: CURATED });
    expect(feed.pageSize).toBe(20);
  });

  it('createKanbanFeed pages kind 30301 from the kanban relays', async () => {
    const { createKanbanFeed } = await import('$lib/loaders/kanban.js');
    const feed = /** @type {any} */ (createKanbanFeed(20));
    expect(feed.getRelays).toBe(getKanbanRelays);
    expect(feed.getFilter()).toEqual({ kinds: [30301], authors: CURATED });
    expect(feed.pageSize).toBe(20);
  });
});
