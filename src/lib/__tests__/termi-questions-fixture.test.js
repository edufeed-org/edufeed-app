/** @vitest-environment node */
// Guards the eval fixture scripts/termi-eval-ask.js runs against: every entry
// well-formed, variants resolve, and the eight sentences from the
// 2026-11-07 design doc are present verbatim (laoc's exact wording).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** @type {any[]} */
const fixtures = JSON.parse(
  readFileSync(new URL('../../../scripts/fixtures/termi-questions.json', import.meta.url), 'utf-8')
);

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
      expect(Array.isArray(f.expect?.types)).toBe(true);
      expect(f.expect.types.length).toBeGreaterThan(0);
      if (f.expect.match !== undefined) {
        expect(() => new RegExp(f.expect.match)).not.toThrow();
      }
      if (f.variantOf !== undefined) {
        expect(ids.has(f.variantOf)).toBe(true);
      }
    }
  );

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
