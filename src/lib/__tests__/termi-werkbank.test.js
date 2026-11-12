/** @vitest-environment node */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  partsOf,
  changedBlocks,
  blocksOf,
  railRows,
  partLines,
  nextPartKey,
  isDraft,
  draftSummary
} from '../termi/werkbank.js';

const t = (id, text, extra = {}) => ({ id, role: 'assistant', text, ...extra });
const turns = [
  t('a', '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nEinstieg 10 Min.'),
  t('b', '<!-- termi:part lesson 2 -->\n# Stunde 2\n\nText'),
  t('c', '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nEinstieg 5 Min.')
];
const parts = partsOf(turns, 'lesson');

describe('partsOf', () => {
  it('latest text wins, the earlier one becomes prev', () => {
    expect(parts.map((p) => p.key)).toEqual(['lesson-1', 'lesson-2']);
    expect(parts[0]).toMatchObject({ turnId: 'c', prev: '# Stunde 1\n\nEinstieg 10 Min.' });
    expect(parts[1].prev).toBeUndefined();
  });
  it('stubs contribute nothing; ask documents need no marker', () => {
    expect(partsOf([t('s', 'x …', { textStub: true })], 'lesson')).toEqual([]);
    expect(partsOf([t('d', '# Handout\n\n' + 'wort '.repeat(300))], 'ask')[0].key).toBe('document');
    expect(partsOf([t('q', 'Kurze Antwort.')], 'ask')).toEqual([]);
  });
  it('ignores user turns', () => {
    expect(partsOf([{ id: 'u', role: 'user', text: '# Hi' }], 'ask')).toEqual([]);
  });
});

describe('blocksOf / changedBlocks', () => {
  const tbl = (/** @type {number} */ m) =>
    `| Phase | Min |\n|---|---|\n| Einstieg | ${m} |\n| Sicherung | 10 |`;
  it('splits tables into rows', () => {
    expect(blocksOf(tbl(10))).toHaveLength(3);
  });
  it('marks only new blocks', () => {
    expect(changedBlocks(undefined, 'a\n\nb')).toEqual(new Set());
    expect(changedBlocks('a\n\nb\n\nc', 'a\n\nB\n\nc')).toEqual(new Set([1]));
    expect(changedBlocks(tbl(10), tbl(5))).toEqual(new Set([1]));
  });
});

describe('railRows', () => {
  const state = { phase: 5, plan: [{ n: 1 }, { n: 2 }, { n: 3 }], parts: { lessons: [] } };
  it('derives steps and part states', () => {
    const r = railRows(state, parts, { writingKey: 'lesson-3', wraps: { 'lesson-2': 'b' } });
    expect(r.steps.every((s) => s.state === 'done')).toBe(true);
    expect(r.parts.map((p) => [p.key, p.state])).toEqual([
      ['overview', 'todo'],
      ['lesson-1', 'changed'],
      ['lesson-2', 'saved'],
      ['lesson-3', 'writing']
    ]);
  });
  it('failed beats saved, writing beats failed', () => {
    const r = railRows(state, parts, {
      writingKey: 'lesson-1',
      failedKey: 'lesson-1',
      wraps: {}
    });
    expect(r.parts.find((p) => p.key === 'lesson-1')?.state).toBe('writing');
    const f = railRows(state, parts, { failedKey: 'lesson-2', wraps: { 'lesson-2': 'b' } });
    expect(f.parts.find((p) => p.key === 'lesson-2')?.state).toBe('failed');
  });
  it('steps follow the phase', () => {
    expect(railRows({ phase: 2 }, [], {}).steps.map((s) => s.state)).toEqual([
      'done',
      'current',
      'todo',
      'todo'
    ]);
  });
});

describe('railRows without a lesson state', () => {
  it('no steps, one row per part (an ask document)', () => {
    const doc = partsOf([t('d', '# Handout\n\n' + 'wort '.repeat(300))], 'ask');
    expect(railRows(null, doc, { wraps: { document: 'd' } })).toEqual({
      steps: [],
      parts: [{ key: 'document', title: 'Handout', state: 'saved' }]
    });
  });
});

describe('partLines', () => {
  it('per turn: its parts, changed when an earlier turn had the key', () => {
    expect(partLines(turns, 'lesson')).toEqual({
      a: [{ key: 'lesson-1', title: 'Stunde 1', changed: false }],
      b: [{ key: 'lesson-2', title: 'Stunde 2', changed: false }],
      c: [{ key: 'lesson-1', title: 'Stunde 1', changed: true }]
    });
  });
});

describe('nextPartKey', () => {
  it('first planned key without a part', () => {
    const state = { phase: 5, plan: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    expect(nextPartKey(state, parts)).toBe('overview');
    expect(
      nextPartKey({ phase: 5, plan: [{ n: 1 }] }, [{ key: 'overview' }, { key: 'lesson-1' }])
    ).toBeNull();
  });
});

describe('isDraft / draftSummary', () => {
  it('detects drafts', () => {
    expect(isDraft({ messages: [{ role: 'assistant', content: 'Hallo' }] })).toBe(false);
    expect(isDraft({ lesson: { phase: 2 }, messages: [] })).toBe(true);
    expect(
      isDraft({ messages: [{ role: 'assistant', content: 'x', draftWraps: { module: 'n' } }] })
    ).toBe(true);
    expect(isDraft({ messages: [{ role: 'assistant', content: '# Titel\n\nText' }] })).toBe(true);
  });
  it('summarises a series', () => {
    expect(
      draftSummary({
        lesson: {
          frame: { topic: 'Nachhaltigkeit' },
          plan: [{ n: 1 }, { n: 2 }],
          parts: { overview: { wrap: 'naddr1x' }, lessons: [{ n: 1, wrap: 'naddr1y' }] }
        },
        messages: []
      })
    ).toMatchObject({
      title: 'Nachhaltigkeit',
      kind: 'series',
      done: 2,
      total: 3,
      published: false
    });
  });
  it('summarises a document', () => {
    expect(
      draftSummary({
        title: 'Chat',
        messages: [{ role: 'assistant', content: '# Handout\n\nText' }]
      })
    ).toMatchObject({ title: 'Handout', kind: 'document', done: 0, total: 1 });
  });
});
