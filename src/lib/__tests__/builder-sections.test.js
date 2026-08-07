/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  extractSections,
  interleaveSections,
  isSectionMarker
} from '$lib/helpers/forms/builder-sections.js';

/** @type {(id: string) => import('$lib/helpers/forms/format.js').FormField} */
const field = (id) => ({ id, type: 'text', label: id, options: {} });
/** @type {(id: string, title: string) => import('$lib/helpers/forms/builder-sections.js').SectionMarker} */
const sec = (id, title) => ({ id, type: 'section', title });

describe('extractSections', () => {
  it('groups fields under their preceding section marker', () => {
    const items = [sec('s1', 'Basics'), field('a'), field('b'), sec('s2', 'More'), field('c')];
    const { fields, sections } = extractSections(items);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(sections).toEqual([
      { id: 's1', title: 'Basics', questionIds: ['a', 'b'], order: 0 },
      { id: 's2', title: 'More', questionIds: ['c'], order: 1 }
    ]);
    // section markers are NOT in the returned fields
    expect(fields.some((f) => f.type === 'section')).toBe(false);
  });
  it('leaves leading un-sectioned fields out of any section', () => {
    const items = [field('a'), sec('s1', 'S1'), field('b')];
    const { fields, sections } = extractSections(items);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b']);
    expect(sections).toEqual([{ id: 's1', title: 'S1', questionIds: ['b'], order: 0 }]);
  });
  it('returns empty sections when there are no markers', () => {
    const { fields, sections } = extractSections([field('a'), field('b')]);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b']);
    expect(sections).toEqual([]);
  });
  it('keeps an empty section (marker with no following fields)', () => {
    const { sections } = extractSections([sec('s1', 'Empty'), sec('s2', 'S2'), field('a')]);
    expect(sections).toEqual([
      { id: 's1', title: 'Empty', questionIds: [], order: 0 },
      { id: 's2', title: 'S2', questionIds: ['a'], order: 1 }
    ]);
  });
  it('carries an optional description onto the section', () => {
    const items = [
      /** @type {import('$lib/helpers/forms/builder-sections.js').SectionMarker} */ ({
        id: 's1',
        type: 'section',
        title: 'S1',
        description: 'hi'
      }),
      field('a')
    ];
    expect(extractSections(items).sections[0]).toEqual({
      id: 's1',
      title: 'S1',
      description: 'hi',
      questionIds: ['a'],
      order: 0
    });
  });
});

describe('interleaveSections', () => {
  it('is the inverse of extractSections (round-trip identity)', () => {
    const items = [
      field('x'),
      sec('s1', 'S1'),
      field('a'),
      field('b'),
      sec('s2', 'S2'),
      field('c')
    ];
    const { fields, sections } = extractSections(items);
    const back = interleaveSections(fields, sections);
    expect(back.map((i) => (i.type === 'section' ? `#${i.id}` : i.id))).toEqual([
      'x',
      '#s1',
      'a',
      'b',
      '#s2',
      'c'
    ]);
  });
  it('with no sections returns the fields unchanged', () => {
    const fields = [field('a'), field('b')];
    expect(interleaveSections(fields, [])).toEqual(fields);
  });
  it('appends fields referenced by no section at the front (defensive)', () => {
    const fields = [field('a'), field('b')];
    const sections = [{ id: 's1', title: 'S1', questionIds: ['b'], order: 0 }];
    const items = interleaveSections(fields, sections);
    expect(items.map((i) => (i.type === 'section' ? `#${i.id}` : i.id))).toEqual(['a', '#s1', 'b']);
  });
});

describe('isSectionMarker', () => {
  it('detects section items', () => {
    expect(isSectionMarker(sec('s1', 'S'))).toBe(true);
    expect(isSectionMarker(field('a'))).toBe(false);
  });
});
