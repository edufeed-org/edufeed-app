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
vi.mock('$lib/helpers/nostrUtils.js', () => ({ fetchEventById: async () => h.event }));
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
    const { container } = render(CalendarEventPreview, { identifier: 'naddr1x', decoded: null });
    const card = await screen.findByTestId('channel-meeting-preview');
    expect(card.textContent).toContain(m.meeting_preview_channel());
    expect(screen.queryByTestId('stub-component')).toBeNull();
    expect(screen.queryByTestId('calendar-event-preview-card')).toBeNull();
    expect(container.querySelector('a[href*="/calendar/event/"]')).toBeNull();
  });

  it('keeps the full card and RSVP for a community calendar event', async () => {
    h.event = calendarEvent('c'.repeat(64));
    render(CalendarEventPreview, { identifier: 'naddr1y', decoded: null });
    await waitFor(() => expect(screen.getByTestId('calendar-event-preview-card')).toBeTruthy());
    expect(screen.getByTestId('stub-component')).toBeTruthy();
  });
});
