/**
 * InlineRsvp: the status buttons must stay readable regardless of what surface
 * they sit on (e.g. a teal DM chat bubble) — unselected buttons need an opaque
 * background instead of the transparent btn-outline style, and the selected
 * status keeps its solid colored style.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

// Login + RSVP state toggled per test
let mockUser = /** @type {any} */ (null);
let mockRsvps = /** @type {any[]} */ ([]);

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockUser
}));
vi.mock('$lib/stores/calendar-actions.svelte', () => ({
  useCalendarActions: () => ({ createRsvp: vi.fn() })
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (/** @type {(rsvps: any[]) => void} */ cb) => {
        cb(mockRsvps);
        return { unsubscribe() {} };
      }
    })
  }
}));
vi.mock('$lib/loaders/rsvp.js', () => ({
  calendarEventRsvpLoader: () => () => ({
    subscribe: () => ({ unsubscribe() {} })
  })
}));

import InlineRsvp from '../InlineRsvp.svelte';

const CALENDAR_EVENT = {
  id: 'ev1',
  pubkey: 'c'.repeat(64),
  kind: 31923,
  content: '',
  created_at: 1718452800,
  tags: [
    ['d', 'd1'],
    ['title', 'Test Event'],
    ['start', '1718452800']
  ]
};

const STATUS_LABELS = ['RSVP as Going', 'RSVP as Maybe', 'RSVP as Not Going'];

describe('InlineRsvp button readability', () => {
  beforeEach(() => {
    mockUser = { pubkey: 'u'.repeat(64) };
    mockRsvps = [];
  });

  it('renders unselected status buttons with an opaque background (no transparent outline)', () => {
    const { getByLabelText } = render(InlineRsvp, {
      calendarEvent: CALENDAR_EVENT,
      compact: true,
      size: 'sm'
    });

    for (const label of STATUS_LABELS) {
      const btn = getByLabelText(label);
      expect(btn.className, `${label} needs an opaque bg`).toContain('bg-base-100');
      expect(btn.className, `${label} must not be transparent`).not.toContain('btn-outline');
    }
  });

  it('keeps the solid colored style for the selected status', () => {
    mockRsvps = [
      {
        id: 'rsvp1',
        pubkey: mockUser.pubkey,
        kind: 31925,
        created_at: 1718452900,
        tags: [['status', 'accepted']]
      }
    ];

    const { getByLabelText } = render(InlineRsvp, {
      calendarEvent: CALENDAR_EVENT,
      compact: true,
      size: 'sm'
    });

    const going = getByLabelText('RSVP as Going');
    expect(going.className).toContain('btn-success');
    expect(going.getAttribute('aria-pressed')).toBe('true');
  });
});
