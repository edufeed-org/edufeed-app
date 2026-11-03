/**
 * Calendar rename must keep relay hints and foreign tags of the 31924 list.
 *
 * NIP-52 (31924): "a" (repeated) reference tag to a 31922/31923 calendar
 * event, optionally carrying a relay hint:
 *   ["a", "<31922 or 31923>:<pubkey>:<d>", "<optional relay url>"]
 *
 * The rename path used to rebuild the tag array from scratch (`d`, `title`,
 * and a bare `['a', ref]` per reference), which dropped relay hints and any
 * other tag a different client had put on the calendar (e.g. `image`).
 * Adding/removing events already went through applesauce's CalendarFactory
 * and kept everything — only the rename path was affected.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { createAppEventFactory } from '../event-factory.js';
import { buildCalendarRenameTemplate } from '../calendar-rename.js';

const PUBKEY = 'a'.repeat(64);

const ORIGINAL_EVENT = {
  id: '1'.repeat(64),
  pubkey: PUBKEY,
  kind: 31924,
  created_at: 1700000000,
  content: 'Old description',
  tags: [
    ['d', 'my-calendar'],
    ['title', 'Old Title'],
    ['a', `31923:${PUBKEY}:some-event`, 'wss://relay.example.com'],
    ['image', 'https://example.com/calendar.png'],
    ['t', 'oer'],
    ['summary', 'A short summary']
  ],
  sig: 'deadbeef'
};

describe('buildCalendarRenameTemplate', () => {
  it('keeps the relay hint on the "a" tag', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    const aTag = template.tags.find((/** @type {any[]} */ t) => t[0] === 'a');
    expect(aTag).toEqual(['a', `31923:${PUBKEY}:some-event`, 'wss://relay.example.com']);
  });

  it('keeps foreign tags another client added (image, t, summary)', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    expect(template.tags).toContainEqual(['image', 'https://example.com/calendar.png']);
    expect(template.tags).toContainEqual(['t', 'oer']);
    expect(template.tags).toContainEqual(['summary', 'A short summary']);
  });

  it('keeps the "d" tag unchanged', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    expect(template.tags).toContainEqual(['d', 'my-calendar']);
  });

  it('replaces only the title tag, without duplicating it', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    const titleTags = template.tags.filter((/** @type {any[]} */ t) => t[0] === 'title');
    expect(titleTags).toEqual([['title', 'New Title']]);
  });

  it('updates the content to the new description', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    expect(template.content).toBe('New description');
  });

  it('strips the signature so the template can be re-signed', async () => {
    const eventFactory = createAppEventFactory();
    const template = await buildCalendarRenameTemplate(
      eventFactory,
      ORIGINAL_EVENT,
      'New Title',
      'New description'
    );

    expect(template.sig).toBeUndefined();
  });
});
