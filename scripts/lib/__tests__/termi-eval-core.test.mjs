/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  matchesExpect,
  toolsHit,
  isClarification,
  checkBudget,
  aggregateHitRate,
  exitCodeFor,
  diffBaseline,
  validateFixtureRegexes
} from '../termi-eval-core.js';

const item = (type, text) => ({ type, label: text, text });

describe('matchesExpect', () => {
  it('requires one of expect.types among the top-3 items (OR)', () => {
    const top3 = [item('resource', 'a'), item('event', 'b')];
    expect(matchesExpect(top3, { types: ['event'] })).toBe(true);
    expect(matchesExpect(top3, { types: ['community'] })).toBe(false);
  });

  it('matches expect.match against top-3 item text, case-insensitively', () => {
    const top3 = [item('resource', 'e-teaching community')];
    expect(matchesExpect(top3, { match: 'E-TEACHING' })).toBe(true);
    expect(matchesExpect(top3, { match: 'relilab' })).toBe(false);
  });

  it('matches expect.match against the answer text too (a name in the prose, not on a card)', () => {
    const top3 = [item('person', 'OER World Map Test-User')];
    expect(matchesExpect(top3, { match: 'Mößle|Buchwald' }, { answerText: 'Dazu arbeitet u. a. Frau Mößle.' })).toBe(true);
    expect(matchesExpect(top3, { match: 'Mößle|Buchwald' }, { answerText: 'niemand bekannt' })).toBe(false);
    expect(matchesExpect(top3, { match: 'Mößle|Buchwald' })).toBe(false);
  });

  it('for a non-tier2Only fixture never checks match/notMatch against rawText', () => {
    const top3 = [item('resource', 'nothing relevant')];
    expect(matchesExpect(top3, { match: 'inbox' }, { rawText: 'inbox page' })).toBe(false);
  });

  it('for a tier2Only fixture, match/notMatch fall back to rawText (no items)', () => {
    expect(matchesExpect([], { match: 'inbox' }, { rawText: '{"ids":["inbox"]}', tier2Only: true })).toBe(
      true
    );
    expect(
      matchesExpect([], { notMatch: '^# ' }, { rawText: '{"ids":["inbox"]}', tier2Only: true })
    ).toBe(true);
    expect(
      matchesExpect([], { notMatch: 'inbox' }, { rawText: '{"ids":["inbox"]}', tier2Only: true })
    ).toBe(false);
  });

  it('answerMatch/answerNotMatch test the answer text only, regardless of items', () => {
    expect(matchesExpect([], { answerMatch: '^# ' }, { answerText: '# Summary\n...' })).toBe(true);
    expect(matchesExpect([], { answerMatch: '^# ' }, { answerText: 'plain text' })).toBe(false);
    expect(matchesExpect([], { answerNotMatch: '^# ' }, { answerText: 'plain text' })).toBe(true);
    expect(matchesExpect([], { answerNotMatch: '^# ' }, { answerText: '# Heading' })).toBe(false);
  });

  it('with no expect fields at all, always hits', () => {
    expect(matchesExpect([], {})).toBe(true);
  });
});

describe('toolsHit', () => {
  it('is OR within one `|`-group and AND across groups', () => {
    expect(toolsHit(['search_content'], ['search_content|search_resources'])).toBe(true);
    expect(toolsHit(['search_resources'], ['search_content|search_resources'])).toBe(true);
    expect(toolsHit(['find_people'], ['search_content|search_resources'])).toBe(false);
    expect(toolsHit(['search_content', 'find_people'], ['search_content', 'find_people'])).toBe(
      true
    );
    expect(toolsHit(['search_content'], ['search_content', 'find_people'])).toBe(false);
  });

  it('is vacuously true with no expected tools', () => {
    expect(toolsHit([], undefined)).toBe(true);
    expect(toolsHit([], [])).toBe(true);
  });
});

describe('isClarification', () => {
  it('is a question asked back without any tool call', () => {
    expect(isClarification('Für welche Klassenstufe und wie viele Stunden?', [])).toBe(true);
    expect(isClarification('Nenne mir gerne das Thema und das Fach.', [])).toBe(true);
    expect(isClarification('Hier sind Materialien.', [])).toBe(false);
    expect(isClarification('Meinst du Klasse 4?', ['search_content'])).toBe(false);
  });
});

