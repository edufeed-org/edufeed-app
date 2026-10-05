// @ts-nocheck
/**
 * InlineRsvp — an RSVP only tells others whether you're coming; it is NOT a
 * registration with the organizer (GitHub edufeed-org/edufeed-app#10). Every
 * surface that renders InlineRsvp must say so: the full hint in the default
 * layout, a short hint (full text as tooltip) in the compact layout.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { of } from 'rxjs';
import * as m from '$lib/paraglide/messages';

const h = vi.hoisted(() => ({ user: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => h.user
}));
vi.mock('$lib/stores/calendar-actions.svelte', () => ({
  useCalendarActions: () => ({ createRsvp: vi.fn() })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: () => of([]) }
}));
vi.mock('$lib/loaders/rsvp.js', () => ({
  calendarEventRsvpLoader: () => () => of()
}));

const { default: InlineRsvp } = await import('$lib/components/calendar/InlineRsvp.svelte');

const calendarEvent = {
  id: 'e'.repeat(64),
  kind: 31923,
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  content: '',
  tags: [
    ['d', 'ev1'],
    ['title', 'Workshop'],
    ['start', '2000000000']
  ]
};

describe('InlineRsvp not-a-registration hint', () => {
  beforeEach(() => {
    h.user = { pubkey: 'a'.repeat(64) };
  });

  it('shows the full hint in the default layout', () => {
    render(InlineRsvp, { calendarEvent });
    const hint = screen.getByTestId('rsvp-hint');
    expect(hint.textContent.trim()).toBe(m.rsvp_not_registration_hint());
  });

  it('shows the short hint with the full text as tooltip in the compact layout', () => {
    render(InlineRsvp, { calendarEvent, compact: true, size: 'sm' });
    const hint = screen.getByTestId('rsvp-hint');
    expect(hint.textContent.trim()).toBe(m.rsvp_not_registration_hint_short());
    expect(hint.getAttribute('title')).toBe(m.rsvp_not_registration_hint());
  });

  it('shows the hint to logged-out visitors too', () => {
    h.user = null;
    render(InlineRsvp, { calendarEvent });
    expect(screen.getByText(m.inline_rsvp_login_prompt(), { exact: false })).toBeTruthy();
    expect(screen.getByTestId('rsvp-hint').textContent.trim()).toBe(m.rsvp_not_registration_hint());
  });
});
