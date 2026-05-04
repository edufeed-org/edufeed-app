/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildInlineDrafts } from '../inline-vocab-drafts.mjs';

const PUBKEY = '0'.repeat(64);
const RELAY = 'wss://relay.example';

describe('buildInlineDrafts — flat scheme', () => {
  it('emits scheme + concepts with inScheme set to scheme address', () => {
    const scheme = {
      d: 'colors',
      source: {
        type: 'inline',
        prefLabels: [{ value: 'Colors', lang: 'en' }],
        concepts: [
          { d: 'red', prefLabels: [{ value: 'Red', lang: 'en' }] },
          { d: 'blue', prefLabels: [{ value: 'Blue', lang: 'en' }] }
        ]
      }
    };

    const drafts = buildInlineDrafts(scheme, PUBKEY, RELAY);

    expect(drafts.scheme.d).toBe('colors');
    expect(drafts.scheme.prefLabels).toEqual([{ value: 'Colors', lang: 'en' }]);
    expect(drafts.concepts).toHaveLength(2);
    expect(drafts.concepts[0].d).toBe('red');
    expect(drafts.concepts[0].inScheme).toEqual({
      address: `39737:${PUBKEY}:colors`,
      relay: RELAY
    });
    // Task 1 is a mechanical extraction: hierarchy fields are introduced
    // in Task 2 when `children` support lands.
    expect(drafts.concepts[0].topConceptOf).toBeUndefined();
    expect(drafts.concepts[0].broader).toBeUndefined();
    expect(drafts.concepts[0].narrower).toBeUndefined();
  });

  it('falls back to default prefLabel when scheme has none', () => {
    const scheme = {
      d: 'unlabeled',
      source: { type: 'inline', concepts: [] }
    };
    const drafts = buildInlineDrafts(scheme, PUBKEY, RELAY);
    expect(drafts.scheme.prefLabels).toEqual([{ value: 'unlabeled', lang: 'en' }]);
    expect(drafts.concepts).toEqual([]);
  });
});
