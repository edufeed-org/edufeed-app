/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  BILDUNGSBEREICHE,
  BILDUNGSBEREICH_KEYS,
  SUBJECT_VOCAB_LABELS,
  getBildungsbereich,
  getSubjectVocabLabel,
  inferBildungsbereichFromEducationalLevels
} from '$lib/helpers/educational/bildungsbereich.js';

describe('BILDUNGSBEREICHE config', () => {
  it('exposes all four Bildungsbereiche', () => {
    expect(Object.keys(BILDUNGSBEREICHE).sort()).toEqual([
      'extra',
      'hochschule',
      'konfi',
      'schule'
    ]);
    expect(BILDUNGSBEREICH_KEYS).toEqual(['schule', 'hochschule', 'extra', 'konfi']);
  });

  it('Schule maps to schulfaecher vocab and KIM Primar/Sek I/Sek II level URIs', () => {
    const schule = BILDUNGSBEREICHE.schule;
    expect(schule.label.de).toBe('Schule');
    expect(schule.subjectVocabKeys).toEqual(['schulfaecher']);
    expect(schule.educationalLevelMapping).toEqual([
      'https://w3id.org/kim/educationalLevel/level_1',
      'https://w3id.org/kim/educationalLevel/level_2',
      'https://w3id.org/kim/educationalLevel/level_3'
    ]);
  });

  it('Hochschule maps to hochschulfaecher vocab and the Hochschule level URI', () => {
    const hs = BILDUNGSBEREICHE.hochschule;
    expect(hs.label.de).toBe('Hochschule');
    expect(hs.subjectVocabKeys).toEqual(['hochschulfaecher']);
    expect(hs.educationalLevelMapping).toEqual(['https://w3id.org/kim/educationalLevel/level_A']);
  });

  it('Extra-Institutionell offers BOTH school and university subject vocabs and Fortbildung level', () => {
    const extra = BILDUNGSBEREICHE.extra;
    expect(extra.label.de).toBe('Extra-Institutionell');
    expect(extra.subjectVocabKeys).toEqual(['schulfaecher', 'hochschulfaecher']);
    expect(extra.educationalLevelMapping).toEqual([
      'https://w3id.org/kim/educationalLevel/level_C'
    ]);
  });

  it('Konfi-Arbeit is a placeholder with no subject vocab and no educationalLevel mapping', () => {
    const konfi = BILDUNGSBEREICHE.konfi;
    expect(konfi.label.de).toBe('Konfi-Arbeit');
    expect(konfi.label.en).toBe('Confirmation program');
    // Downstream behavior is intentionally deferred: no subject picker rendered,
    // no educationalLevel URI tagged, no legacy events to infer.
    expect(konfi.subjectVocabKeys).toEqual([]);
    expect(konfi.educationalLevelMapping).toEqual([]);
  });
});

describe('getBildungsbereich', () => {
  it('returns the config for a known key', () => {
    expect(getBildungsbereich('schule')).toBe(BILDUNGSBEREICHE.schule);
  });

  it('returns undefined for an unknown key', () => {
    expect(getBildungsbereich('made-up')).toBeUndefined();
  });
});

describe('inferBildungsbereichFromEducationalLevels', () => {
  it('returns "hochschule" when the levels include the Hochschule URI', () => {
    expect(
      inferBildungsbereichFromEducationalLevels(['https://w3id.org/kim/educationalLevel/level_A'])
    ).toBe('hochschule');
  });

  it('returns "schule" when the levels include any school-stage URI', () => {
    expect(
      inferBildungsbereichFromEducationalLevels(['https://w3id.org/kim/educationalLevel/level_2'])
    ).toBe('schule');
  });

  it('returns "extra" when the levels include the Fortbildung URI', () => {
    expect(
      inferBildungsbereichFromEducationalLevels(['https://w3id.org/kim/educationalLevel/level_C'])
    ).toBe('extra');
  });

  it('returns undefined when no level matches a known Bildungsbereich', () => {
    expect(inferBildungsbereichFromEducationalLevels([])).toBeUndefined();
    expect(
      inferBildungsbereichFromEducationalLevels(['https://example.com/unknown'])
    ).toBeUndefined();
  });

  it('prefers the first matching Bildungsbereich (declaration order: schule → hochschule → extra)', () => {
    // A resource tagged with both Sek I and Hochschule resolves to "schule" (declaration-order priority).
    expect(
      inferBildungsbereichFromEducationalLevels([
        'https://w3id.org/kim/educationalLevel/level_A',
        'https://w3id.org/kim/educationalLevel/level_2'
      ])
    ).toBe('schule');
  });
});

