// @ts-nocheck
/**
 * CalendarEventPreview — a channel meeting (h = channel id) embedded by naddr
 * renders a neutral "meeting in a channel" card: no RSVP (a 31925 would go
 * out through the outbox naming it), no details, no calendar link.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

const h = vi.hoisted(() => ({ event: null }));
// The preview resolves its reference through the EventStore (store first)
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { of } = await import('rxjs');
  return { eventStore: { event: () => of(h.event) } };
});
// The component only falls back to decoding when no `decoded` prop is passed
vi.mock('$lib/helpers/nostrUtils.js', () => ({ decodeNostrIdentifier: () => null }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64) })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { calendar: { locale: 'de-DE', timeFormat: '24h' } }
}));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock(
  '$lib/components/calendar/InlineRsvp.svelte',
  () => import('./fixtures/StubComponent.svelte')
);
vi.mock(
  '$lib/components/shared/MarkdownRenderer.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/LocationLink.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/shared/ImageWithFallback.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);

/** A decoded naddr for the component (the dispatcher normally passes it) */
const decoded = {
  success: true,
  type: 'naddr',
  data: { kind: 31923, pubkey: 'b'.repeat(64), identifier: 'm1', relays: [] },
  identifier: 'naddr1x'
};

const { default: CalendarEventPreview } = await import(
  '$lib/components/shared/NostrPreviews/CalendarEventPreview.svelte'
);

/** @param {string} hValue */
const calendarEvent = (hValue) => ({
  id: 'e'.repeat(64),
  kind: 31923,
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  content: '',
  tags: [
    ['d', 'm1'],
    ['title', 'Elternabend'],
    ['start', '2000000000'],
    ['h', hValue]
  ]
});

describe('CalendarEventPreview', () => {
  it('renders a neutral card for a channel meeting: no RSVP, no link', async () => {
    h.event = calendarEvent('4c9b50c8c413f15e');
    const { container } = render(CalendarEventPreview, { identifier: 'naddr1x', decoded });
    const card = await screen.findByTestId('channel-meeting-preview');
    expect(card.textContent).toContain(m.meeting_preview_channel());
    expect(screen.queryByTestId('stub-component')).toBeNull();
    expect(screen.queryByTestId('calendar-event-preview-card')).toBeNull();
    expect(container.querySelector('a[href*="/calendar/event/"]')).toBeNull();
  });

  it('keeps the full card and RSVP for a community calendar event', async () => {
    h.event = calendarEvent('c'.repeat(64));
    render(CalendarEventPreview, { identifier: 'naddr1y', decoded });
    await waitFor(() => expect(screen.getByTestId('calendar-event-preview-card')).toBeTruthy());
    expect(screen.getByTestId('stub-component')).toBeTruthy();
  });
});
