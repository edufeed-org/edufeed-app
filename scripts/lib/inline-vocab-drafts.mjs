/**
 * Build an inline vocab into scheme + concept drafts (no network, no SKOS parse).
 *
 * Supports optional `children` arrays on top-level concepts for
 * hierarchical schemes:
 *   - top-level concepts get `topConceptOf` set to the scheme address
 *   - children get `broader: [<parent concept address>]`
 *   - parents get `narrower: [<child concept addresses>]`
 *   - children intentionally omit `topConceptOf`
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

  for (const top of scheme.source.concepts || []) {
    const children = top.children || [];
    const narrower = children.map((ch) => ({
      address: `39738:${pubkey}:${ch.d}`,
      relay: relayHint
    }));
    concepts.push({
      d: top.d,
      prefLabels: top.prefLabels || [],
      altLabels: top.altLabels || [],
      definitions: top.definitions || [],
      externalUri: top.externalUri,
      inScheme,
      topConceptOf,
      broader: [],
      narrower
    });
    const broader = [{ address: `39738:${pubkey}:${top.d}`, relay: relayHint }];
    for (const ch of children) {
      concepts.push({
        d: ch.d,
        prefLabels: ch.prefLabels || [],
        altLabels: ch.altLabels || [],
        definitions: ch.definitions || [],
        externalUri: ch.externalUri,
        inScheme,
        broader,
        narrower: []
      });
    }
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
