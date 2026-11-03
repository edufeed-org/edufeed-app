/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { generateICSContent } from '$lib/server/calendar-ics.js';

const PUBKEY = 'a'.repeat(64);
const BASE_URL = new URL('https://edufeed.app/calendar/mine');

/**
 * @param {Partial<import('nostr-tools').NostrEvent>} [overrides]
 * @returns {import('nostr-tools').NostrEvent}
 */
function timedEvent(overrides = {}) {
  return {
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    content: '',
    sig: '',
    tags: [
      ['d', 'my-event'],
      ['title', 'My Event'],
      ['start', '1700003600']
    ],
    ...overrides
  };
}

/**
 * Split a folded ICS body back into logical (unfolded) content lines.
 * @param {string} ics
 * @returns {string[]}
 */
function unfoldLines(ics) {
  const physical = ics.split('\r\n');
  const logical = [];
  for (const line of physical) {
    if (line.startsWith(' ') && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

describe('generateICSContent', () => {
  it('uses event.content as DESCRIPTION when there is no summary tag', () => {
    const event = timedEvent({ content: 'Agenda' });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    const lines = unfoldLines(ics);
    expect(lines).toContain('DESCRIPTION:Agenda');
  });

  it('falls back to the summary tag when content is empty', () => {
    const event = timedEvent({ content: '', tags: [...timedEvent().tags, ['summary', 'Brief']] });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    const lines = unfoldLines(ics);
    expect(lines).toContain('DESCRIPTION:Brief');
  });

  it('prefers content over summary when both are present', () => {
    const event = timedEvent({
      content: 'Full description',
      tags: [...timedEvent().tags, ['summary', 'Brief']]
    });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    const lines = unfoldLines(ics);
    expect(lines).toContain('DESCRIPTION:Full description');
    expect(lines).not.toContain('DESCRIPTION:Brief');
  });

  it('gives two revisions of one address the same UID', () => {
    const v1 = timedEvent({ id: '1'.repeat(64), created_at: 1_700_000_000, content: 'v1' });
    const v2 = timedEvent({ id: '2'.repeat(64), created_at: 1_700_001_000, content: 'v2' });

    const icsV1 = generateICSContent({ title: '', summary: '' }, [v1], BASE_URL);
    const icsV2 = generateICSContent({ title: '', summary: '' }, [v2], BASE_URL);

    const uidOf = (/** @type {string} */ ics) => unfoldLines(ics).find((l) => l.startsWith('UID:'));
    expect(uidOf(icsV1)).toBeDefined();
    expect(uidOf(icsV1)).toBe(uidOf(icsV2));
    // Stable across edits, but not simply the (changing) event id.
    expect(uidOf(icsV1)).not.toContain(v1.id);
  });

  it('gives events at different addresses different UIDs', () => {
    const a = timedEvent({
      id: '1'.repeat(64),
      tags: [
        ['d', 'event-a'],
        ['title', 'A'],
        ['start', '1700003600']
      ]
    });
    const b = timedEvent({
      id: '2'.repeat(64),
      tags: [
        ['d', 'event-b'],
        ['title', 'B'],
        ['start', '1700003600']
      ]
    });

    const uidOf = (/** @type {string} */ ics) => unfoldLines(ics).find((l) => l.startsWith('UID:'));
    const icsA = generateICSContent({ title: '', summary: '' }, [a], BASE_URL);
    const icsB = generateICSContent({ title: '', summary: '' }, [b], BASE_URL);
    expect(uidOf(icsA)).not.toBe(uidOf(icsB));
  });

  it('bumps SEQUENCE on a later revision, from created_at', () => {
    const event = timedEvent({ created_at: 1_700_050_000 });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    expect(unfoldLines(ics)).toContain('SEQUENCE:1700050000');
  });

  it('folds a long DESCRIPTION line at 75 octets per physical line', () => {
    const longContent = 'This is a very long event description. '.repeat(10);
    const event = timedEvent({ content: longContent });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);

    const physicalLines = ics.split('\r\n');
    const encoder = new TextEncoder();
    for (const line of physicalLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }

    // And it reassembles losslessly.
    const unfolded = unfoldLines(ics).find((l) => l.startsWith('DESCRIPTION:'));
    expect(unfolded).toBe(`DESCRIPTION:${longContent}`);
  });

  it('omits DTEND for a time-based (31923) event with no end tag', () => {
    const event = timedEvent();
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    expect(ics).not.toContain('DTEND');
  });

  it('uses the deprecated `name` tag as SUMMARY when there is no title', () => {
    const event = timedEvent({
      tags: [
        ['d', 'my-event'],
        ['name', 'Legacy Name'],
        ['start', '1700003600']
      ]
    });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    expect(unfoldLines(ics)).toContain('SUMMARY:Legacy Name');
  });

  it('prefers title over name when both are present', () => {
    const event = timedEvent({
      tags: [
        ['d', 'my-event'],
        ['title', 'Current Title'],
        ['name', 'Legacy Name'],
        ['start', '1700003600']
      ]
    });
    const ics = generateICSContent({ title: '', summary: '' }, [event], BASE_URL);
    const lines = unfoldLines(ics);
    expect(lines).toContain('SUMMARY:Current Title');
    expect(lines).not.toContain('SUMMARY:Legacy Name');
  });
});
