/**
 * ChannelEventsBar — NIP-52 channel events surfaced above the chat.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  concord_events_title: (/** @type {{ count: number }} */ { count }) => `${count} upcoming events`
}));

const { default: ChannelEventsBar } = await import(
  '$lib/components/community/channels/ChannelEventsBar.svelte'
);

const ME = 'c'.repeat(64);
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;

/** @param {any} overrides */
function event(overrides = {}) {
  return {
    id: 'ev-1',
    kind: 31923,
    pubkey: 'a'.repeat(64),
    d: 'standup',
    title: 'Standup',
    start: String(FUTURE),
    end: undefined,
    location: 'Hive HQ',
    dateBased: false,
    ...overrides
  };
}

describe('ChannelEventsBar', () => {
  it('renders nothing when every event already ended', () => {
    const { container } = render(ChannelEventsBar, {
      props: {
        events: [event({ start: String(PAST) })],
        rsvpsByEvent: new Map(),
        myPubkey: ME,
        onRsvp: () => {}
      }
    });
    expect(container.querySelector('[data-testid="events-bar-toggle"]')).toBeNull();
  });

  it('lists upcoming events behind the toggle, with RSVP counts and my status marked', async () => {
    const rsvps = new Map([
      [
        'ev-1',
        [
          { pubkey: ME, status: 'accepted', ms: 1000 },
          { pubkey: 'b'.repeat(64), status: 'tentative', ms: 1000 }
        ]
      ]
    ]);
    render(ChannelEventsBar, {
      props: { events: [event()], rsvpsByEvent: rsvps, myPubkey: ME, onRsvp: () => {} }
    });
    await fireEvent.click(screen.getByTestId('events-bar-toggle'));

    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByText('📍 Hive HQ')).toBeTruthy();
    expect(screen.getByTestId('rsvp-accepted').textContent).toContain('1');
    expect(screen.getByTestId('rsvp-tentative').textContent).toContain('1');
    expect(screen.getByTestId('rsvp-accepted').className).toContain('btn-primary'); // mine
  });

  it('clicking a status calls onRsvp with the event id and status', async () => {
    const onRsvp = vi.fn();
    render(ChannelEventsBar, {
      props: { events: [event()], rsvpsByEvent: new Map(), myPubkey: ME, onRsvp }
    });
    await fireEvent.click(screen.getByTestId('events-bar-toggle'));
    await fireEvent.click(screen.getByTestId('rsvp-declined'));
    expect(onRsvp).toHaveBeenCalledWith('ev-1', 'declined');
  });
});
