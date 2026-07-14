/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Svelte 5 component stubs must be real components; each card gets its own
// discriminating fixture so a swapped dispatch branch fails the test.
vi.mock('$lib/components/notes/NoteCard.svelte', async () => ({
  default: (await import('./fixtures/StubNoteCard.svelte')).default
}));
vi.mock('$lib/components/calendar/CalendarEventCard.svelte', async () => ({
  default: (await import('./fixtures/StubCalendarEventCard.svelte')).default
}));
vi.mock('$lib/components/educational/AMBResourceCard.svelte', async () => ({
  default: (await import('./fixtures/StubAMBResourceCard.svelte')).default
}));
vi.mock('$lib/components/article/ArticleCard.svelte', async () => ({
  default: (await import('./fixtures/StubArticleCard.svelte')).default
}));
vi.mock('$lib/components/polls/PollCard.svelte', async () => ({
  default: (await import('./fixtures/StubPollCard.svelte')).default
}));
vi.mock('$lib/components/bookmarks/PageNoteItem.svelte', async () => ({
  default: (await import('./fixtures/StubPageNoteItem.svelte')).default
}));
vi.mock('$lib/components/bookmarks/UrlCard.svelte', async () => ({
  default: (await import('./fixtures/StubUrlCard.svelte')).default
}));
vi.mock('$lib/components/bookmarks/HighlightCard.svelte', async () => ({
  default: (await import('./fixtures/StubHighlightCard.svelte')).default
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
    [1, 'NoteCard'],
    [30023, 'ArticleCard'],
    [1068, 'PollCard'],
    [9802, 'HighlightCard'],
    [1111, 'PageNoteItem'],
    [30142, 'AMBResourceCard']
  ])('kind %i renders exactly %s', (kind, card) => {
    const { container } = render(FeedEntryCard, { props: { event: ev(kind) } });
    expect(container.querySelector(`[data-stub="${card}"]`)).toBeTruthy();
    expect(container.querySelectorAll('[data-stub]')).toHaveLength(1);
  });

  it('renders CalendarEventCard for a kind 31922 date-based calendar event', () => {
    const { container } = render(FeedEntryCard, {
      props: {
        event: ev(31922, [
          ['d', 'x'],
          ['start', '1700000000'],
          ['title', 't']
        ])
      }
    });
    expect(container.querySelector('[data-stub="CalendarEventCard"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-stub]')).toHaveLength(1);
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
    expect(container.querySelector('[data-stub="UrlCard"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-stub]')).toHaveLength(1);
  });

  it('renders NOTHING for an unknown kind (safety net)', () => {
    const { container } = render(FeedEntryCard, { props: { event: ev(31337) } });
    expect(container.querySelector('[data-stub]')).toBeFalsy();
    expect(container.textContent?.trim()).toBe('');
  });
});
