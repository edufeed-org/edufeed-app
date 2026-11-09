/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { publishImportedEvents } from '../import/publish-imported.js';

/** @param {string} key */
const row = (key) => ({
  key,
  dTag: key,
  title: `T ${key}`,
  startDate: '2026-12-01',
  endDate: '2026-12-01',
  startTime: '19:00',
  allDay: false,
  kind: 31923,
  description: 'desc'
});

describe('publishImportedEvents', () => {
  it('publishes sequentially, collects ok and failed, and drops descriptions when off', async () => {
    /** @type {string[]} */
    const log = [];
    const createEvent = vi.fn(async (/** @type {any} */ form, _c, _e, /** @type {any} */ opts) => {
      log.push(`start ${opts.dTag}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`end ${opts.dTag}`);
      if (opts.dTag === 'b') throw new Error('publish_failed');
      return form;
    });
    const onProgress = vi.fn();
    const result = await publishImportedEvents([row('a'), row('b'), row('c')], {
      createEvent,
      withDescriptions: false,
      tz: 'Europe/Berlin',
      onProgress
    });
    expect(result.ok).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ key: 'b', error: 'publish_failed' }]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(onProgress).toHaveBeenLastCalledWith(3);
    const [form, communities, communityEvent, opts] = createEvent.mock.calls[0];
    expect(form).toMatchObject({
      summary: '',
      startTimezone: 'Europe/Berlin',
      eventType: 'time',
      isAllDay: false,
      endTime: '',
      location: '',
      image: ''
    });
    expect(communities).toEqual([]);
    expect(communityEvent).toBeNull();
    expect(opts).toEqual({ dTag: 'a', awaitPublish: true });
  });

  it('keeps descriptions when asked', async () => {
    const createEvent = vi.fn(async () => ({}));
    await publishImportedEvents([row('a')], { createEvent, withDescriptions: true, tz: 'UTC' });
    expect(/** @type {any} */ (createEvent.mock.calls[0])[0].summary).toBe('desc');
  });
});
