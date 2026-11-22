/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  LESSON_PHASES,
  emptyLessonState,
  mergeLessonState,
  renderLessonState,
  sanitizeLessonPatch,
  sanitizeLessonState,
  partsInOrder,
  withPublished
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
      // wrap/naddr/publication are the client's to record, never the model's
      parts: { lessons: [{ n: 1, title: 'Brüche' }] }
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

  // live 2026-11-12: a one-row plan patch for Stunde 2 wiped Stunde 1 and her edited goal
  it('merges plan rows by n: a known n updates its given fields, a new n is added, order by n', () => {
    const prev = mergeLessonState(null, {
      plan: [
        { n: 1, goal: 'ihr Ziel', phases: ['Einstieg 8'] },
        { n: 2, goal: 'Ziel 2', phases: ['Sicherung 15'] }
      ]
    });
    const next = mergeLessonState(prev, {
      plan: [
        { n: 3, goal: 'Ziel 3' },
        { n: 2, phases: ['Sicherung 12'] }
      ]
    });
    expect(next.plan).toEqual([
      { n: 1, goal: 'ihr Ziel', phases: ['Einstieg 8'] },
      { n: 2, goal: 'Ziel 2', phases: ['Sicherung 12'] },
      { n: 3, goal: 'Ziel 3' }
    ]);
    // the Stundenplan form sends the whole plan: same result as before
    const edited = prev.plan.map((r) => (r.n === 1 ? { ...r, goal: 'neu' } : r));
    expect(mergeLessonState(prev, { plan: edited }).plan).toEqual(edited);
  });
});

describe('mergeLessonState: plan rows without n', () => {
  const prev = () =>
    mergeLessonState(null, {
      plan: [
        { n: 1, goal: 'ihr Ziel' },
        { n: 2, goal: 'Ziel 2' }
      ]
    });
  it('against an existing plan a row without a valid n is dropped, never placed by position', () => {
    const before = prev();
    for (const row of [{ goal: 'Stunde 3?' }, { n: 0, goal: 'x' }, { n: 1.5, goal: 'x' }])
      expect(mergeLessonState(before, { plan: [row] }).plan).toEqual(before.plan);
  });
  it('against an empty plan rows without n are taken by position, and get their n', () => {
    expect(mergeLessonState(null, { plan: [{ goal: 'a' }, { goal: 'b' }] }).plan).toEqual([
      { goal: 'a', n: 1 },
      { goal: 'b', n: 2 }
    ]);
  });
  it('a duplicate n in one patch: the later row wins', () => {
    const next = mergeLessonState(prev(), {
      plan: [
        { n: 2, goal: 'erst' },
        { n: 2, goal: 'dann' }
      ]
    });
    expect(next.plan[1]).toEqual({ n: 2, goal: 'dann' });
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

  it('a merged ~4.5 KB state passes whole (naddrs included, unlike a patch) and renders', () => {
    const state = bigLessonState();
    expect(bytes(state)).toBeGreaterThan(4 * 1024);
    expect(bytes(state)).toBeLessThan(16 * 1024);
    // the patch path drops every recorded naddr (or the whole patch); the state path keeps them
    expect(JSON.stringify(sanitizeLessonPatch(state) ?? {})).not.toContain('naddr1');
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

describe('recorded wraps survive model patches', () => {
  const W = NADDR;
  const base = () =>
    mergeLessonState(null, {
      parts: {
        lessons: [
          { n: 1, title: 'Eins', wrap: W },
          { n: 2, title: 'Zwei', wrap: W },
          { n: 3, title: 'Drei' }
        ],
        module: { title: 'Modul', wrap: W }
      }
    });

  it('a lesson patch takes the title and keeps the wrap; an omitted lesson with a wrap stays', () => {
    const next = mergeLessonState(base(), { parts: { lessons: [{ n: 1, title: 'x' }] } });
    expect(next.parts.lessons).toEqual([
      { n: 1, title: 'x', wrap: W },
      { n: 2, title: 'Zwei', wrap: W }
    ]);
  });

  it('parts.module: the patch merges, the wrap wins', () => {
    const next = mergeLessonState(base(), {
      parts: { lessons: [], module: { title: 'Neu', wrap: 'naddr1other' } }
    });
    expect(next.parts.module).toEqual({ title: 'Neu', wrap: W });
    // lessons: [] drops only the unsaved lesson 3
    expect(next.parts.lessons.map((l) => l.n)).toEqual([1, 2]);
  });

  it('a model patch never writes wrap/naddr/publication/resource; a stored state keeps them', () => {
    const input = {
      publication: W,
      resource: W,
      parts: { lessons: [{ n: 1, title: 'a', wrap: W, naddr: W }], module: { wrap: W } }
    };
    expect(sanitizeLessonPatch(input)).toEqual({
      parts: { lessons: [{ n: 1, title: 'a' }], module: {} }
    });
    const stored = /** @type {any} */ (sanitizeLessonState(input));
    expect(stored.publication).toBe(W);
    expect(stored.parts.lessons[0]).toEqual({ n: 1, title: 'a', wrap: W, naddr: W });
  });
});

describe('partsInOrder / withPublished (phase 7)', () => {
  const W2 = NADDR.slice(0, -1) + 'q';
  it('overview, lessons by n, worksheets, summary, module, sources; the state wrap wins over a turn wrap', () => {
    const state = mergeLessonState(null, {
      parts: /** @type {any} */ ({
        sources: { wrap: NADDR },
        lessons: [
          { n: 2, title: 'Zwei', wrap: NADDR },
          { n: 1, title: 'Eins' }
        ],
        overview: { wrap: NADDR }
      })
    });
    const parts = partsInOrder(state, { 'lesson-1': W2, 'lesson-3': W2, module: W2, bogus: W2 });
    expect(parts.map((p) => p.key)).toEqual([
      'overview',
      'lesson-1',
      'lesson-2',
      'lesson-3',
      'module',
      'sources'
    ]);
    expect(parts[1]).toEqual({ key: 'lesson-1', title: 'Eins', wrap: W2 });
    expect(parts[2].wrap).toBe(NADDR);
    // a part with neither wrap nor naddr is still listed (phase 7 shows it as missing)
    const planned = partsInOrder(
      mergeLessonState(null, { parts: /** @type {any} */ ({ summary: { title: 'Z' } }) })
    );
    expect(planned).toEqual([{ key: 'summary', title: 'Z' }]);
  });

  it('withPublished records through the state path; a model patch cannot overwrite it', () => {
    let s = withPublished(null, { key: 'lesson-1', naddr: NADDR });
    s = withPublished(s, { publication: NADDR });
    expect(s.parts.lessons[0].naddr).toBe(NADDR);
    const patched = mergeLessonState(
      s,
      sanitizeLessonPatch({
        publication: W2,
        parts: { lessons: [{ n: 1, title: 'neu', naddr: W2 }] }
      })
    );
    expect(patched.publication).toBe(NADDR);
    expect(patched.parts.lessons[0]).toEqual({ n: 1, title: 'neu', naddr: NADDR });
    expect(sanitizeLessonState(patched)?.publication).toBe(NADDR);
  });
});
