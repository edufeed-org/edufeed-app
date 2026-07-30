// @ts-nocheck
/**
 * updateEvent community (h-tag) handling tests
 *
 * Editing a calendar event must not silently change which communities it is
 * shared with: without an explicit selection every existing h-tag survives
 * the edit, and an explicit selection replaces the set (edufeed-app#8).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PK = 'a'.repeat(64);
const COMMUNITY_A = 'b'.repeat(64);
const COMMUNITY_B = 'c'.repeat(64);
const COMMUNITY_C = 'd'.repeat(64);

const signEvent = vi.fn(async (template) => ({
  ...template,
  id: 'e'.repeat(64),
  pubkey: PK,
  sig: 'f'.repeat(128)
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'a'.repeat(64), signEvent: (t) => signEvent(t) } }
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: async (t) => t })
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async () => ({ success: true, successCount: 1, relays: [] })),
  publishEventOptimistic: vi.fn(),
  buildATagWithHint: vi.fn(),
  buildETagWithHint: vi.fn(),
  buildPTagsWithHints: vi.fn()
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: {}
}));
vi.mock('$lib/stores/calendar-events.svelte.js', () => ({
  calendarStore: { events: [], setEvents: vi.fn() }
}));
vi.mock('$lib/helpers/eventUtils.js', () => ({
  getCalendarEventMetadata: vi.fn((e) => e)
}));

import { createCalendarActions } from '$lib/stores/calendar-actions.svelte.js';

const FORM_DATA = {
  title: 'Test Event',
  summary: '',
  image: '',
  startDate: '2026-07-08',
  startTime: '09:00',
  endDate: '2026-07-09',
  endTime: '10:00',
  startTimezone: 'Europe/Berlin',
  endTimezone: 'Europe/Berlin',
  location: '',
  isAllDay: true,
  eventType: 'date',
  references: []
};

function makeExistingEvent(hTags) {
  return {
    kind: 31922,
    pubkey: PK,
    id: '1'.repeat(64),
    tags: [['d', 'event-1'], ...hTags.map((h) => ['h', h]), ['title', 'Old Title']],
    content: '',
    created_at: 0,
    sig: ''
  };
}

function signedHTags() {
  const template = signEvent.mock.calls.at(-1)[0];
  return template.tags.filter((t) => t[0] === 'h').map((t) => t[1]);
}

describe('updateEvent community h-tags', () => {
  beforeEach(() => {
    signEvent.mockClear();
  });

  it('preserves ALL existing h-tags when no community selection is passed', async () => {
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, makeExistingEvent([COMMUNITY_A, COMMUNITY_B]));

    expect(signedHTags().sort()).toEqual([COMMUNITY_A, COMMUNITY_B].sort());
  });

  it('replaces the h-tag set with an explicit community selection', async () => {
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, makeExistingEvent([COMMUNITY_A]), null, [
      COMMUNITY_B,
      COMMUNITY_C
    ]);

    expect(signedHTags().sort()).toEqual([COMMUNITY_B, COMMUNITY_C].sort());
  });

  it('removes all h-tags when an explicit empty selection is passed', async () => {
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, makeExistingEvent([COMMUNITY_A]), null, []);

    expect(signedHTags()).toEqual([]);
  });
});
