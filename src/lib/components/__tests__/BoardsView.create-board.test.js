// @ts-nocheck
/** @vitest-environment jsdom */
// Community Boards tab offers a "Create board" CTA into the external Kanban
// editor (GitHub #14) — also when the community has no boards yet.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';

vi.mock('$app/stores', () => ({ page: readable({ data: { npub: 'npub1test' } }) }));
vi.mock('$lib/stores/author-deletions.svelte.js', () => ({ useAuthorDeletions: () => {} }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/loaders/kanban-community.js', () => ({
  useKanbanCommunityLoader: () => ({ subscriptions: new Map(), cleanup: () => {} })
}));
vi.mock('$lib/models/community-content.js', () => ({ CommunityBoardModel: () => () => null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (obs) => {
        obs.next([]);
        return { unsubscribe: () => {} };
      }
    })
  },
  pool: {}
}));

const { default: BoardsView } = await import('$lib/components/community/views/BoardsView.svelte');

describe('BoardsView — create board CTA', () => {
  it('links to the kanban editor even when the community has no boards', () => {
    render(BoardsView, { props: { communityPubkey: 'c'.repeat(64) } });
    const link = screen.getByTestId('create-board-link');
    expect(link.getAttribute('href')).toBe('https://kanban.edufeed.org/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });
});
