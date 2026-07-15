/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  BILDUNGSBEREICHE,
  BILDUNGSBEREICH_KEYS
} from '$lib/helpers/educational/bildungsbereich.js';
import { inferBildungsbereich } from '$lib/helpers/educational/inferBildungsbereich.js';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from '$lib/helpers/educational/bildungsbereichNamespace.js';

describe('Bildungsbereich NIP-32 tag coverage', () => {
  it('every Bildungsbereich declares a bildungsbereichTag so edit-mode prefill never depends on educationalLevel inference', () => {
    for (const key of BILDUNGSBEREICH_KEYS) {
      expect(
        BILDUNGSBEREICHE[key].bildungsbereichTag,
        `missing bildungsbereichTag for '${key}'`
      ).toBe(key);
    }
  });

  it('round-trips every key through the NIP-32 l tag', () => {
    for (const key of BILDUNGSBEREICH_KEYS) {
      const event = {
        tags: [
          ['L', BILDUNGSBEREICH_NAMESPACE_IRI],
          ['l', BILDUNGSBEREICHE[key].bildungsbereichTag ?? '', BILDUNGSBEREICH_NAMESPACE_IRI]
        ]
      };
      expect(inferBildungsbereich(event)).toBe(key);
    }
  });
});
