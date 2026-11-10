/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  LESSON_PHASES,
  emptyLessonState,
  mergeLessonState,
  renderLessonState,
  sanitizeLessonPatch,
  sanitizeLessonState
} from '$lib/termi/lesson-state.js';
import { bigLessonState } from './fixtures/termi/big-lesson-state.js';

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

describe('sanitizeLessonPatch links', () => {
  it('drops an entry whose uri/href/url is not http(s), keeps an https one', () => {
    expect(
      sanitizeLessonPatch({
        competences: [
          { uri: 'javascript:alert(1)', label: 'böse' },
          { uri: 'https://w3id.org/k/1', label: 'gut' },
          { label: 'ohne uri' }
        ],
        plan: [
          { n: 1, url: 'data:text/html,x' },
          { n: 2, href: 'http://example.org' }
        ]
      })
    ).toEqual({
      competences: [{ uri: 'https://w3id.org/k/1', label: 'gut' }, { label: 'ohne uri' }],
      plan: [{ n: 2, href: 'http://example.org' }]
    });
  });

  it('counts the 4 KB cap in bytes, not chars', () => {
    // 20 × 150 umlauts = 3 000 chars but 6 000 bytes
    expect(sanitizeLessonPatch({ plan: Array(20).fill('ü'.repeat(150)) })).toBeNull();
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

  it('never throws on a malformed state', () => {
    expect(() =>
      renderLessonState(/** @type {any} */ ({ phase: 9, competences: 'x', frame: 3 }), 'de')
    ).not.toThrow();
    expect(renderLessonState(/** @type {any} */ ({ competences: 'x' }), 'de')).toContain('Phase 1');
    expect(renderLessonState(/** @type {any} */ ('garbage'), 'de')).toContain('Phase 1');
  });

  it('stays under 1 200 chars for a full state', () => {
    const state = mergeLessonState(emptyLessonState(), {
      competences: Array.from({ length: 20 }, () => ({ label: 'k'.repeat(150) }))
    });
    const text = renderLessonState(state, 'de');
    expect(text.length).toBe(1200);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('sanitizeLessonState', () => {
  const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;

  it('a merged ~4.5 KB state passes whole (a patch that size would not) and renders', () => {
    const state = bigLessonState();
    expect(bytes(state)).toBeGreaterThan(4 * 1024);
    expect(bytes(state)).toBeLessThan(16 * 1024);
    expect(sanitizeLessonPatch(state)).toBeNull();
    expect(sanitizeLessonState(state)).toEqual(state);
    const text = renderLessonState(state, 'de');
    expect(text).toContain('Stand: Phase 5 von 7 (Ausarbeitung).');
    expect(text).toContain('Ausgearbeitet: 8 Stunden.');
  });

  it('applies the patch rules and drops a state over 16 KB', () => {
    expect(sanitizeLessonState({ phase: 0, evil: 1 })).toEqual({ ...emptyLessonState(), phase: 1 });
    expect(sanitizeLessonState('x')).toBeNull();
    const huge = {
      plan: Array.from({ length: 20 }, () => ({ notes: Array(20).fill('x'.repeat(400)) }))
    };
    expect(sanitizeLessonState(huge)).toBeNull();
    expect(renderLessonState(/** @type {any} */ (huge), 'de')).toContain('Stand: Phase 1 von 7');
  });
});
