/** @vitest-environment node */
// Guards the eval fixture scripts/termi-eval-ask.js runs against: every entry
// well-formed, variants resolve, and the eight sentences from the
// 2026-11-07 design doc are present verbatim (laoc's exact wording).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_REGISTRY } from '$lib/termi/tool-registry.js';

/** @type {any[]} */
const fixtures = JSON.parse(
  readFileSync(new URL('../../../scripts/fixtures/termi-questions.json', import.meta.url), 'utf-8')
);

// Allow-lists for schema drift: an unknown key (e.g. a typo like
// `answerMacth` for `answerMatch`) is silently ignored by every consumer
// instead of failing the fixture it was meant to constrain — catch it here.
const EXPECT_KEYS = new Set([
  'types',
  'match',
  'notMatch',
  'answerMatch',
  'answerNotMatch',
  'tools',
  'clarifyOk',
  'noTools'
]);
const FIXTURE_KEYS = new Set([
  'id',
  'text',
  'locale',
  'expect',
  'variantOf',
  'mayBeUnavailable',
  'tier2Only',
  'maxSteps',
  'maxMs',
  'history'
]);

/** @param {object} obj @param {Set<string>} allowed */
const unknownKeys = (obj, allowed) => Object.keys(obj ?? {}).filter((k) => !allowed.has(k));

const BASE_SENTENCES = [
  'ich suche die e-teaching community',
  'ich suche nach Fortbildungen zum Thema X, im Fach Y',
  'meine Studierenden/Schüler sind unaufmerksam, was kann ich verbessern?',
  'ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit',
  'wie bereite ich mich auf den Statistik-Vorkurs vor?',
  'wer beschäftigt sich mit dem Thema OER-Lizenzen in Deutschland?',
  'welche Community beschäftigt sich mit Religionspädagogik?',
  'welche Projekte werden im Bereich gendersensibler Unterricht durchgeführt?'
];

describe('termi-questions fixture', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(fixtures)).toBe(true);
    expect(fixtures.length).toBeGreaterThan(0);
  });

  const ids = new Set(fixtures.map((f) => f.id));

  it.each(/** @type {[string, any][]} */ (fixtures.map((f) => [f.id, f])))(
    '%s is well-formed',
    (_id, f) => {
      expect(typeof f.id).toBe('string');
      expect(f.id.length).toBeGreaterThan(0);
      expect(typeof f.text).toBe('string');
      expect(f.text.length).toBeGreaterThan(0);
      expect(['de', 'en']).toContain(f.locale);
      // tier2Only fixtures (e.g. show_pages) have no item-type concept: tier 1 skips them.
      if (!f.tier2Only) {
        expect(Array.isArray(f.expect?.types)).toBe(true);
        expect(f.expect.types.length).toBeGreaterThan(0);
      }
      if (f.expect.match !== undefined) {
        expect(() => new RegExp(f.expect.match)).not.toThrow();
      }
      if (f.expect.notMatch !== undefined) {
        expect(f.tier2Only).toBe(true); // tier2Only: tested against the raw tool output
        expect(() => new RegExp(f.expect.notMatch)).not.toThrow();
      }
      // answerMatch/answerNotMatch test the model's generated answer text,
      // which only tier 2 produces — so only tier2Only fixtures use them.
      if (f.expect.answerMatch !== undefined) {
        expect(f.tier2Only).toBe(true);
        expect(() => new RegExp(f.expect.answerMatch)).not.toThrow();
      }
      if (f.expect.answerNotMatch !== undefined) {
        expect(f.tier2Only).toBe(true);
        expect(() => new RegExp(f.expect.answerNotMatch)).not.toThrow();
      }
      if (f.maxSteps !== undefined) {
        expect(Number.isInteger(f.maxSteps)).toBe(true);
        expect(f.maxSteps).toBeGreaterThan(0);
      }
      if (f.maxMs !== undefined) {
        expect(typeof f.maxMs).toBe('number');
        expect(f.maxMs).toBeGreaterThan(0);
      }
      if (f.variantOf !== undefined) {
        expect(ids.has(f.variantOf)).toBe(true);
      }
      expect(unknownKeys(f, FIXTURE_KEYS)).toEqual([]);
      expect(unknownKeys(f.expect, EXPECT_KEYS)).toEqual([]);
    }
  );

  it('history entries are user/assistant turns with text, on tier2Only fixtures only', () => {
    for (const f of fixtures.filter((x) => x.history)) {
      expect(f.tier2Only, `${f.id} has history but is not tier2Only`).toBe(true);
      expect(Array.isArray(f.history) && f.history.length > 0).toBe(true);
      for (const h of f.history) {
        expect(['user', 'assistant']).toContain(h.role);
        expect(typeof h.text === 'string' && h.text.length > 0).toBe(true);
      }
    }
  });

  it('rejects an injected unknown expect key (e.g. a typo like answerMacth)', () => {
    const bad = { ...fixtures[0].expect, answerMacth: '^# ' };
    expect(unknownKeys(bad, EXPECT_KEYS)).toEqual(['answerMacth']);
  });

  it('rejects an injected unknown top-level key', () => {
    const bad = { ...fixtures[0], notARealField: true };
    expect(unknownKeys(bad, FIXTURE_KEYS)).toEqual(['notARealField']);
  });

  it('names only registry tools in expect.tools', () => {
    const named = fixtures.flatMap((f) =>
      (f.expect.tools ?? []).flatMap((/** @type {string} */ t) => t.split('|'))
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(Object.keys(TOOL_REGISTRY)).toContain(name);
  });

  it('expects only item types a registry tool can default to, or resource/project', () => {
    const known = new Set([
      'resource',
      'project',
      ...Object.values(TOOL_REGISTRY).map((t) => t.defaultItemType)
    ]);
    for (const f of fixtures) for (const t of f.expect.types ?? []) expect(known).toContain(t);
  });

  it('has unique ids', () => {
    expect(ids.size).toBe(fixtures.length);
  });

  it.each(BASE_SENTENCES.map((text, i) => [`sentence ${i + 1}`, text]))(
    'contains base %s verbatim',
    (_label, text) => {
      expect(fixtures.some((f) => f.text === text && f.variantOf === undefined)).toBe(true);
    }
  );
});
