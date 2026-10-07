/**
 * AttendeeIndicator — compact (event card) summary.
 *
 * The card row reads "9 Zusagen · 1 vielleicht" next to the avatars of the
 * accepted RSVPs. Declines are not attendees: they are neither counted nor
 * pictured, and only surface (muted) when they are the only RSVPs.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import AttendeeIndicator from '../calendar/AttendeeIndicator.svelte';

const spies = vi.hoisted(() => ({ stack: vi.fn() }));

vi.mock('$lib/paraglide/messages', () => ({
  event_card_rsvp_going_one: () => '1 going',
  event_card_rsvp_going_other: (/** @type {any} */ p) => `${p.count} going`,
  event_card_rsvp_maybe: (/** @type {any} */ p) => `${p.count} maybe`,
  event_card_rsvp_declined_one: () => '1 declined',
  event_card_rsvp_declined_other: (/** @type {any} */ p) => `${p.count} declined`,
  attendee_indicator_attendees_label: (/** @type {any} */ p) => `Attendees (${p.count})`,
  attendee_indicator_accepted_label: (/** @type {any} */ p) => `Accepted (${p.count})`,
  attendee_indicator_maybe_label: (/** @type {any} */ p) => `Maybe (${p.count})`,
  attendee_indicator_declined_label: (/** @type {any} */ p) => `Declined (${p.count})`,
  attendee_indicator_show_all: () => '',
  attendee_indicator_modal_title: () => '',
  attendee_indicator_modal_close: () => ''
}));
vi.mock('../shared/CreatorAvatarStack.svelte', () => ({
  default: (/** @type {any} */ _anchor, /** @type {any} */ props) => {
    spies.stack({ creators: props.creators, max: props.max, size: props.size });
    return {};
  }
}));
vi.mock('../shared/ProfileCard.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

/** @param {string} c @param {number} n */
const rsvps = (c, n) =>
  Array.from({ length: n }, (_, i) => ({ pubkey: c.repeat(63) + i.toString(16) }));

/** @param {{accepted?: any[], tentative?: any[], declined?: any[]}} groups */
function renderCompact({ accepted = [], tentative = [], declined = [] }) {
  return render(AttendeeIndicator, {
    props: {
      accepted,
      tentative,
      declined,
      totalCount: accepted.length + tentative.length + declined.length,
      compact: true
    }
  });
}

/** @param {HTMLElement} container */
const summaryText = (container) =>
  container
    .querySelector('[data-testid="attendee-summary"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();

describe('AttendeeIndicator compact', () => {
  beforeEach(() => spies.stack.mockClear());

  it('labels going and maybe counts in words, not bare colored pills', () => {
    const { container } = renderCompact({
      accepted: rsvps('a', 9),
      tentative: rsvps('b', 1),
      declined: rsvps('c', 3)
    });
    expect(summaryText(container)).toBe('9 going · 1 maybe');
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('does not count or mention declines when anyone is coming', () => {
    const { container } = renderCompact({ accepted: rsvps('a', 2), declined: rsvps('c', 5) });
    expect(summaryText(container)).toBe('2 going');
    expect(container.textContent).not.toMatch(/declined|Attendees/);
  });

  it('uses the singular form for one RSVP', () => {
    const { container } = renderCompact({ accepted: rsvps('a', 1) });
    expect(summaryText(container)).toBe('1 going');
  });

  it('shows only maybes when nobody accepted, without an avatar stack', () => {
    const { container } = renderCompact({ tentative: rsvps('b', 2) });
    expect(summaryText(container)).toBe('2 maybe');
    expect(spies.stack).not.toHaveBeenCalled();
  });

  it('falls back to a muted decline count when declines are all there is', () => {
    const { container } = renderCompact({ declined: rsvps('c', 3) });
    const summary = container.querySelector('[data-testid="attendee-summary"]');
    expect(summaryText(container)).toBe('3 declined');
    expect(summary?.className).toMatch(/text-base-content\/50/);
    expect(spies.stack).not.toHaveBeenCalled();
  });

  it('pictures accepted RSVPs only, through the shared avatar stack', () => {
    const accepted = rsvps('a', 9);
    renderCompact({ accepted, tentative: rsvps('b', 1), declined: rsvps('c', 3) });
    expect(spies.stack).toHaveBeenCalledTimes(1);
    const { creators, size } = spies.stack.mock.calls[0][0];
    expect(creators.map((/** @type {any} */ c) => c.pubkey)).toEqual(accepted.map((a) => a.pubkey));
    expect(size).toBe('xs');
  });

  it('renders nothing without RSVPs', () => {
    const { container } = renderCompact({});
    expect(container.querySelector('[data-testid="attendee-summary"]')).toBeNull();
  });
});

describe('AttendeeIndicator expanded (detail view)', () => {
  it('keeps the per-status sections', () => {
    const { container } = render(AttendeeIndicator, {
      props: {
        accepted: rsvps('a', 2),
        tentative: rsvps('b', 1),
        declined: rsvps('c', 1),
        totalCount: 4,
        compact: false
      }
    });
    expect(container.textContent).toContain('Accepted (2)');
    expect(container.textContent).toContain('Maybe (1)');
    expect(container.textContent).toContain('Declined (1)');
  });
});
