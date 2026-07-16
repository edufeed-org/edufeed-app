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
  // Real compiled messages (locale defaults to English in tests).
  return /** @type {any} */ (await importOriginal());
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

  it('shows the source domain line (domain only, no hint text)', () => {
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: indexedEvent }
    });
    const line = container.querySelector('[data-testid="metadata-attribution"]');
    expect(line?.textContent?.trim()).toBe('oerf-journal.eu');
  });

  it('omits the source line when the d-tag is not a URL', () => {
    const noUrlEvent = {
      ...indexedEvent,
      tags: [
        ['d', 'abc123'],
        ['creator:name', 'Regina Polak'],
        ['creator:type', 'Person']
      ]
    };
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: noUrlEvent }
    });
    expect(container.querySelector('[data-testid="metadata-attribution"]')).toBeFalsy();
  });

  it('stacks avatars and joins names with +N for multi-author resources', () => {
    const multiEvent = {
      ...indexedEvent,
      tags: [
        ['d', 'https://www.rpi-ekkw-ekhn.de/some/article.pdf'],
        ['creator:name', 'Institut RPI'],
        ['creator:type', 'Organization'],
        ['creator:name', 'Julia Gerth'],
        ['creator:type', 'Person'],
        ['creator:name', 'Nadine Hofmann-Driesch'],
        ['creator:type', 'Person']
      ]
    };
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: multiEvent }
    });
    expect(container.textContent).toContain('Institut RPI, Julia Gerth +1');
    // 3 creators fit within max 3 → three avatars, no overflow circle
    const stack = container.querySelector('[data-testid="creator-avatar-stack"]');
    expect(stack?.querySelectorAll('[data-testid="metadata-avatar"]').length).toBe(3);
    expect(stack?.querySelector('[data-testid="creator-overflow"]')).toBeFalsy();
  });

  it('renders the type badge in flex flow so long names truncate before it', () => {
    // Regression: the badge was absolutely positioned, so a long author name
    // ran underneath it instead of truncating.
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: indexedEvent }
    });
    const badge = [...container.querySelectorAll('div.rounded-full')]
      .filter((el) => el.textContent?.includes('Learning'))
      .pop();
    expect(badge).toBeTruthy();
    expect(badge?.className).not.toContain('absolute');
    expect(badge?.className).toContain('self-start');
  });

  it('shows all creator names in a hover title on the name line', () => {
    const multiEvent = {
      ...indexedEvent,
      tags: [
        ['d', 'https://example.org/x'],
        ['creator:name', 'Judith Noa'],
        ['creator:type', 'Person'],
        ['creator:name', 'Konstantin Falahati'],
        ['creator:type', 'Person'],
        ['creator:name', 'Anna Krause'],
        ['creator:type', 'Person']
      ]
    };
    const { container } = render(FeedCard, {
      props: { ...baseProps, event: multiEvent }
    });
    // Full list on the name line (individual avatars carry single-name titles)
    const nameEl = container.querySelector(
      '[title="Judith Noa, Konstantin Falahati, Anna Krause"]'
    );
    expect(nameEl).toBeTruthy();
    expect(nameEl?.textContent).toContain('+1');
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
