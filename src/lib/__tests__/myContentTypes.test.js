/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_TYPES,
  SHELF_ORDER,
  ALL_CONTENT_KINDS,
  getContentType,
  kindToContentType,
  eventToContentType,
  groupItemsByType
} from '../helpers/myContentTypes.js';

const WEBXDC_EVENT = { kind: 30142, id: 'ix', tags: [['m', 'application/x-webxdc']] };
const PLAIN_LEARNING_EVENT = { kind: 30142, id: 'pl', tags: [['m', 'application/pdf']] };

describe('myContentTypes', () => {
  it('defines all eight content types in shelf order', () => {
    expect(SHELF_ORDER).toEqual([
      'calendar',
      'learning',
      'interactive',
      'article',
      'wiki',
      'form',
      'poll',
      'bookmark'
    ]);
  });

  it('maps every kind to its type key', () => {
    expect(kindToContentType(31922)).toBe('calendar');
    expect(kindToContentType(31923)).toBe('calendar');
    expect(kindToContentType(30142)).toBe('learning');
    expect(kindToContentType(30023)).toBe('article');
    expect(kindToContentType(30818)).toBe('wiki');
    expect(kindToContentType(30168)).toBe('form');
    expect(kindToContentType(1068)).toBe('poll');
    expect(kindToContentType(39701)).toBe('bookmark');
  });

  it('returns undefined for unknown kinds', () => {
    expect(kindToContentType(1)).toBeUndefined();
    expect(kindToContentType(7)).toBeUndefined();
  });

  it('exposes a flat list of all authored kinds without duplicates', () => {
    // `interactive` shares kind 30142 with `learning` — the flat kind list
    // (used as a relay filter) must not repeat it.
    expect(ALL_CONTENT_KINDS).toEqual([31922, 31923, 30142, 30023, 30818, 30168, 1068, 39701]);
  });

  describe('eventToContentType', () => {
    it('routes a 30142 with an x-webxdc m-tag to interactive', () => {
      expect(eventToContentType(WEBXDC_EVENT)).toBe('interactive');
    });

    it('routes a plain 30142 to learning', () => {
      expect(eventToContentType(PLAIN_LEARNING_EVENT)).toBe('learning');
      expect(eventToContentType({ kind: 30142, id: 'n', tags: [] })).toBe('learning');
    });

    it('falls back to the kind mapping for other kinds', () => {
      expect(eventToContentType({ kind: 30023, id: 'a', tags: [] })).toBe('article');
      expect(eventToContentType({ kind: 1, id: 'x', tags: [] })).toBeUndefined();
    });
  });

  it('gives each type a ctaKey and an accent color', () => {
    for (const t of CONTENT_TYPES) {
      expect(t.ctaKey).toBeTruthy();
      expect(t.accent).toMatch(/^var\(--ct-/);
    }
  });

  it('getContentType resolves by key', () => {
    expect(getContentType('wiki')?.kinds).toEqual([30818]);
    expect(getContentType('nope')).toBeUndefined();
  });

  describe('groupItemsByType', () => {
    it('buckets events by type and keeps shelf order', () => {
      const items = [
        { kind: 30142, id: 'a' },
        { kind: 31923, id: 'b' },
        { kind: 30142, id: 'c' },
        { kind: 1068, id: 'd' }
      ];
      const groups = groupItemsByType(items);
      expect(Object.keys(groups)).toEqual(SHELF_ORDER);
      expect(groups.learning.map((e) => e.id)).toEqual(['a', 'c']);
      expect(groups.calendar.map((e) => e.id)).toEqual(['b']);
      expect(groups.poll.map((e) => e.id)).toEqual(['d']);
      expect(groups.wiki).toEqual([]);
    });

    it('splits webxdc resources into the interactive bucket', () => {
      const groups = groupItemsByType([WEBXDC_EVENT, PLAIN_LEARNING_EVENT]);
      expect(groups.interactive.map((e) => e.id)).toEqual(['ix']);
      expect(groups.learning.map((e) => e.id)).toEqual(['pl']);
    });

    it('drops events whose kind is not a known content type', () => {
      const groups = groupItemsByType([
        { kind: 1, id: 'x' },
        { kind: 30142, id: 'y' }
      ]);
      const total = Object.values(groups).reduce((n, arr) => n + arr.length, 0);
      expect(total).toBe(1);
      expect(groups.learning.map((e) => e.id)).toEqual(['y']);
    });
  });
});
