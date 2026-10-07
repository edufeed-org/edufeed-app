/**
 * mergeFormOwnedTags — editing a calendar event must only replace the tags
 * the edit form manages. Everything else on the existing event (NIP-52
 * `summary`, `a` references, `g` geohash, NIP-32 `L`/`l` labels, other
 * clients' custom tags) survives the edit in its original order.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  mergeFormOwnedTags,
  CALENDAR_FORM_OWNED_TAGS,
  buildCalendarEventTags,
  convertFormDataToEvent
} from '../helpers/calendar.js';

describe('mergeFormOwnedTags', () => {
  it('keeps tags the form does not own, in their original order', () => {
    const existing = [
      ['d', 'ev-1'],
      ['title', 'Old'],
      ['summary', 'Short teaser'],
      ['a', '31924:abc:cal-1', 'wss://relay.example'],
      ['g', 'u1hcy'],
      ['L', 'org.rpi'],
      ['l', 'workshop', 'org.rpi'],
      ['rpi:source', 'https://rpi.example/123']
    ];
    const form = [
      ['d', 'ev-1'],
      ['title', 'New']
    ];

    expect(mergeFormOwnedTags(existing, form, ['d', 'title'])).toEqual([
      ['d', 'ev-1'],
      ['title', 'New'],
      ['summary', 'Short teaser'],
      ['a', '31924:abc:cal-1', 'wss://relay.example'],
      ['g', 'u1hcy'],
      ['L', 'org.rpi'],
      ['l', 'workshop', 'org.rpi'],
      ['rpi:source', 'https://rpi.example/123']
    ]);
  });

  it('drops owned tags the form no longer produces (removed hashtag, removed h)', () => {
    const existing = [
      ['d', 'ev-1'],
      ['h', 'community-a'],
      ['h', 'community-b'],
      ['t', 'old'],
      ['t', 'kept'],
      ['x-custom', '1']
    ];
    const form = [
      ['d', 'ev-1'],
      ['h', 'community-b'],
      ['t', 'kept']
    ];

    expect(mergeFormOwnedTags(existing, form, ['d', 'h', 't'])).toEqual([
      ['d', 'ev-1'],
      ['h', 'community-b'],
      ['t', 'kept'],
      ['x-custom', '1']
    ]);
  });

  it('treats a trailing * as a tag-name prefix', () => {
    const existing = [
      ['educationalLevel:id', 'http://old'],
      ['educationalLevel:prefLabel:de', 'Alt'],
      ['educationalLevel:type', 'Concept'],
      ['educational', 'not-a-prefix-match']
    ];

    expect(mergeFormOwnedTags(existing, [], ['educationalLevel:*'])).toEqual([
      ['educational', 'not-a-prefix-match']
    ]);
  });

  it('never duplicates a tag name the form emitted, even when not listed as owned', () => {
    const existing = [
      ['d', 'ev-1'],
      ['location', 'Old place']
    ];
    const form = [
      ['d', 'ev-1'],
      ['location', 'New place']
    ];

    expect(mergeFormOwnedTags(existing, form, [])).toEqual(form);
  });

  it('ignores malformed existing tags', () => {
    const existing = [null, [], [42, 'x'], ['ok', '1']];
    // @ts-expect-error — untrusted network input
    expect(mergeFormOwnedTags(existing, [['d', 'x']], ['d'])).toEqual([
      ['d', 'x'],
      ['ok', '1']
    ]);
  });

  it('copies kept tags instead of sharing array references', () => {
    const kept = ['summary', 'Teaser'];
    const result = mergeFormOwnedTags([kept], [], []);
    expect(result[0]).toEqual(kept);
    expect(result[0]).not.toBe(kept);
  });
});

describe('CALENDAR_FORM_OWNED_TAGS', () => {
  it('covers every tag name buildCalendarEventTags can emit from a full form', () => {
    const formData = {
      title: 'Full',
      summary: 'Body',
      image: 'https://img.example/x.png',
      startDate: '2026-07-08',
      startTime: '09:00',
      endDate: '2026-07-09',
      endTime: '10:00',
      startTimezone: 'Europe/Berlin',
      endTimezone: 'Europe/Berlin',
      location: 'Berlin',
      isAllDay: false,
      eventType: 'time',
      references: ['https://ref.example'],
      hashtags: ['tag'],
      participants: [
        { pubkey: 'a'.repeat(64), role: 'speaker' },
        { name: 'Jane', role: 'host' }
      ],
      attributes: {
        registrationRequired: true,
        price: { amount: '10', currency: 'EUR' },
        attendanceMode: 'online',
        educationalLevels: [{ id: 'http://level', labels: { de: 'Stufe' } }]
      }
    };
    const eventData = convertFormDataToEvent(/** @type {any} */ (formData), '');
    const tags = buildCalendarEventTags(/** @type {any} */ (formData), eventData, 'd-1', ['h1']);
    const names = new Set(tags.map((t) => t[0]));

    // Every emitted name is owned, so the merge drops the stale copy.
    const stale = [...names].map((n) => [n, 'stale']);
    expect(mergeFormOwnedTags(stale, [], CALENDAR_FORM_OWNED_TAGS)).toEqual([]);
  });

  it('does not own tags the form cannot edit', () => {
    const foreign = [
      ['summary', 's'],
      ['a', '31924:x:y'],
      ['g', 'u1hcy'],
      ['L', 'ns'],
      ['l', 'v', 'ns'],
      ['rpi:id', '1']
    ];
    expect(mergeFormOwnedTags(foreign, [], CALENDAR_FORM_OWNED_TAGS)).toEqual(foreign);
  });
});
