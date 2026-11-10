/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  LESSON_PHASES,
  emptyLessonState,
  mergeLessonState,
  renderLessonState,
  sanitizeLessonPatch
} from '$lib/termi/lesson-state.js';

const NADDR =
  'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk6zlzrn0fl2lhrsrqsqqqa28pccpzu';

describe('sanitizeLessonPatch', () => {
  it('rejects > 4 KB and non-objects', () => {
    expect(sanitizeLessonPatch(null)).toBeNull();
    expect(sanitizeLessonPatch('phase 2')).toBeNull();
    expect(sanitizeLessonPatch([{ phase: 2 }])).toBeNull();
    const big = {
      plan: Array.from({ length: 20 }, (_, i) => ({ n: i, title: 'x'.repeat(500) }))
    };
    expect(sanitizeLessonPatch(big)).toBeNull();
  });

  it('drops unknown and mistyped keys, clamps phase, caps strings and arrays, checks naddrs', () => {
    const out = sanitizeLessonPatch({
      phase: 9,
      evil: 'x',
      competences: 'not an array',
      frame: { subject: 'Mathe', topic: 'T'.repeat(900) },
      plan: Array.from({ length: 40 }, (_, i) => ({ n: i })),
      parts: { lessons: [{ n: 1, title: 'Brüche', naddr: 'javascript:x', wrap: NADDR }] },
      publication: 'nope'
    });
    expect(out).toEqual({
      phase: 7,
      frame: { subject: 'Mathe', topic: 'T'.repeat(500) },
      plan: Array.from({ length: 20 }, (_, i) => ({ n: i })),
      parts: { lessons: [{ n: 1, title: 'Brüche', wrap: NADDR }] }
    });
    expect(sanitizeLessonPatch({ phase: -3 })).toEqual({ phase: 1 });
  });
});

describe('mergeLessonState', () => {
  it('replaces arrays and shallow-merges frame', () => {
    const prev = mergeLessonState(emptyLessonState(), {
      phase: 2,
      frame: { subject: 'Mathe', grade: 4 },
      competences: [{ label: 'A' }, { label: 'B' }]
    });
    const next = mergeLessonState(prev, {
      phase: 3,
      frame: { lessons: 6 },
      competences: [{ label: 'C' }]
    });
    expect(next.frame).toEqual({ subject: 'Mathe', grade: 4, lessons: 6 });
    expect(next.competences).toEqual([{ label: 'C' }]);
    expect(next.phase).toBe(3);
    expect(prev.frame).toEqual({ subject: 'Mathe', grade: 4 });
  });
});

describe('renderLessonState', () => {
  it('mentions phase name, subject, grade, lesson count and competence labels, under 1 200 chars', () => {
    const state = mergeLessonState(emptyLessonState(), {
      phase: 2,
      frame: { subject: 'Mathematik', grade: 4, lessons: 6, minutes: 45, topic: 'Brüche' },
      competences: [
        { uri: 'https://w3id.org/k/1', label: 'Brüche darstellen' },
        { label: 'Anteile vergleichen' }
      ]
    });
    const de = renderLessonState(state, 'de');
    for (const s of [
      'Kompetenzen',
      'Mathematik',
      'Klasse 4',
      '6 Stunden',
      'Brüche darstellen',
      'Anteile vergleichen'
    ])
      expect(de).toContain(s);
    expect(de.length).toBeLessThan(1200);
    expect(renderLessonState(state, 'en')).toContain('Competences');
    expect(LESSON_PHASES[1]).toBe('kompetenzen');
  });

  it('stays under 1 200 chars for a full state', () => {
    const state = mergeLessonState(emptyLessonState(), {
      competences: Array.from({ length: 20 }, () => ({ label: 'k'.repeat(500) }))
    });
    expect(renderLessonState(state, 'de').length).toBeLessThanOrEqual(1200);
  });
});
