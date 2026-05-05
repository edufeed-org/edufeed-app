/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { bucketSubjectsForBildungsbereich } from '$lib/helpers/educational/bucketSubjectsForBildungsbereich.js';

const RELIGION_SCHULFACH = {
  id: 'https://w3id.org/kim/schulfaecher/s1023',
  label: 'Religionslehre (evangelische)'
};
const RELIGION_HOCHSCHULFACH = {
  id: 'https://w3id.org/kim/hochschulfaecher/n12',
  label: 'Religion'
};

describe('bucketSubjectsForBildungsbereich', () => {
  it('buckets subjects under the first vocab key for "schule"', () => {
    const out = bucketSubjectsForBildungsbereich([RELIGION_SCHULFACH], 'schule');
    expect(out).toEqual({ schulfaecher: [RELIGION_SCHULFACH] });
  });

  it('buckets subjects under the first vocab key for "hochschule"', () => {
    const out = bucketSubjectsForBildungsbereich([RELIGION_HOCHSCHULFACH], 'hochschule');
    expect(out).toEqual({ hochschulfaecher: [RELIGION_HOCHSCHULFACH] });
  });

  it('buckets all subjects under the first key for "extra" (multi-vocab)', () => {
    const out = bucketSubjectsForBildungsbereich(
      [RELIGION_SCHULFACH, RELIGION_HOCHSCHULFACH],
      'extra'
    );
    // First vocab key for "extra" is `schulfaecher`; we don't disambiguate
    // — same heuristic as edit-mode prefill.
    expect(out).toEqual({ schulfaecher: [RELIGION_SCHULFACH, RELIGION_HOCHSCHULFACH] });
  });

  it('returns null for "konfi" (no subject vocab)', () => {
    const out = bucketSubjectsForBildungsbereich([RELIGION_SCHULFACH], 'konfi');
    expect(out).toBeNull();
  });

  it('returns null for unknown bildungsbereich', () => {
    const out = bucketSubjectsForBildungsbereich([RELIGION_SCHULFACH], 'whatever');
    expect(out).toBeNull();
  });

  it('returns null for empty subject list', () => {
    const out = bucketSubjectsForBildungsbereich([], 'schule');
    expect(out).toBeNull();
  });

  it('returns null for missing/empty bildungsbereich', () => {
    expect(bucketSubjectsForBildungsbereich([RELIGION_SCHULFACH], '')).toBeNull();
    expect(bucketSubjectsForBildungsbereich([RELIGION_SCHULFACH], undefined)).toBeNull();
  });

  it('normalizes {id, prefLabel} payload shape to {id, label}', () => {
    const payloadShape = [{ id: RELIGION_SCHULFACH.id, prefLabel: RELIGION_SCHULFACH.label }];
    const out = bucketSubjectsForBildungsbereich(payloadShape, 'schule');
    expect(out).toEqual({
      schulfaecher: [{ id: RELIGION_SCHULFACH.id, label: RELIGION_SCHULFACH.label }]
    });
  });
});
