/**
 * Flatten a set of kind-39737 ConceptScheme events into SKOSConcept[] for
 * consumption by SKOSDropdown. Filters out Concept and Collection events so
 * only schemes surface; each scheme becomes a root-level item. `notation` is
 * set to the `d`-tag so SKOSDropdown renders it inline beside the label —
 * useful for distinguishing e.g. `schulfaecher` vs `hochschulfaecher`.
 *
 * prefLabels are preserved by language; the callers' locale drives the
 * alphabetical sort (via locale → de → en → first-label fallback) so the
 * picker reads top-to-bottom in the user's preferred language.
 *
 * If a scheme carries no `prefLabel` tag, its d-tag is used as a single
 * fallback label keyed by the current locale so the row is still identifiable.
 *
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {string} locale
 * @returns {import('./skosLoader.js').SKOSConcept[]}
 */
export function schemeEventsToSkosConcepts(events, locale) {
  if (!Array.isArray(events) || events.length === 0) return [];

  /** @type {import('./skosLoader.js').SKOSConcept[]} */
  const out = [];

  for (const e of events) {
    const isScheme = e.tags.some((t) => t[0] === 'type' && t[1] === 'ConceptScheme');
    if (!isScheme) continue;

    const d = e.tags.find((t) => t[0] === 'd')?.[1] || '';

    /** @type {Record<string,string>} */
    const labels = {};
    for (const t of e.tags) {
      if (t[0] === 'prefLabel' && t[1] && t[2]) labels[t[2]] = t[1];
    }
    if (Object.keys(labels).length === 0 && d) labels[locale] = d;

    out.push({
      id: `39737:${e.pubkey}:${d}`,
      labels,
      level: 0,
      notation: d
    });
  }

  /** @param {import('./skosLoader.js').SKOSConcept} c */
  const labelFor = (c) =>
    c.labels?.[locale] || c.labels?.de || c.labels?.en || Object.values(c.labels ?? {})[0] || '';

  out.sort((a, b) => labelFor(a).toLowerCase().localeCompare(labelFor(b).toLowerCase(), locale));

  return out;
}
