/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Svelte 5 component stubs must be real components; use a shared fixture.
vi.mock('$lib/components/notes/NoteCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/calendar/CalendarEventCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/educational/AMBResourceCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/article/ArticleCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/polls/PollCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/bookmarks/PageNoteItem.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/bookmarks/UrlCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
vi.mock('$lib/components/bookmarks/HighlightCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));

import FeedEntryCard from '$lib/components/shared/FeedEntryCard.svelte';

const ev = (/** @type {number} */ kind, /** @type {string[][]} */ tags = []) => ({
  id: 'e'.repeat(64),
  kind,
  pubkey: 'a'.repeat(64),
  content: 'x',
  tags,
  created_at: 1,
  sig: ''
});

describe('FeedEntryCard dispatch', () => {
  it.each([
    [1, 'notes'],
    [30023, 'articles'],
    [1068, 'polls'],
    [9802, 'highlights'],
    [1111, 'bookmarks']
  ])('renders a card for kind %i', (kind) => {
    const { container } = render(FeedEntryCard, { props: { event: ev(kind) } });
    expect(container.querySelector('[data-stub]')).toBeTruthy();
  });

  it('renders a UrlCard for a kind 39701 web bookmark (synthesized group)', () => {
    const { container } = render(FeedEntryCard, {
      props: {
        event: ev(39701, [
          ['d', 'example.org/post'],
          ['title', 'A post']
        ])
      }
    });
    expect(container.querySelector('[data-stub]')).toBeTruthy();
  });

  it('renders NOTHING for an unknown kind (safety net)', () => {
    const { container } = render(FeedEntryCard, { props: { event: ev(31337) } });
    expect(container.querySelector('[data-stub]')).toBeFalsy();
    expect(container.textContent?.trim()).toBe('');
  });
});
