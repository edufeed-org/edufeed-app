/** @vitest-environment node */
/**
 * NIP-101 form responses → NIP-52 calendar drafts, per the edufeed wiki
 * entry "Calendar events from forms in edufeed" (the `nip52-calendar`
 * output and its `cal:` targets).
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { parseFormTemplate, parseResponseTags } from '$lib/helpers/forms.js';
import {
  CALENDAR_OUTPUT,
  CalendarComposeError,
  isCalendarOutputTemplate,
  responseToCalendarDraft,
  calendarDraftToFormData
} from '$lib/helpers/forms/calendar-output.js';

const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';
const LEVEL_A = 'https://w3id.org/kim/educationalLevel/level_A';
const PK = '28d7ca9cba0e40f59843cd1cd507c1a912919769f4495a0f38df2b0ab0238bc4';

/** @param {string} uri */
const kimLabels = (uri) =>
  uri === LEVEL_C ? { en: 'Advanced training', de: 'Fortbildung' } : undefined;

// The wiki's worked example, verbatim: community copy …
const WORKED_COPY = {
  kind: 30168,
  pubkey: 'c'.repeat(64),
  created_at: 1,
  content: '',
  tags: [
    ['d', 'edufeed-calendar-event'],
    ['name', 'Veranstaltung vorschlagen'],
    [
      'settings',
      '{"output":"nip52-calendar","confirmationMessage":"Danke! Wir prüfen den Vorschlag."}'
    ],
    [
      'a',
      '30168:bdc21f93b1e2cb75608cecd7a0a00a779779d9367dc9798bd9f213f06c95bc48:edufeed-calendar-event',
      'wss://relay.edufeed.org',
      'forkOf'
    ],
    ['field', 'title', 'text', 'Titel', '[]', '{"renderElement":"text","required":true}'],
    ['field', 'allday', 'text', 'Ganztägig', '[]', '{"renderElement":"checkbox"}'],
    [
      'field',
      'start',
      'text',
      'Beginn',
      '[]',
      '{"renderElement":"datetime","required":true,"allDayField":"allday"}'
    ],
    ['field', 'end', 'text', 'Ende', '[]', '{"renderElement":"datetime","allDayField":"allday"}'],
    [
      'field',
      'mode',
      'option',
      'Format',
      '[["https://schema.org/OnlineEventAttendanceMode","Online"],["https://schema.org/OfflineEventAttendanceMode","Präsenz"],["https://schema.org/MixedEventAttendanceMode","Hybrid"]]',
      '{"renderElement":"radio"}'
    ],
    ['field', 'level', 'text', 'Bildungsstufe', '[]', '{"renderElement":"select","multiple":true}'],
    [
      'field',
      'speakers',
      'text',
      'Vortragende',
      '[]',
      '{"renderElement":"text-array","participantRole":"speaker"}'
    ],
    [
      'field-vocab',
      'level',
      'a',
      '39737:d2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612:educational-level',
      'wss://relay.edufeed.org'
    ],
    ['field-output', 'title', 'cal:title'],
    ['field-output', 'allday', 'cal:allDay'],
    ['field-output', 'start', 'cal:start'],
    ['field-output', 'end', 'cal:end'],
    ['field-output', 'mode', 'cal:eventAttendanceMode'],
    ['field-output', 'level', 'cal:educationalLevel'],
    ['field-output', 'speakers', 'cal:participant']
  ]
};

// … the decrypted response tags of an anonymous visitor …
const WORKED_RESPONSE = [
  ['response', 'title', 'OER-Werkstatt', '{}'],
  ['response', 'allday', 'false', '{}'],
  ['response', 'start', '2026-11-20T14:00', '{}'],
  ['response', 'end', '2026-11-20T16:00', '{}'],
  ['response', 'mode', 'https://schema.org/OnlineEventAttendanceMode', '{}'],
  ['response', 'level', LEVEL_C, '{}'],
  ['response', 'speakers', 'Jane Doe', '{}']
];

// … and the published event's tags without the publisher's d and h.
const WORKED_EVENT_TAGS = [
  ['title', 'OER-Werkstatt'],
  ['start', '1795179600'],
  ['end', '1795186800'],
  ['start_tzid', 'Europe/Berlin'],
  ['end_tzid', 'Europe/Berlin'],
  ['D', '20777'],
  ['participant', 'Jane Doe', '', 'speaker'],
  ['eventAttendanceMode', 'https://schema.org/OnlineEventAttendanceMode'],
  ['educationalLevel:id', LEVEL_C],
  ['educationalLevel:prefLabel:de', 'Fortbildung'],
  ['educationalLevel:prefLabel:en', 'Advanced training'],
  ['educationalLevel:type', 'Concept']
];