describe('SUBJECT_VOCAB_LABELS / getSubjectVocabLabel', () => {
  it('has DE + EN entries for every vocab key referenced by a Bildungsbereich', () => {
    const referencedKeys = new Set(
      Object.values(BILDUNGSBEREICHE).flatMap((cfg) => cfg.subjectVocabKeys)
    );
    for (const key of referencedKeys) {
      expect(SUBJECT_VOCAB_LABELS[key]).toBeDefined();
      expect(SUBJECT_VOCAB_LABELS[key].de).toBeTruthy();
      expect(SUBJECT_VOCAB_LABELS[key].en).toBeTruthy();
    }
  });

  it('resolves a known slug to the requested locale', () => {
    expect(getSubjectVocabLabel('schulfaecher', 'de')).toBe('Schule');
    expect(getSubjectVocabLabel('schulfaecher', 'en')).toBe('School');
    expect(getSubjectVocabLabel('hochschulfaecher', 'de')).toBe('Hochschule');
    expect(getSubjectVocabLabel('hochschulfaecher', 'en')).toBe('Higher Education');
  });

  it('defaults to English when no locale is provided', () => {
    expect(getSubjectVocabLabel('schulfaecher')).toBe('School');
  });

  it('falls back to the raw slug for unknown keys', () => {
    expect(getSubjectVocabLabel('nonsense', 'de')).toBe('nonsense');
    expect(getSubjectVocabLabel('nonsense', 'en')).toBe('nonsense');
  });
});

describe('Konfi step4SubSteps + bildungsbereichTag', () => {
  it('Schule has bildungsbereichTag and no step4SubSteps', () => {
    expect(BILDUNGSBEREICHE.schule.bildungsbereichTag).toBe('schule');
    expect(BILDUNGSBEREICHE.schule.step4SubSteps).toBeUndefined();
  });

  it('Konfi has bildungsbereichTag=konfi and three sub-steps 4a/4b/4c', () => {
    const k = BILDUNGSBEREICHE.konfi;
    expect(k.bildungsbereichTag).toBe('konfi');
    expect(k.step4SubSteps?.map((s) => s.key)).toEqual(['4a', '4b', '4c']);
  });

  it('Konfi 4a includes required konfiZielgruppen', () => {
    const a = BILDUNGSBEREICHE.konfi.step4SubSteps?.find((s) => s.key === '4a');
    const z = a?.fields.find(
      (f) => f.kind === 'vocab' && /** @type any */ (f).schemeKey === 'konfiZielgruppen'
    );
    expect(z).toMatchObject({ tagSlug: 'zielgruppen', multi: true, required: true });
  });

  it('Konfi 4b includes the topicOrDimension XOR group', () => {
    const b = BILDUNGSBEREICHE.konfi.step4SubSteps?.find((s) => s.key === '4b');
    const groups = b?.fields
      .filter((f) => f.kind === 'vocab')
      .map((f) => /** @type any */ (f).requiredOneOf);
    expect(groups).toContain('topicOrDimension');
  });

  it('Konfi 4c includes landeskirche with non-konfi schemeKey and multi=false', () => {
    const c = BILDUNGSBEREICHE.konfi.step4SubSteps?.find((s) => s.key === '4c');
    const lk = c?.fields.find(
      (f) => f.kind === 'vocab' && /** @type any */ (f).tagSlug === 'landeskirche'
    );
    expect(lk).toMatchObject({ schemeKey: 'landeskirchen', multi: false });
  });

  it('every vocab tagSlug in konfi is unique', () => {
    const slugs = [];
    for (const step of BILDUNGSBEREICHE.konfi.step4SubSteps ?? []) {
      for (const f of step.fields) if (f.kind === 'vocab') slugs.push(f.tagSlug);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
