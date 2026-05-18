/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { inferBildungsbereich } from '$lib/helpers/educational/inferBildungsbereich.js';

const IRI = 'https://edufeed.org/ns/bildungsbereich#';

describe('inferBildungsbereich', () => {
  it('returns the konfi tag when the NIP-32 l tag is present', () => {
    const event = {
      tags: [
        ['L', IRI],
        ['l', 'konfi', IRI]
      ]
    };
    expect(inferBildungsbereich(event)).toBe('konfi');
  });

  it('returns schule for an l-tag with schule', () => {
    const event = { tags: [['l', 'schule', IRI]] };
    expect(inferBildungsbereich(event)).toBe('schule');
  });

  it('ignores l tags with a different namespace IRI', () => {
    const event = {
      tags: [
        ['l', 'konfi', 'metadata-form'] // bare-string namespace — not ours
      ]
    };
    expect(inferBildungsbereich(event)).toBeUndefined();
  });

  it('ignores l tags with an unknown Bildungsbereich slug', () => {
    const event = { tags: [['l', 'unknown', IRI]] };
    expect(inferBildungsbereich(event)).toBeUndefined();
  });

  it('falls back to educationalLevel inference when no l tag present', () => {
    const event = {
      tags: [['educationalLevel:id', 'https://w3id.org/kim/educationalLevel/level_1']]
    };
    expect(inferBildungsbereich(event)).toBe('schule');
  });

  it('returns undefined for events with neither signal', () => {
    expect(inferBildungsbereich({ tags: [['title', 'x']] })).toBeUndefined();
  });
});