/**
 * A calendar template from [id, renderElement, cal target, extra settings].
 * @param {Array<[string, string, string, Record<string, unknown>?]>} defs
 */
function template(defs) {
  /** @type {string[][]} */
  const tags = [
    ['d', 'cal'],
    ['settings', JSON.stringify({ output: 'nip52-calendar' })]
  ];
  for (const [id, type, , extra] of defs) {
    tags.push(['field', id, 'text', id, '[]', JSON.stringify({ renderElement: type, ...extra })]);
  }
  for (const [id, , target] of defs) tags.push(['field-output', id, target]);
  return parseFormTemplate({
    kind: 30168,
    pubkey: 'c'.repeat(64),
    created_at: 1,
    content: '',
    tags
  });
}

const BASE = /** @type {Array<[string, string, string, Record<string, unknown>?]>} */ ([
  ['title', 'text', 'cal:title'],
  ['allday', 'checkbox', 'cal:allDay'],
  ['start', 'datetime', 'cal:start', { allDayField: 'allday' }],
  ['end', 'datetime', 'cal:end', { allDayField: 'allday' }]
]);

describe('responseToCalendarDraft — wiki worked example', () => {
  it('reproduces the published event tags exactly', () => {
    const form = parseFormTemplate(WORKED_COPY);
    const values = parseResponseTags(WORKED_RESPONSE, form.fields);
    const draft = responseToCalendarDraft(form, values, { conceptLabels: kimLabels });
    expect(draft).toEqual({ kind: 31923, content: '', tags: WORKED_EVENT_TAGS });
  });

  it('accepts the raw template event as well as a parsed one', () => {
    const values = parseResponseTags(WORKED_RESPONSE, parseFormTemplate(WORKED_COPY).fields);
    const draft = responseToCalendarDraft(WORKED_COPY, values, { conceptLabels: kimLabels });
    expect(draft.tags).toEqual(WORKED_EVENT_TAGS);
  });

  it('never emits d, h or client', () => {
    const form = parseFormTemplate(WORKED_COPY);
    const draft = responseToCalendarDraft(form, parseResponseTags(WORKED_RESPONSE, form.fields));
    const names = draft.tags.map((t) => t[0]);
    expect(names).not.toContain('d');
    expect(names).not.toContain('h');
    expect(names).not.toContain('client');
  });

  it('emits id and type without labels when the concept is unknown', () => {
    const form = parseFormTemplate(WORKED_COPY);
    const draft = responseToCalendarDraft(form, parseResponseTags(WORKED_RESPONSE, form.fields));
    expect(draft.tags.filter((t) => t[0].startsWith('educationalLevel'))).toEqual([
      ['educationalLevel:id', LEVEL_C],
      ['educationalLevel:type', 'Concept']
    ]);
  });
});

describe('isCalendarOutputTemplate', () => {
  it('recognises settings.output = nip52-calendar', () => {
    expect(CALENDAR_OUTPUT).toBe('nip52-calendar');
    expect(parseFormTemplate(WORKED_COPY).output).toBe('nip52-calendar');
    expect(isCalendarOutputTemplate(parseFormTemplate(WORKED_COPY))).toBe(true);
    expect(isCalendarOutputTemplate(WORKED_COPY)).toBe(true);
  });

  it('rejects AMB and plain forms', () => {
    const plain = {
      ...WORKED_COPY,
      tags: [
        ['d', 'x'],
        ['settings', '{}']
      ]
    };
    expect(parseFormTemplate(plain).output).toBe('');
    expect(isCalendarOutputTemplate(plain)).toBe(false);
    expect(isCalendarOutputTemplate(null)).toBe(false);
  });
});

