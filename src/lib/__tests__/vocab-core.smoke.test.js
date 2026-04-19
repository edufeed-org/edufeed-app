/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildConceptScheme, buildConcept, VOCAB_KIND } from 'nostr-vocab-core';

describe('nostr-vocab-core (shared package) is reachable from edufeed-app', () => {
  it('VOCAB_KIND is 39737', () => {
    expect(VOCAB_KIND).toBe(39737);
  });

  it('buildConceptScheme builds a tag array with type=ConceptScheme', () => {
    const e = buildConceptScheme({
      d: 'schulfaecher',
      prefLabels: [{ value: 'Schulfächer', lang: 'de' }]
    });
    expect(e.kind).toBe(39737);
    expect(e.tags).toContainEqual(['type', 'ConceptScheme']);
  });

  it('buildConcept emits the required inScheme a-tag', () => {
    const e = buildConcept({
      d: 's1017',
      prefLabels: [{ value: 'Mathematik', lang: 'de' }],
      inScheme: { address: '39737:abc:schulfaecher', relay: 'wss://r.example.com' }
    });
    expect(
      e.tags.some((t) => t[0] === 'a' && t[1] === '39737:abc:schulfaecher' && t[3] === 'inScheme')
    ).toBe(true);
  });
});
