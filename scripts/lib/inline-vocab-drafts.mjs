/**
 * Build an inline vocab into scheme + concept drafts (no network, no SKOS parse).
 *
 * Supports optional `children` arrays on concepts for hierarchical schemes:
 *   - top-level concepts get `topConceptOf` set to the scheme address
 *   - children get `broader: [<parent concept address>]`
 *   - parents get `narrower: [<child concept addresses>]`
 *
 * @param {{ d: string, source: { type: string, prefLabels?: any[], descriptions?: any[], concepts?: any[] } }} scheme
 * @param {string} pubkey
 * @param {string} relayHint
 */
export function buildInlineDrafts(scheme, pubkey, relayHint) {
  const schemeAddress = `39737:${pubkey}:${scheme.d}`;
  const inScheme = { address: schemeAddress, relay: relayHint };
  const topConceptOf = { address: schemeAddress, relay: relayHint };

  /** @type {any[]} */
  const concepts = [];
  for (const c of scheme.source.concepts || []) {
    concepts.push({
      d: c.d,
      prefLabels: c.prefLabels || [],
      altLabels: c.altLabels || [],
      definitions: c.definitions || [],
      externalUri: c.externalUri,
      inScheme,
      topConceptOf,
      broader: [],
      narrower: []
    });
  }

  return {
    scheme: {
      d: scheme.d,
      prefLabels: scheme.source.prefLabels || [{ value: scheme.d, lang: 'en' }],
      descriptions: scheme.source.descriptions || []
    },
    concepts
  };
}
