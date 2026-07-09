/**
 * Calendar Event Tag Building Tests (NIP-52 compliance)
 *
 * Tests buildCalendarEventTags() for correct NIP-52 tag generation:
 * - Timezone tags: start_tzid/end_tzid (not start_tz/end_tz)
 * - D tags: day-granularity tags for kind 31923
 * - Start/end format: ISO 8601 dates for kind 31922, Unix timestamps for kind 31923
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildCalendarEventTags } from '../helpers/calendar.js';

/**
 * Helper to find all tags with a given name
 * @param {string[][]} tags
 * @param {string} name
 * @returns {string[][]}
 */
function findTags(tags, name) {
  return tags.filter((t) => t[0] === name);
}

/**
 * Helper to find a single tag value
 * @param {string[][]} tags
 * @param {string} name
 * @returns {string | undefined}
 */
function findTagValue(tags, name) {
  return tags.find((t) => t[0] === name)?.[1];
}

describe('buildCalendarEventTags', () => {
  describe('timezone tags', () => {
    it('should produce start_tzid and end_tzid for kind 31923 with timezones', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        endDate: '2024-06-15',
        endTime: '16:00',
        startTimezone: 'Europe/Berlin',
        endTimezone: 'Europe/Berlin',
        eventType: 'time',
        title: 'Test Event'
      };
      const eventData = {
        kind: 31923,
        title: 'Test Event',
        start: 1718452800, // 2024-06-15T14:00:00 UTC
        end: 1718460000, // 2024-06-15T16:00:00 UTC
        startTimezone: 'Europe/Berlin',
        endTimezone: 'Europe/Berlin'
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'start_tzid')).toBe('Europe/Berlin');
      expect(findTagValue(tags, 'end_tzid')).toBe('Europe/Berlin');
      // Must NOT produce old-style start_tz/end_tz
      expect(findTags(tags, 'start_tz')).toHaveLength(0);
      expect(findTags(tags, 'end_tz')).toHaveLength(0);
    });

    it('should not produce timezone tags for kind 31923 without timezones', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        endDate: '2024-06-15',
        endTime: '16:00',
        eventType: 'time',
        title: 'Test Event'
      };
      const eventData = {
        kind: 31923,
        title: 'Test Event',
        start: 1718452800,
        end: 1718460000
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTags(tags, 'start_tzid')).toHaveLength(0);
      expect(findTags(tags, 'end_tzid')).toHaveLength(0);
      expect(findTags(tags, 'start_tz')).toHaveLength(0);
      expect(findTags(tags, 'end_tz')).toHaveLength(0);
    });

    it('should never produce timezone tags for kind 31922', () => {
      const formData = {
        startDate: '2024-06-15',
        endDate: '2024-06-16',
        eventType: 'date',
        title: 'All Day Event'
      };
      const eventData = {
        kind: 31922,
        title: 'All Day Event',
        start: 1718409600,
        end: 1718496000,
        startTimezone: 'Europe/Berlin' // should be ignored
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTags(tags, 'start_tzid')).toHaveLength(0);
      expect(findTags(tags, 'end_tzid')).toHaveLength(0);
      expect(findTags(tags, 'start_tz')).toHaveLength(0);
      expect(findTags(tags, 'end_tz')).toHaveLength(0);
    });
  });

  describe('D tags (kind 31923)', () => {
    it('should produce one D tag for a single-day time event', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        endDate: '2024-06-15',
        endTime: '16:00',
        eventType: 'time',
        title: 'Single Day'
      };
      // 2024-06-15T14:00:00 UTC = 1718452800
      // Day number = floor(1718452800 / 86400) = 19889
      const eventData = {
        kind: 31923,
        title: 'Single Day',
        start: 1718452800,
        end: 1718460000 // same day
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const dTags = findTags(tags, 'D');

      expect(dTags).toHaveLength(1);
      expect(dTags[0][1]).toBe(Math.floor(1718452800 / 86400).toString());
    });

    it('should produce multiple D tags for a multi-day time event', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '22:00',
        endDate: '2024-06-17',
        endTime: '10:00',
        eventType: 'time',
        title: 'Multi Day'
      };
      // 2024-06-15T22:00:00 UTC = 1718481600
      // 2024-06-17T10:00:00 UTC = 1718611200
      const startTs = 1718481600;
      const endTs = 1718611200;
      const startDay = Math.floor(startTs / 86400); // 19889
      const endDay = Math.floor(endTs / 86400); // 19890 (or 19891)

      const eventData = {
        kind: 31923,
        title: 'Multi Day',
        start: startTs,
        end: endTs
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const dTags = findTags(tags, 'D');

      const expectedDays = endDay - startDay + 1;
      expect(dTags).toHaveLength(expectedDays);

      // Verify sequential day numbers
      for (let i = 0; i < expectedDays; i++) {
        expect(dTags[i][1]).toBe((startDay + i).toString());
      }
    });

    it('should not produce D tags for kind 31922', () => {
      const formData = {
        startDate: '2024-06-15',
        endDate: '2024-06-16',
        eventType: 'date',
        title: 'All Day'
      };
      const eventData = {
        kind: 31922,
        title: 'All Day',
        start: 1718409600,
        end: 1718496000
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const dTags = findTags(tags, 'D');

      expect(dTags).toHaveLength(0);
    });

    it('should produce one D tag when end timestamp is not provided', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        eventType: 'time',
        title: 'No End'
      };
      const eventData = {
        kind: 31923,
        title: 'No End',
        start: 1718452800
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const dTags = findTags(tags, 'D');

      expect(dTags).toHaveLength(1);
      expect(dTags[0][1]).toBe(Math.floor(1718452800 / 86400).toString());
    });
  });

  describe('start/end format', () => {
    it('should use ISO 8601 date strings for kind 31922 start', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Date Event'
      };
      const eventData = {
        kind: 31922,
        title: 'Date Event',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'start')).toBe('2024-06-15');
    });

    it('should use ISO 8601 date strings for kind 31922 end', () => {
      const formData = {
        startDate: '2024-06-15',
        endDate: '2024-06-16',
        eventType: 'date',
        title: 'Date Event'
      };
      const eventData = {
        kind: 31922,
        title: 'Date Event',
        start: 1718409600,
        end: 1718496000
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'start')).toBe('2024-06-15');
      expect(findTagValue(tags, 'end')).toBe('2024-06-16');
    });

    it('should use Unix timestamp strings for kind 31923 start', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        eventType: 'time',
        title: 'Time Event'
      };
      const eventData = {
        kind: 31923,
        title: 'Time Event',
        start: 1718452800
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'start')).toBe('1718452800');
    });

    it('should use Unix timestamp strings for kind 31923 end', () => {
      const formData = {
        startDate: '2024-06-15',
        startTime: '14:00',
        endDate: '2024-06-15',
        endTime: '16:00',
        eventType: 'time',
        title: 'Time Event'
      };
      const eventData = {
        kind: 31923,
        title: 'Time Event',
        start: 1718452800,
        end: 1718460000
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'start')).toBe('1718452800');
      expect(findTagValue(tags, 'end')).toBe('1718460000');
    });

    it('should not include end tag when no end date/time provided', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'No End'
      };
      const eventData = {
        kind: 31922,
        title: 'No End',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTags(tags, 'end')).toHaveLength(0);
    });
  });

  describe('common tags', () => {
    it('should always include d tag', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'my-d-tag'
      );

      expect(findTagValue(tags, 'd')).toBe('my-d-tag');
    });

    it('should include h tag when provided', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'my-d-tag',
        'community-pubkey'
      );

      expect(findTagValue(tags, 'h')).toBe('community-pubkey');
    });

    it('should not include h tag when not provided', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'my-d-tag'
      );

      expect(findTags(tags, 'h')).toHaveLength(0);
    });

    it('should include title tag', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'My Event Title'
      };
      const eventData = {
        kind: 31922,
        title: 'My Event Title',
        start: 1718409600
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'title')).toBe('My Event Title');
    });

    it('should include location when present', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        location: 'Berlin, Germany'
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'location')).toBe('Berlin, Germany');
    });

    it('should include image when present', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        image: 'https://example.com/image.jpg'
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'image')).toBe('https://example.com/image.jpg');
    });

    it('should include hashtags as t tags', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        hashtags: ['nostr', 'calendar']
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const tTags = findTags(tags, 't');

      expect(tTags).toHaveLength(2);
      expect(tTags[0][1]).toBe('nostr');
      expect(tTags[1][1]).toBe('calendar');
    });

    it('should include references as r tags', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        references: ['https://example.com', 'https://nostr.com']
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const rTags = findTags(tags, 'r');

      expect(rTags).toHaveLength(2);
      expect(rTags[0][1]).toBe('https://example.com');
      expect(rTags[1][1]).toBe('https://nostr.com');
    });

    it('should include geohash as g tag', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        geohash: 'u33dc'
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );

      expect(findTagValue(tags, 'g')).toBe('u33dc');
    });

    it('should skip empty hashtags and references', () => {
      const formData = {
        startDate: '2024-06-15',
        eventType: 'date',
        title: 'Test'
      };
      const eventData = {
        kind: 31922,
        title: 'Test',
        start: 1718409600,
        hashtags: ['nostr', '', null],
        references: ['https://example.com', '', null]
      };

      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventData),
        'test-d-tag'
      );
      const tTags = findTags(tags, 't');
      const rTags = findTags(tags, 'r');

      expect(tTags).toHaveLength(1);
      expect(rTags).toHaveLength(1);
    });
  });

  describe('participant p-tags (NIP-52)', () => {
    const formBase = { startDate: '2024-06-15', eventType: 'date', title: 'Test Event' };
    const eventBase = { kind: 31922, title: 'Test Event' };
    const PK_A = 'a'.repeat(64);
    const PK_B = 'b'.repeat(64);

    it('emits ["p", pubkey, relay, role] when all fields present', () => {
      const formData = {
        ...formBase,
        participants: [{ pubkey: PK_A, relay: 'wss://relay.example.com/', role: 'speaker' }]
      };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([['p', PK_A, 'wss://relay.example.com/', 'speaker']]);
    });

    it('emits empty relay placeholder when role present without relay', () => {
      const formData = { ...formBase, participants: [{ pubkey: PK_A, role: 'organizer' }] };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([['p', PK_A, '', 'organizer']]);
    });

    it('emits short tags when relay/role missing', () => {
      const formData = {
        ...formBase,
        participants: [{ pubkey: PK_A }, { pubkey: PK_B, relay: 'wss://r.example/' }]
      };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([
        ['p', PK_A],
        ['p', PK_B, 'wss://r.example/']
      ]);
    });

    it('skips entries without pubkey and emits nothing when participants absent', () => {
      const noPk = { ...formBase, participants: [{ role: 'speaker' }] };
      expect(
        findTags(
          buildCalendarEventTags(/** @type {any} */ (noPk), /** @type {any} */ (eventBase), 'd1'),
          'p'
        )
      ).toHaveLength(0);
      expect(
        findTags(
          buildCalendarEventTags(
            /** @type {any} */ (formBase),
            /** @type {any} */ (eventBase),
            'd1'
          ),
          'p'
        )
      ).toHaveLength(0);
    });

    it('round-trips through getCalendarEventMetadata', async () => {
      const { getCalendarEventMetadata } = await import('../helpers/eventUtils.js');
      const participants = [
        { pubkey: PK_A, relay: 'wss://relay.example.com/', role: 'speaker' },
        { pubkey: PK_B, relay: undefined, role: undefined }
      ];
      const tags = buildCalendarEventTags(
        /** @type {any} */ ({ ...formBase, participants }),
        /** @type {any} */ (eventBase),
        'd1'
      );
      const rawEvent = {
        id: 'e1',
        pubkey: 'c'.repeat(64),
        kind: 31922,
        content: '',
        created_at: 1718452800,
        tags
      };
      const parsed = getCalendarEventMetadata(/** @type {any} */ (rawEvent));
      expect(parsed.participants).toEqual(participants);
    });
  });
});