describe('responseToCalendarDraft — dates and times', () => {
  const form = template(BASE);

  it('writes no end for a one-day all-day event', () => {
    for (const end of ['', '2026-12-03', undefined]) {
      const draft = responseToCalendarDraft(form, {
        title: 'Tag',
        allday: 'true',
        start: '2026-12-03',
        ...(end === undefined ? {} : { end })
      });
      expect(draft.kind).toBe(31922);
      expect(draft.tags).toEqual([
        ['title', 'Tag'],
        ['start', '2026-12-03']
      ]);
    }
  });

  it('writes the exclusive end (last day + 1) for a multi-day all-day event', () => {
    const draft = responseToCalendarDraft(form, {
      title: 'Camp',
      allday: 'true',
      start: '2026-12-31',
      end: '2027-01-02'
    });
    expect(draft.tags).toEqual([
      ['title', 'Camp'],
      ['start', '2026-12-31'],
      ['end', '2027-01-03']
    ]);
  });

  it('rejects an all-day end before the start', () => {
    expect(() =>
      responseToCalendarDraft(form, {
        title: 'X',
        allday: 'true',
        start: '2026-12-03',
        end: '2026-12-02'
      })
    ).toThrow(CalendarComposeError);
  });

  it('rejects dates that are not real days', () => {
    expect(() =>
      responseToCalendarDraft(form, { title: 'X', allday: 'true', start: '2026-02-31' })
    ).toThrow(CalendarComposeError);
    expect(() =>
      responseToCalendarDraft(form, { title: 'X', allday: 'false', start: '2026-12-03' })
    ).toThrow(CalendarComposeError);
  });

  it('reads timed answers in the default Europe/Berlin zone (summer and winter)', () => {
    const summer = responseToCalendarDraft(form, {
      title: 'S',
      allday: 'false',
      start: '2026-07-01T10:00'
    });
    expect(summer.tags).toEqual([
      ['title', 'S'],
      ['start', String(Date.UTC(2026, 6, 1, 8) / 1000)],
      ['start_tzid', 'Europe/Berlin'],
      ['D', String(Math.floor(Date.UTC(2026, 6, 1, 8) / 86400000))]
    ]);
  });

  it('uses the cal:tzid answer and writes one D per day covered', () => {
    const withTz = template([...BASE, ['tz', 'text', 'cal:tzid']]);
    const draft = responseToCalendarDraft(withTz, {
      title: 'NY',
      allday: 'false',
      start: '2026-11-20T23:00',
      end: '2026-11-21T01:30',
      tz: 'America/New_York'
    });
    const start = Date.UTC(2026, 10, 21, 4) / 1000;
    const end = Date.UTC(2026, 10, 21, 6, 30) / 1000;
    expect(draft.tags).toEqual([
      ['title', 'NY'],
      ['start', String(start)],
      ['end', String(end)],
      ['start_tzid', 'America/New_York'],
      ['end_tzid', 'America/New_York'],
      ['D', String(Math.floor(start / 86400))]
    ]);
  });

  it('rejects an unknown time zone', () => {
    const withTz = template([...BASE, ['tz', 'text', 'cal:tzid']]);
    expect(() =>
      responseToCalendarDraft(withTz, {
        title: 'X',
        allday: 'false',
        start: '2026-11-20T10:00',
        tz: 'Mars/Olympus'
      })
    ).toThrow(CalendarComposeError);
  });

  it('drops an end equal to the start and rejects one before it', () => {
    const same = responseToCalendarDraft(form, {
      title: 'X',
      allday: 'false',
      start: '2026-11-20T10:00',
      end: '2026-11-20T10:00'
    });
    expect(same.tags.map((t) => t[0])).toEqual(['title', 'start', 'start_tzid', 'D']);
    expect(() =>
      responseToCalendarDraft(form, {
        title: 'X',
        allday: 'false',
        start: '2026-11-20T10:00',
        end: '2026-11-20T09:00'
      })
    ).toThrow(CalendarComposeError);
  });

  it('requires a title and a start, naming the field', () => {
    try {
      responseToCalendarDraft(form, { title: ' ', allday: 'false', start: '2026-11-20T10:00' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarComposeError);
      expect(/** @type {CalendarComposeError} */ (err).fieldId).toBe('title');
    }
    try {
      responseToCalendarDraft(form, { title: 'T', allday: 'false', start: '' });
      expect.unreachable();
    } catch (err) {
      expect(/** @type {CalendarComposeError} */ (err).fieldId).toBe('start');
    }
  });
});

describe('responseToCalendarDraft — other targets', () => {
  const full = template([
    ...BASE,
    ['description', 'textarea', 'cal:content'],
    ['location', 'text', 'cal:location'],
    ['image', 'url', 'cal:image'],
    ['hashtags', 'text-array', 'cal:t'],
    ['links', 'text-array', 'cal:r'],
    ['speakers', 'text-array', 'cal:participant', { participantRole: 'speaker' }],
    ['organizers', 'text-array', 'cal:participant', { participantRole: 'organizer' }],
    ['guests', 'text-array', 'cal:participant'],
    ['registration', 'radio', 'cal:registrationRequired'],
    ['price', 'number', 'cal:price'],
    ['currency', 'text', 'cal:currency'],
    ['mode', 'radio', 'cal:eventAttendanceMode'],
    ['level', 'select', 'cal:educationalLevel', { multiple: true }],
    ['notes', 'textarea', 'amb:description']
  ]);
  const base = { title: 'Camp', allday: 'true', start: '2026-12-03' };

  it('emits every target in the calendar tag order', () => {
    const npub = nip19.npubEncode(PK);
    const draft = responseToCalendarDraft(
      full,
      {
        ...base,
        end: '2026-12-04',
        description: 'Zwei **Tage**',
        location: 'Bibliothek',
        image: 'https://example.org/camp.png',
        hashtags: ['#oer', 'barcamp', ' '],
        links: ['https://example.org/a', 'https://example.org/b'],
        speakers: [npub, 'Jane Doe'],
        organizers: ['Max Muster', 'Jane Doe', PK.toUpperCase()],
        guests: ['Gast'],
        registration: 'true',
        price: '12,50',
        currency: 'eur',
        mode: 'https://schema.org/OfflineEventAttendanceMode',
        level: [LEVEL_C, LEVEL_A, LEVEL_C],
        notes: 'not for the event'
      },
      { conceptLabels: kimLabels }
    );
    expect(draft.kind).toBe(31922);
    expect(draft.content).toBe('Zwei **Tage**');
    expect(draft.tags).toEqual([
      ['title', 'Camp'],
      ['start', '2026-12-03'],
      ['end', '2026-12-05'],
      ['image', 'https://example.org/camp.png'],
      ['location', 'Bibliothek'],
      ['t', 'oer'],
      ['t', 'barcamp'],
      ['r', 'https://example.org/a'],
      ['r', 'https://example.org/b'],
      ['p', PK, '', 'speaker'],
      ['participant', 'Jane Doe', '', 'speaker'],
      ['participant', 'Max Muster', '', 'organizer'],
      ['participant', 'Gast'],
      ['registrationRequired', 'true'],
      ['price', '12.50', 'EUR'],
      ['eventAttendanceMode', 'https://schema.org/OfflineEventAttendanceMode'],
      ['educationalLevel:id', LEVEL_C],
      ['educationalLevel:prefLabel:de', 'Fortbildung'],
      ['educationalLevel:prefLabel:en', 'Advanced training'],
      ['educationalLevel:type', 'Concept'],
      ['educationalLevel:id', LEVEL_A],
      ['educationalLevel:type', 'Concept']
    ]);
  });

  it('reads an nprofile relay hint into the p tag and rejects a broken npub', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: PK, relays: ['wss://relay.example'] });
    const draft = responseToCalendarDraft(full, { ...base, speakers: [nprofile] });
    expect(draft.tags.find((t) => t[0] === 'p')).toEqual([
      'p',
      PK,
      'wss://relay.example',
      'speaker'
    ]);
    expect(() => responseToCalendarDraft(full, { ...base, speakers: ['npub1broken'] })).toThrow(
      CalendarComposeError
    );
  });

  it('treats no answer as no statement', () => {
    const draft = responseToCalendarDraft(full, {
      ...base,
      registration: '',
      price: 'gratis',
      currency: 'EUR',
      mode: 'irgendwie',
      level: []
    });
    expect(draft.tags).toEqual([
      ['title', 'Camp'],
      ['start', '2026-12-03']
    ]);
  });

  it('defaults the currency to EUR and rejects a non-ISO one', () => {
    const draft = responseToCalendarDraft(full, { ...base, price: '0' });
    expect(draft.tags.find((t) => t[0] === 'price')).toEqual(['price', '0', 'EUR']);
    expect(() => responseToCalendarDraft(full, { ...base, price: '5', currency: 'Euro' })).toThrow(
      CalendarComposeError
    );
  });

  it('accepts http:// and bare schema.org attendance modes', () => {
    for (const mode of ['http://schema.org/MixedEventAttendanceMode', 'MixedEventAttendanceMode']) {
      const draft = responseToCalendarDraft(full, { ...base, mode });
      expect(draft.tags.find((t) => t[0] === 'eventAttendanceMode')).toEqual([
        'eventAttendanceMode',
        'https://schema.org/MixedEventAttendanceMode'
      ]);
    }
  });

  it('lets the first field win for every target but cal:participant', () => {
    const twoTitles = template([['title2', 'text', 'cal:title'], ...BASE]);
    const draft = responseToCalendarDraft(twoTitles, {
      title2: 'Erster',
      title: 'Zweiter',
      allday: 'true',
      start: '2026-12-03'
    });
    expect(draft.tags[0]).toEqual(['title', 'Erster']);
  });

  it('reads ;-joined strings like split arrays', () => {
    const draft = responseToCalendarDraft(full, { ...base, hashtags: 'a;b;;c' });
    expect(draft.tags.filter((t) => t[0] === 't')).toEqual([
      ['t', 'a'],
      ['t', 'b'],
      ['t', 'c']
    ]);
  });
});

