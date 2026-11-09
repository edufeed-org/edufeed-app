// @ts-nocheck
/**
 * createEvent's 4th options arg (Termi file import): a stable `dTag` and
 * `awaitPublish`, which waits for the relays and rejects when none accepted.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishEvent = vi.fn(async () => ({ success: true }));
const publishEventOptimistic = vi.fn();

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'a'.repeat(64), signEvent: async (t) => ({ ...t, id: 'e'.repeat(64) }) }
  }
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: async (t) => t })
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (...a) => publishEvent(...a),
  publishEventOptimistic: (...a) => publishEventOptimistic(...a),
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
vi.mock('$lib/helpers/eventUtils.js', () => ({ getCalendarEventMetadata: vi.fn((e) => e) }));

import { createCalendarActions } from '$lib/stores/calendar-actions.svelte.js';

const FORM = {
  title: 'Elternabend',
  summary: '',
  image: '',
  startDate: '2026-12-01',
  startTime: '',
  endDate: '2026-12-01',
  endTime: '',
  startTimezone: 'Europe/Berlin',
  endTimezone: 'Europe/Berlin',
  location: '',
  isAllDay: true,
  eventType: 'date'
};

const dOf = (ev) => ev.tags.find((t) => t[0] === 'd')[1];

describe('createEvent options', () => {
  beforeEach(() => {
    publishEvent.mockClear();
    publishEventOptimistic.mockClear();
  });

  it('uses the given dTag', async () => {
    const ev = await createCalendarActions('').createEvent(FORM, [], null, { dTag: 'import-abc' });
    expect(dOf(ev)).toBe('import-abc');
    expect(publishEventOptimistic).toHaveBeenCalledTimes(1);
  });

  it('generates event-… by default', async () => {
    const ev = await createCalendarActions('').createEvent(FORM, []);
    expect(dOf(ev)).toMatch(/^event-/);
  });

  it('awaitPublish resolves on success and rejects on failure', async () => {
    const actions = createCalendarActions('');
    await expect(actions.createEvent(FORM, [], null, { awaitPublish: true })).resolves.toBeTruthy();
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEventOptimistic).not.toHaveBeenCalled();
    publishEvent.mockResolvedValueOnce({ success: false });
    await expect(actions.createEvent(FORM, [], null, { awaitPublish: true })).rejects.toThrow(
      'publish_failed'
    );
  });
});
