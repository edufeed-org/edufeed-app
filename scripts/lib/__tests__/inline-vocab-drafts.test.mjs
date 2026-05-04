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
    // Top-level concepts (no `children`) carry topConceptOf and empty
    // broader/narrower; only nested children omit topConceptOf.
    expect(drafts.concepts[0].topConceptOf).toEqual({
      address: `39737:${PUBKEY}:colors`,
      relay: RELAY
    });
    expect(drafts.concepts[0].broader).toEqual([]);
    expect(drafts.concepts[0].narrower).toEqual([]);
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

describe('buildInlineDrafts — hierarchical scheme', () => {
  it('sets broader on children and narrower on parent; only parent has topConceptOf', () => {
    const scheme = {
      d: 'animals',
      source: {
        type: 'inline',
        prefLabels: [{ value: 'Animals', lang: 'en' }],
        concepts: [
          {
            d: 'mammal',
            prefLabels: [{ value: 'Mammal', lang: 'en' }],
            children: [
              { d: 'dog', prefLabels: [{ value: 'Dog', lang: 'en' }] },
              { d: 'cat', prefLabels: [{ value: 'Cat', lang: 'en' }] }
            ]
          },
          { d: 'fish', prefLabels: [{ value: 'Fish', lang: 'en' }] }
        ]
      }
    };

    const drafts = buildInlineDrafts(scheme, PUBKEY, RELAY);

    expect(drafts.concepts).toHaveLength(4);

    const mammal = drafts.concepts.find((c) => c.d === 'mammal');
    const dog = drafts.concepts.find((c) => c.d === 'dog');
    const cat = drafts.concepts.find((c) => c.d === 'cat');
    const fish = drafts.concepts.find((c) => c.d === 'fish');

    expect(mammal.topConceptOf).toEqual({ address: `39737:${PUBKEY}:animals`, relay: RELAY });
    expect(mammal.broader).toEqual([]);
    expect(mammal.narrower).toEqual([
      { address: `39738:${PUBKEY}:dog`, relay: RELAY },
      { address: `39738:${PUBKEY}:cat`, relay: RELAY }
    ]);

    expect(dog.topConceptOf).toBeUndefined();
    expect(dog.broader).toEqual([{ address: `39738:${PUBKEY}:mammal`, relay: RELAY }]);
    expect(dog.narrower).toEqual([]);

    expect(cat.topConceptOf).toBeUndefined();
    expect(cat.broader).toEqual([{ address: `39738:${PUBKEY}:mammal`, relay: RELAY }]);

    expect(fish.topConceptOf).toEqual({ address: `39737:${PUBKEY}:animals`, relay: RELAY });
    expect(fish.broader).toEqual([]);
  });
});
