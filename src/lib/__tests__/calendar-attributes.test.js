/**
 * Educational calendar event attributes (NIP-52-Edufeed, issue #13):
 * registrationRequired, price, eventAttendanceMode, educationalLevel triples.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  parseCalendarEventAttributes,
  buildCalendarEventAttributeTags,
  getPriceKind,
  hasEventAttributes,
  ATTENDANCE_MODE_URIS
} from '../helpers/calendar-attributes.js';
import { buildCalendarEventTags, convertFormDataToEvent } from '../helpers/calendar.js';
import { getCalendarEventMetadata } from '../helpers/eventUtils.js';
import { buildMeetingTags } from '../groups/meetings.js';

const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';
const LEVEL_B = 'https://w3id.org/kim/educationalLevel/level_B';

/** The issue-#13 worked example's extension tags. */
const EXAMPLE_TAGS = [
  ['registrationRequired', 'true'],
  ['price', '0', 'EUR'],
  ['eventAttendanceMode', 'https://schema.org/OnlineEventAttendanceMode'],
  ['educationalLevel:id', LEVEL_C],
  ['educationalLevel:prefLabel:de', 'Fortbildung'],
  ['educationalLevel:type', 'Concept'],
  ['educationalLevel:id', LEVEL_B],
  ['educationalLevel:prefLabel:de', 'Vorbereitungsdienst'],
  ['educationalLevel:type', 'Concept']
];

describe('parseCalendarEventAttributes', () => {
  it('parses the worked example', () => {
    expect(parseCalendarEventAttributes(EXAMPLE_TAGS)).toEqual({
      registrationRequired: true,
      price: { amount: '0', currency: 'EUR' },
      attendanceMode: 'online',
      educationalLevels: [
        { id: LEVEL_C, labels: { de: 'Fortbildung' } },
        { id: LEVEL_B, labels: { de: 'Vorbereitungsdienst' } }
      ]
    });
  });

  it('absent tags mean no statement', () => {
    expect(parseCalendarEventAttributes([['title', 'x']])).toEqual({ educationalLevels: [] });
  });

  it('registrationRequired false is a statement, other values are ignored', () => {
    expect(parseCalendarEventAttributes([['registrationRequired', 'false']])).toMatchObject({
      registrationRequired: false
    });
    expect(
      parseCalendarEventAttributes([['registrationRequired', 'yes']]).registrationRequired
    ).toBeUndefined();
  });

  it('empty or invalid price amount means no statement', () => {
    expect(parseCalendarEventAttributes([['price', '', 'EUR']]).price).toBeUndefined();
    expect(parseCalendarEventAttributes([['price', 'free', 'EUR']]).price).toBeUndefined();
    expect(parseCalendarEventAttributes([['price', '-5', 'EUR']]).price).toBeUndefined();
  });

  it('parses a paid price and tolerates a decimal comma', () => {
    expect(parseCalendarEventAttributes([['price', '25', 'EUR']]).price).toEqual({
      amount: '25',
      currency: 'EUR'
    });
    expect(parseCalendarEventAttributes([['price', '12,50', 'eur']]).price).toEqual({
      amount: '12.50',
      currency: 'EUR'
    });
  });

  it('maps all three attendance modes and tolerates http/bare terms', () => {
    for (const [mode, uri] of Object.entries(ATTENDANCE_MODE_URIS)) {
      expect(parseCalendarEventAttributes([['eventAttendanceMode', uri]]).attendanceMode).toBe(
        mode
      );
    }
    expect(
      parseCalendarEventAttributes([
        ['eventAttendanceMode', 'http://schema.org/MixedEventAttendanceMode']
      ]).attendanceMode
    ).toBe('mixed');
    expect(
      parseCalendarEventAttributes([['eventAttendanceMode', 'OfflineEventAttendanceMode']])
        .attendanceMode
    ).toBe('offline');
    expect(
      parseCalendarEventAttributes([['eventAttendanceMode', 'https://schema.org/Nope']])
        .attendanceMode
    ).toBeUndefined();
  });

  it('collects labels in several languages and dedupes repeated concepts', () => {
    const attrs = parseCalendarEventAttributes([
      ['educationalLevel:id', LEVEL_C],
      ['educationalLevel:prefLabel:de', 'Fortbildung'],
      ['educationalLevel:prefLabel:en', 'Advanced training'],
      ['educationalLevel:type', 'Concept'],
      ['educationalLevel:id', LEVEL_C],
      ['educationalLevel:prefLabel:de', 'Fortbildung'],
      ['educationalLevel:type', 'Concept']
    ]);
    expect(attrs.educationalLevels).toEqual([
      { id: LEVEL_C, labels: { de: 'Fortbildung', en: 'Advanced training' } }
    ]);
  });
});

