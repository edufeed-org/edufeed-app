/**
 * NIP-52 lists `name` as deprecated in favor of `title`, to be used only as a
 * fallback when `title` is absent. getCalendarEventMetadata must honor that.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getCalendarEventMetadata } from '../helpers/eventUtils.js';

const PUBKEY = 'a'.repeat(64);

/** @param {string[][]} tags */
function calendarEvent(tags) {
  return {
    id: 'ev1',
    kind: 31923,
    pubkey: PUBKEY,
    content: '',
    created_at: 1000,
    tags
  };
}

describe('getCalendarEventMetadata title', () => {
  it('falls back to the deprecated `name` tag when `title` is missing', () => {
    const meta = getCalendarEventMetadata(calendarEvent([['name', 'Legacy Title']]));
    expect(meta.title).toBe('Legacy Title');
  });

  it('prefers `title` over `name` when both are present', () => {
    const meta = getCalendarEventMetadata(
      calendarEvent([
        ['title', 'Current Title'],
        ['name', 'Old Name']
      ])
    );
    expect(meta.title).toBe('Current Title');
  });

  it('falls back to "Untitled Event" when neither tag is present', () => {
    const meta = getCalendarEventMetadata(calendarEvent([]));
    expect(meta.title).toBe('Untitled Event');
  });
});