describe('checkBudget', () => {
  it('reports maxSteps/maxMs violations independently', () => {
    expect(checkBudget({ maxSteps: 3 }, { steps: 4 })).toEqual(['maxSteps']);
    expect(checkBudget({ maxMs: 1000 }, { ms: 1500 })).toEqual(['maxMs']);
    expect(checkBudget({ maxSteps: 3, maxMs: 1000 }, { steps: 4, ms: 1500 })).toEqual([
      'maxSteps',
      'maxMs'
    ]);
  });

  it('is empty when within budget or the fixture sets none', () => {
    expect(checkBudget({ maxSteps: 3 }, { steps: 3 })).toEqual([]);
    expect(checkBudget({}, { steps: 100, ms: 100000 })).toEqual([]);
  });
});

describe('aggregateHitRate', () => {
  it('excludes notRun cases from numerator and denominator', () => {
    const cases = [
      { hit: true },
      { hit: false },
      { hit: false, notRun: true },
      { hit: true, notRun: true }
    ];
    expect(aggregateHitRate(cases)).toEqual({ ranCount: 2, hits: 1, hitRate: 0.5 });
  });

  it('is vacuously a 100% hit rate when nothing ran', () => {
    expect(aggregateHitRate([{ hit: false, notRun: true }])).toEqual({
      ranCount: 0,
      hits: 0,
      hitRate: 1
    });
  });
});

describe('exitCodeFor', () => {
  it('exits 0 at or above the threshold, 1 below it', () => {
    expect(exitCodeFor(22 / 24, 0.9)).toBe(0);
    expect(exitCodeFor(22 / 24, 0.99)).toBe(1);
    expect(exitCodeFor(1, 1)).toBe(0);
  });

  it('never fails with the default (0) threshold', () => {
    expect(exitCodeFor(0, 0)).toBe(0);
  });
});

describe('validateFixtureRegexes', () => {
  it('is empty when every match/notMatch/answerMatch/answerNotMatch compiles', () => {
    const fixtures = [
      { id: 'q1', expect: { match: 'e-teaching' } },
      { id: 'q2', expect: { answerMatch: '^# ' } },
      { id: 'q3', expect: {} }
    ];
    expect(validateFixtureRegexes(fixtures)).toEqual([]);
  });

  it('names the fixture id and field for a bad pattern, without throwing', () => {
    const fixtures = [{ id: 'q1', expect: { match: '[unclosed' } }];
    const errors = validateFixtureRegexes(fixtures);
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe('q1');
    expect(errors[0].field).toBe('match');
    expect(typeof errors[0].message).toBe('string');
  });

  it('checks all four regex fields independently', () => {
    const fixtures = [
      { id: 'q1', expect: { notMatch: '[bad' } },
      { id: 'q2', expect: { answerNotMatch: '[bad' } }
    ];
    const errors = validateFixtureRegexes(fixtures);
    expect(errors.map((e) => `${e.id}.${e.field}`)).toEqual(['q1.notMatch', 'q2.answerNotMatch']);
  });
});

describe('diffBaseline', () => {
  it('reports a hit-to-miss case as a regression, miss-to-hit as an improvement', () => {
    const baseline = [
      { id: 'q1', hit: true },
      { id: 'q2', hit: false }
    ];
    const current = [
      { id: 'q1', hit: false },
      { id: 'q2', hit: true }
    ];
    const diff = diffBaseline(current, baseline);
    expect(diff.regressions).toEqual(['q1']);
    expect(diff.improvements).toEqual(['q2']);
    expect(diff.newCases).toEqual([]);
    expect(diff.missing).toEqual([]);
  });

  it('lists ids only in the current run as new, only in the baseline as missing', () => {
    const baseline = [{ id: 'q1', hit: true }];
    const current = [{ id: 'q2', hit: true }];
    const diff = diffBaseline(current, baseline);
    expect(diff.newCases).toEqual(['q2']);
    expect(diff.missing).toEqual(['q1']);
  });

  it('skips a case that was notRun on either side', () => {
    const baseline = [{ id: 'q1', hit: true, notRun: true }];
    const current = [{ id: 'q1', hit: false }];
    expect(diffBaseline(current, baseline).regressions).toEqual([]);
  });
});