describe('buildCalendarEventAttributeTags', () => {
  it('writes nothing for no statements', () => {
    expect(buildCalendarEventAttributeTags(undefined)).toEqual([]);
    expect(buildCalendarEventAttributeTags({ educationalLevels: [] })).toEqual([]);
    expect(
      buildCalendarEventAttributeTags({
        price: { amount: '', currency: 'EUR' },
        educationalLevels: []
      })
    ).toEqual([]);
  });

  it('writes price 0 for free events', () => {
    expect(
      buildCalendarEventAttributeTags({
        price: { amount: '0', currency: 'EUR' },
        educationalLevels: []
      })
    ).toEqual([['price', '0', 'EUR']]);
  });

  it('writes registrationRequired false', () => {
    expect(
      buildCalendarEventAttributeTags({ registrationRequired: false, educationalLevels: [] })
    ).toEqual([['registrationRequired', 'false']]);
  });

  it('round-trips the worked example unchanged', () => {
    const attrs = parseCalendarEventAttributes(EXAMPLE_TAGS);
    expect(buildCalendarEventAttributeTags(attrs)).toEqual(EXAMPLE_TAGS);
  });

  it('writes one triple per educational level, German label first', () => {
    const tags = buildCalendarEventAttributeTags({
      educationalLevels: [
        { id: LEVEL_C, labels: { en: 'Advanced training', de: 'Fortbildung' } },
        { id: LEVEL_B, labels: { de: 'Vorbereitungsdienst' } }
      ]
    });
    expect(tags).toEqual([
      ['educationalLevel:id', LEVEL_C],
      ['educationalLevel:prefLabel:de', 'Fortbildung'],
      ['educationalLevel:prefLabel:en', 'Advanced training'],
      ['educationalLevel:type', 'Concept'],
      ['educationalLevel:id', LEVEL_B],
      ['educationalLevel:prefLabel:de', 'Vorbereitungsdienst'],
      ['educationalLevel:type', 'Concept']
    ]);
  });
});

describe('getPriceKind / hasEventAttributes', () => {
  it('classifies prices', () => {
    expect(getPriceKind(undefined)).toBeUndefined();
    expect(getPriceKind({ amount: '', currency: 'EUR' })).toBeUndefined();
    expect(getPriceKind({ amount: '0', currency: 'EUR' })).toBe('free');
    expect(getPriceKind({ amount: '0.00', currency: 'EUR' })).toBe('free');
    expect(getPriceKind({ amount: '25', currency: 'EUR' })).toBe('paid');
  });

  it('detects whether any attribute is set', () => {
    expect(hasEventAttributes({ educationalLevels: [] })).toBe(false);
    expect(hasEventAttributes({ registrationRequired: false, educationalLevels: [] })).toBe(true);
  });
});

describe('calendar event integration', () => {
  const baseForm = {
    title: 'Fortbildung',
    summary: '',
    image: '',
    startDate: '2026-09-15',
    startTime: '10:00',
    endDate: '',
    endTime: '',
    startTimezone: 'Europe/Berlin',
    endTimezone: 'Europe/Berlin',
    location: '',
    isAllDay: true,
    eventType: /** @type {const} */ ('date')
  };

  it('buildCalendarEventTags appends the attribute tags', () => {
    const formData = { ...baseForm, attributes: parseCalendarEventAttributes(EXAMPLE_TAGS) };
    const tags = buildCalendarEventTags(formData, convertFormDataToEvent(formData, ''), 'd1');
    for (const tag of EXAMPLE_TAGS) expect(tags).toContainEqual(tag);
  });

  it('buildCalendarEventTags writes no attribute tags without attributes', () => {
    const tags = buildCalendarEventTags(baseForm, convertFormDataToEvent(baseForm, ''), 'd1');
    const names = tags.map((t) => t[0]);
    expect(names).not.toContain('price');
    expect(names).not.toContain('registrationRequired');
    expect(names).not.toContain('eventAttendanceMode');
    expect(names.some((n) => n.startsWith('educationalLevel:'))).toBe(false);
  });

  it('getCalendarEventMetadata exposes attributes; edit round-trip keeps the tags', () => {
    const event = {
      id: 'e1',
      pubkey: 'a'.repeat(64),
      kind: 31922,
      created_at: 1,
      content: '',
      tags: [['d', 'd1'], ['title', 'T'], ['start', '2026-09-15'], ...EXAMPLE_TAGS]
    };
    const meta = getCalendarEventMetadata(event);
    expect(meta.attributes?.attendanceMode).toBe('online');
    expect(meta.attributes?.educationalLevels).toHaveLength(2);

    // What the edit form does: prefill attributes from the metadata, rebuild.
    const formData = { ...baseForm, attributes: meta.attributes };
    const rebuilt = buildCalendarEventTags(formData, convertFormDataToEvent(formData, ''), 'd1');
    const rebuiltExt = rebuilt.filter(
      (t) =>
        ['registrationRequired', 'price', 'eventAttendanceMode'].includes(t[0]) ||
        t[0].startsWith('educationalLevel:')
    );
    expect(rebuiltExt).toEqual(EXAMPLE_TAGS);
  });

  it('channel meetings carry no attribute tags even if form data had them', () => {
    const formData = {
      ...baseForm,
      isAllDay: false,
      eventType: /** @type {const} */ ('time'),
      endDate: '2026-09-15',
      endTime: '11:00',
      attributes: parseCalendarEventAttributes(EXAMPLE_TAGS)
    };
    const tags = buildMeetingTags(formData, {
      groupId: 'g1',
      dTag: 'm1',
      channelUrl: 'https://app.example/c/x'
    });
    expect(tags.map((t) => t[0])).not.toContain('price');
  });
});
