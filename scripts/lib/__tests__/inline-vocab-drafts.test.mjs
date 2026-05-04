/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildInlineDrafts } from '../inline-vocab-drafts.mjs';

const PUBKEY = '0'.repeat(64);
const RELAY = 'wss://relay.example';

describe('buildInlineDrafts — flat scheme', () => {
  it('emits scheme + concepts with topConceptOf set to scheme address', () => {
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
    expect(drafts.concepts).toHaveLength(2);
    expect(drafts.concepts[0].inScheme).toEqual({
      address: `39737:${PUBKEY}:colors`,
      relay: RELAY
    });
    expect(drafts.concepts[0].topConceptOf).toEqual({
      address: `39737:${PUBKEY}:colors`,
      relay: RELAY
    });
    expect(drafts.concepts[0].broader).toEqual([]);
    expect(drafts.concepts[0].narrower).toEqual([]);
  });
});
