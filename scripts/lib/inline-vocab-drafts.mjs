/**
 * Build an inline vocab into scheme + concept drafts (no network, no SKOS parse).
 *
 * Mechanical extraction of the helper formerly defined inline in
 * `scripts/publish-edufeed-vocabs.mjs`. Behavior preserved exactly:
 * concepts get `inScheme` only; hierarchy fields (`topConceptOf`,
 * `broader`, `narrower`) are added by Task 2 once `children` support
 * lands.
 *
 * @param {{ d: string, source: { type: string, prefLabels?: any[], descriptions?: any[], concepts?: any[] } }} scheme
 * @param {string} pubkey
 * @param {string} relayHint
 */
export function buildInlineDrafts(scheme, pubkey, relayHint) {
  const schemeAddress = `39737:${pubkey}:${scheme.d}`;
  const inScheme = { address: schemeAddress, relay: relayHint };
  const concepts = (scheme.source.concepts || []).map((c) => ({
    d: c.d,
    prefLabels: c.prefLabels || [],
    altLabels: c.altLabels || [],
    definitions: c.definitions || [],
    externalUri: c.externalUri,
    inScheme
  }));
  return {
    scheme: {
      d: scheme.d,
      prefLabels: scheme.source.prefLabels || [{ value: scheme.d, lang: 'en' }],
      descriptions: scheme.source.descriptions || []
    },
    concepts
  };
}
