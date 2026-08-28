/** @vitest-environment jsdom */
// CommunityContentView must wire useAuthorDeletions alongside useProfileMap
// (CLAUDE.md: any surface listing OTHER people's content). Without it the
// Articles/Wikis/Polls/Boards/Forum tabs never load other authors' kind-5s,
// so deleted content keeps rendering from a stale local copy — and stays
// shareable. HomeView/LearningView already follow the convention.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const AUTHOR = 'a'.repeat(64);
const SHARER = 'b'.repeat(64);

const useAuthorDeletions = vi.hoisted(() => vi.fn(() => {}));
vi.mock('$lib/stores/author-deletions.svelte.js', () => ({ useAuthorDeletions }));

const useProfileMap = vi.hoisted(() => vi.fn(() => () => new Map()));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap }));

const fixtures = vi.hoisted(() => ({
  items: /** @type {any[]} */ ([])
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (/** @type {any} */ obs) => {
        obs.next(fixtures.items);
        return { unsubscribe: () => {} };
      }
    })
  },
  pool: {}
}));

const { default: CommunityContentView } = await import(
  '$lib/components/community/views/CommunityContentView.svelte'
);

describe('CommunityContentView — author deletions', () => {
  it('feeds item authors AND sharers to useAuthorDeletions', async () => {
    fixtures.items = [
      { id: 'e1', pubkey: AUTHOR, kind: 30023, tags: [], content: '', _sharedBy: SHARER }
    ];

    render(CommunityContentView, {
      props: {
        communityPubkey: 'c'.repeat(64),
        loaderHook: () => ({ subscriptions: new Map(), cleanup: () => {} }),
        model: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
        loadingText: 'loading',
        emptyTitle: 'empty',
        emptyDescription: 'none',
        formatCount: (/** @type {number} */ n) => `${n}`,
        content: createRawSnippet(() => ({ render: () => '<div></div>' }))
      }
    });

    expect(useAuthorDeletions).toHaveBeenCalled();
    const getter = /** @type {() => string[]} */ (useAuthorDeletions.mock.calls[0][0]);
    const pubkeys = getter();
    expect(pubkeys).toContain(AUTHOR);
    expect(pubkeys).toContain(SHARER);
  });
});