describe('calendarDraftToFormData — prefill for CalendarEventModal', () => {
  it('maps a multi-day all-day draft back to its inclusive last day', () => {
    const form = calendarDraftToFormData({
      kind: 31922,
      content: 'Beschreibung',
      tags: [
        ['title', 'Camp'],
        ['start', '2026-12-31'],
        ['end', '2027-01-03'],
        ['image', 'https://example.org/i.png'],
        ['location', 'Bibliothek'],
        ['t', 'oer'],
        ['r', 'https://example.org/a'],
        ['p', PK, 'wss://relay.example', 'speaker'],
        ['participant', 'Jane Doe', '', 'organizer'],
        ['participant', 'Gast'],
        ['registrationRequired', 'false'],
        ['price', '12.50', 'EUR'],
        ['eventAttendanceMode', 'https://schema.org/MixedEventAttendanceMode'],
        ['educationalLevel:id', LEVEL_C],
        ['educationalLevel:prefLabel:de', 'Fortbildung'],
        ['educationalLevel:type', 'Concept']
      ]
    });
    expect(form).toMatchObject({
      title: 'Camp',
      summary: 'Beschreibung',
      image: 'https://example.org/i.png',
      location: 'Bibliothek',
      isAllDay: true,
      eventType: 'date',
      startDate: '2026-12-31',
      endDate: '2027-01-02',
      hashtags: ['oer'],
      references: ['https://example.org/a'],
      participants: [
        { pubkey: PK, relay: 'wss://relay.example', role: 'speaker' },
        { name: 'Jane Doe', role: 'organizer' },
        { name: 'Gast' }
      ],
      attributes: {
        registrationRequired: false,
        price: { amount: '12.50', currency: 'EUR' },
        attendanceMode: 'mixed',
        educationalLevels: [{ id: LEVEL_C, labels: { de: 'Fortbildung' } }]
      }
    });
  });

  it('shows a one-day all-day draft as ending on its start day', () => {
    const form = calendarDraftToFormData({
      kind: 31922,
      content: '',
      tags: [
        ['title', 'Tag'],
        ['start', '2026-12-03']
      ]
    });
    expect(form.startDate).toBe('2026-12-03');
    expect(form.endDate).toBe('2026-12-03');
  });

  it('maps a timed draft to local wall-clock fields that convert back to the same instant', () => {
    const form = calendarDraftToFormData({ kind: 31923, content: '', tags: WORKED_EVENT_TAGS });
    expect(form.isAllDay).toBe(false);
    expect(form.eventType).toBe('time');
    expect(form.startTimezone).toBe('Europe/Berlin');
    expect(form.endTimezone).toBe('Europe/Berlin');
    expect(new Date(`${form.startDate}T${form.startTime}`).getTime() / 1000).toBe(1795179600);
    expect(new Date(`${form.endDate}T${form.endTime}`).getTime() / 1000).toBe(1795186800);
    expect(form.participants).toEqual([{ name: 'Jane Doe', role: 'speaker' }]);
    expect(form.attributes.educationalLevels).toEqual([
      { id: LEVEL_C, labels: { de: 'Fortbildung', en: 'Advanced training' } }
    ]);
  });
});
