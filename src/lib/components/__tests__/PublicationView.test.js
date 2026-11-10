// @ts-nocheck
/**
 * PublicationView — a lesson series (type lesson-series) lists its parts,
 * kind 30023 by address in `a`-tag order, as a table of contents; a 30142
 * describing it adds AMB badges. An academic publication renders as before.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const PK = 'a'.repeat(64);
const doubles = vi.hoisted(() => ({ eventStore: null, fetchEvents: null }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  doubles.eventStore = eventStore;
  const { EMPTY } = await import('rxjs');
  const pool = {
    request: () => EMPTY,
    subscription: () => EMPTY,
    group: () => ({ request: () => EMPTY, subscription: () => EMPTY }),
    relay: () => ({ request: () => EMPTY, subscription: () => EMPTY })
  };
  return { eventStore, pool };
});
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/loaders/event-highlights.js', () => ({
  loadEventHighlights: () => ({ loader: () => {}, cleanup: () => {} })
}));
vi.mock('$lib/loaders/base.js', () => {
  doubles.fetchEvents = vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }));
  return { fetchEvents: doubles.fetchEvents };
});
vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getAppManagedRelays: () => [],
  getArticleRelays: () => ['wss://long.example/'],
  getEducationalRelays: () => ['wss://amb.example/']
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({
  resolve: (path, params) => (params?.naddr ? `/${params.naddr}` : path)
}));
vi.mock('$lib/components/shared/DetailHeader.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/reactions/ReactionBar.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/comments/CommentList.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));

import PublicationView from '../publication/PublicationView.svelte';

const article = (d, title, created_at = 10) => ({
  id: `${d}`
    .padEnd(64, '0')
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, 'e'),
  kind: 30023,
  pubkey: PK,
  created_at,
  tags: [
    ['d', d],
    ['title', title]
  ],
  content: 'x',
  sig: ''
});
const series = (parts, type = 'lesson-series') => ({
  id: 'f'.repeat(64),
  kind: 30040,
  pubkey: PK,
  created_at: 20,
  tags: [
    ['d', 'series-1'],
    ['title', 'Brüche, Klasse 6'],
    ['type', type],
    ...parts.map((d) => ['a', `30023:${PK}:${d}`, 'wss://long.example/'])
  ],
  content: '',
  sig: ''
});

beforeEach(() => doubles.fetchEvents.mockClear());
afterEach(() => cleanup());

describe('PublicationView table of contents', () => {
  it('lists the parts in a-tag order with titles linked to the article', () => {
    doubles.eventStore.add(article('s-lesson-1', 'Stunde 1: Brüche entdecken'));
    doubles.eventStore.add(article('s-overview', 'Überblick & Kompetenzen'));
    render(PublicationView, { event: series(['s-overview', 's-lesson-1', 's-missing']) });
    flushSync();
    const items = screen.getByTestId('publication-contents').querySelectorAll('li');
    expect([...items].map((li) => li.textContent.trim())).toEqual([
      'Überblick & Kompetenzen',
      'Stunde 1: Brüche entdecken',
      expect.stringMatching(/geladen|Loading/)
    ]);
    expect(items[0].querySelector('a').getAttribute('href')).toMatch(/^\/naddr1/);
    expect(doubles.fetchEvents).toHaveBeenCalledWith(['wss://long.example/'], {
      kinds: [30023],
      authors: [PK],
      '#d': ['s-overview', 's-lesson-1', 's-missing']
    });
  });

  it('shows the AMB badges of a 30142 by the same author that points at it', () => {
    doubles.eventStore.add({
      id: 'c'.repeat(64),
      kind: 30142,
      pubkey: PK,
      created_at: 30,
      tags: [
        ['d', 'nostr:naddr1x'],
        ['a', `30040:${PK}:series-1`, 'wss://amb.example/', 'id'],
        ['educationalLevel:id', 'https://w3id.org/kim/educationalLevel/level_1'],
        ['educationalLevel:prefLabel:de', 'Primarbereich'],
        ['teaches:id', 'https://w3id.org/lehrplan/k1'],
        ['teaches:prefLabel:de', 'Brüche vergleichen']
      ],
      content: '',
      sig: ''
    });
    render(PublicationView, { event: series(['s-overview']) });
    flushSync();
    const badges = screen.getByTestId('publication-amb-badges').textContent;
    expect(badges).toContain('Primarbereich');
    expect(badges).toContain('Brüche vergleichen');
  });

  it('an academic publication gets no table of contents and no extra requests', () => {
    render(PublicationView, { event: series(['s-overview'], 'academic') });
    flushSync();
    expect(screen.queryByTestId('publication-contents')).toBeNull();
    expect(doubles.fetchEvents).not.toHaveBeenCalled();
  });
});
