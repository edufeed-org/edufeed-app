/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildConceptScheme,
  buildConcept,
  buildCollection,
  parseVocabEvent,
  VOCAB_KIND,
  CONCEPT_KIND,
  COLLECTION_KIND,
  CONCEPT_DRAFT_KIND,
  TYPES,
  kindFor
} from 'nostr-vocab-core';

describe('nostr-vocab-core (shared package) is reachable from edufeed-app', () => {
  it('exports the six-kind constants expected by the app', () => {
    expect(VOCAB_KIND).toBe(39737);
    expect(CONCEPT_KIND).toBe(39738);
    expect(COLLECTION_KIND).toBe(39739);
  });

  it('kindFor maps (type, draft) to the correct kind (incl. Concept draft)', () => {
    expect(kindFor(TYPES.SCHEME)).toBe(VOCAB_KIND);
    expect(kindFor(TYPES.CONCEPT)).toBe(CONCEPT_KIND);
    expect(kindFor(TYPES.COLLECTION)).toBe(COLLECTION_KIND);
    expect(kindFor(TYPES.CONCEPT, true)).toBe(CONCEPT_DRAFT_KIND);
  });

  it('buildConceptScheme returns kind VOCAB_KIND with a type=ConceptScheme tag', () => {
    const e = buildConceptScheme({
      d: 'schulfaecher',
      prefLabels: [{ value: 'Schulfächer', lang: 'de' }]
    });
    expect(e.kind).toBe(VOCAB_KIND);
    expect(e.tags).toContainEqual(['type', 'ConceptScheme']);
  });

  it('buildConcept returns kind CONCEPT_KIND and emits the required inScheme a-tag', () => {
    const e = buildConcept({
      d: 's1017',
      prefLabels: [{ value: 'Mathematik', lang: 'de' }],
      inScheme: { address: '39737:abc:schulfaecher', relay: 'wss://r.example.com' }
    });
    expect(e.kind).toBe(CONCEPT_KIND);
    expect(
      e.tags.some((t) => t[0] === 'a' && t[1] === '39737:abc:schulfaecher' && t[3] === 'inScheme')
    ).toBe(true);
  });

  it('buildCollection returns kind COLLECTION_KIND', () => {
    const e = buildCollection({
      d: 'my-collection',
      prefLabels: [{ value: 'My Collection', lang: 'en' }],
      inScheme: { address: '39737:abc:scheme', relay: '' }
    });
    expect(e.kind).toBe(COLLECTION_KIND);
    expect(e.tags).toContainEqual(['type', 'Collection']);
  });

  it('parseVocabEvent dispatches on kind and identifies a Concept', () => {
    const concept = buildConcept({
      d: 's1017',
      prefLabels: [{ value: 'Mathematik', lang: 'de' }],
      inScheme: { address: '39737:abc:schulfaecher', relay: '' }
    });
    const parsed = /** @type {any} */ (
      parseVocabEvent({ ...concept, pubkey: 'abc', created_at: 0 })
    );
    expect(parsed?.type).toBe(TYPES.CONCEPT);
    expect(parsed?.d).toBe('s1017');
  });
});
