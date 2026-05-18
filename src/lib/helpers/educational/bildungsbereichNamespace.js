// src/lib/helpers/educational/bildungsbereichNamespace.js

/**
 * Namespace IRI for the Bildungsbereich NIP-32 label vocabulary.
 * Used as the 1st element of `L` and 3rd element of `l` tags on kind 30142 events
 * so the originating wizard variant can be inferred at edit-prefill time.
 */
export const BILDUNGSBEREICH_NAMESPACE_IRI = 'https://edufeed.org/ns/bildungsbereich#';

/**
 * Build the NIP-32 `L`/`l` tag pair that marks an event as authored from a
 * given Bildungsbereich variant of the resource form.
 *
 * @param {string} bildungsbereichTag - short slug, e.g. 'konfi' or 'schule'
 * @returns {string[][]}
 */
export function bildungsbereichToNip32Tags(bildungsbereichTag) {
  return [
    ['L', BILDUNGSBEREICH_NAMESPACE_IRI],
    ['l', bildungsbereichTag, BILDUNGSBEREICH_NAMESPACE_IRI]
  ];
}
