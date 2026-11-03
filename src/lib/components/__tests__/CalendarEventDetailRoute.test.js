// @ts-nocheck
/**
 * /calendar/event/[naddr] — the page must not stay on the load's snapshot:
 * a newer revision that reaches the EventStore replaces a stale cached one,
 * and an event its author deleted shows a "deleted" state instead of the
 * event (NIP-09).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { BehaviorSubject, Subject } from 'rxjs';

const deleted = new Set();
let replaceable$;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => replaceable$ }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => new Subject(),
  fetchAuthorsDeletions: () => new Subject()
}));
vi.mock('$lib/helpers/communityRepost.js', () => ({
  isDeletedEvent: (event) => !!event && deleted.has(event.id)
}));
vi.mock('$lib/helpers/eventUtils', () => ({
  getCalendarEventMetadata: (e) => ({ title: e.tags.find((t) => t[0] === 'title')?.[1] })
}));
vi.mock(
  '$lib/components/calendar/CalendarEventDetailView.svelte',
  () => import('./fixtures/CalendarEventDetailViewStub.svelte')
);

const { default: EventPage } = await import('../../../routes/calendar/event/[naddr]/+page.svelte');

const PUBKEY = 'a'.repeat(64);
const POINTER = { kind: 31923, pubkey: PUBKEY, identifier: 'workshop', relays: [] };

/** @param {string} id @param {number} created_at @param {string} title */
const revision = (id, created_at, title) => ({
  id,
  kind: 31923,
  pubkey: PUBKEY,
  created_at,
  content: '',
  tags: [
    ['d', 'workshop'],
    ['title', title]
  ]
});

/** @param {any} rawEvent */
const pageData = (rawEvent) => ({
  data: { rawEvent, event: null, naddr: 'naddr1x', pointer: POINTER }
});

describe('/calendar/event/[naddr] route', () => {
  beforeEach(() => {
    deleted.clear();
  });

  it('replaces a stale cached revision with the newer relay revision', () => {
    const cached = revision('b'.repeat(64), 100, 'Old title');
    replaceable$ = new BehaviorSubject(cached);
    render(EventPage, { props: pageData(cached) });
    expect(screen.getByTestId('calendar-event-detail-stub').textContent).toContain('Old title');

    flushSync(() => replaceable$.next(revision('c'.repeat(64), 200, 'New title')));

    expect(screen.getByTestId('calendar-event-detail-stub').textContent).toContain('New title');
  });

  it('shows the deleted state for an event its author deleted', () => {
    const cached = revision('b'.repeat(64), 100, 'Old title');
    deleted.add(cached.id);
    // The store refuses a deleted event, so its model has nothing to emit
    replaceable$ = new BehaviorSubject(undefined);
    render(EventPage, { props: pageData(cached) });

    expect(screen.getByTestId('calendar-event-deleted')).toBeTruthy();
    expect(screen.queryByTestId('calendar-event-detail-stub')).toBeNull();
  });

  it('switches to the deleted state when the deletion arrives while open', () => {
    const cached = revision('b'.repeat(64), 100, 'Old title');
    replaceable$ = new BehaviorSubject(cached);
    render(EventPage, { props: pageData(cached) });
    expect(screen.queryByTestId('calendar-event-deleted')).toBeNull();

    deleted.add(cached.id);
    flushSync(() => replaceable$.next(undefined));

    expect(screen.getByTestId('calendar-event-deleted')).toBeTruthy();
    expect(screen.queryByTestId('calendar-event-detail-stub')).toBeNull();
  });
});
