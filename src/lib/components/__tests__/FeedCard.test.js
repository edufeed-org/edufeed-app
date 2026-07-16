/**
 * FeedCard Component Tests
 *
 * Focus: indexed-resource attribution (kind 30142) — the generic feed card
 * (community activity, dashboard feeds, bookmark/list views) must show the
 * AMB metadata creator instead of the indexer pubkey, mirroring
 * AMBResourceCard.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import FeedCard from '../shared/FeedCard.svelte';

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));
vi.mock('$lib/paraglide/messages', async (importOriginal) => {
  // Real compiled messages, with a stable English label for the one we assert on.
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    amb_card_author_from_metadata: () => 'Author from metadata'
  };
});
vi.mock('$lib/helpers/calendar.js', () => ({
  formatRelativeTime: () => '19h ago'
}));

const INDEXER_PUBKEY = 'f'.repeat(64);

const indexedEvent = {
  id: 'a'.repeat(64),
  kind: 30142,
  pubkey: INDEXER_PUBKEY,
  created_at: 1784121175,
  tags: [
    ['d', 'https://oerf-journal.eu/index.php/oerf/article/view/605'],
    ['name', 'Aufbruch ins Unbekannte'],
    ['creator:name', 'Regina Polak'],
    ['creator:type', 'Person']
  ]
};

const baseProps = {
  title: 'Aufbruch ins Unbekannte',
  typeKey: 'learning',
  kind: 30142,
  authorName: 'Colibri',
  authorAvatar: 'https://example.com/colibri.jpg',
  authorPubkey: INDEXER_PUBKEY,
  timestamp: 1784121175
};

describe('FeedCard indexed resource attribution', () => {
  it('shows the metadata creator instead of the indexer for indexed 30142 events', () => {
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: indexedEvent }
    });
    expect(container.textContent).toContain('Regina Polak');
    expect(container.textContent).not.toContain('Colibri');
    const avatar = container.querySelector('[data-testid="metadata-avatar"]');
    expect(avatar).toBeTruthy();
    expect(avatar?.textContent?.trim()).toBe('RP');
  });

  it('shows the source domain and metadata hint line', () => {
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: indexedEvent }
    });
    const line = container.querySelector('[data-testid="metadata-attribution"]');
    expect(line?.textContent).toContain('oerf-journal.eu');
    expect(line?.textContent).toContain('Author from metadata');
  });

  it('keeps the publisher for own content (creator p-tag = pubkey)', () => {
    const ownEvent = {
      ...indexedEvent,
      tags: [...indexedEvent.tags, ['p', INDEXER_PUBKEY, '', 'creator']]
    };
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: ownEvent }
    });
    expect(container.textContent).toContain('Colibri');
    expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeFalsy();
  });

  it('keeps the publisher when the creator name matches the shown author name', () => {
    const selfNamedEvent = {
      ...indexedEvent,
      tags: [
        ['d', 'xyz'],
        ['creator:name', 'Colibri'],
        ['creator:type', 'Person']
      ]
    };
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: selfNamedEvent }
    });
    expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeFalsy();
    expect(container.textContent).toContain('Colibri');
  });

  it('does not apply attribution to non-30142 kinds', () => {
    const articleEvent = { ...indexedEvent, kind: 30023 };
    const { container } = render(FeedCard, {
      props: { ...baseProps, kind: 30023, typeKey: 'article', event: articleEvent }
    });
    expect(container.textContent).toContain('Colibri');
    expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeFalsy();
  });

  it('renders unchanged without an event prop', () => {
    const { container } = render(FeedCard, { props: baseProps });
    expect(container.textContent).toContain('Colibri');
    expect(container.textContent).toContain('19h ago');
    expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeFalsy();
  });
});
