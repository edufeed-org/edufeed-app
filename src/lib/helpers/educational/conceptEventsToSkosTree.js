/**
 * Convert a set of kind-39737 SKOS Concept events into SKOSConcept[] with
 * level/parentId derived from `['a', <coord>, <relay>, 'broader']` tags, emitted
 * in depth-first order (root alphabetical → children alphabetical). This matches
 * what `extractConceptsRecursively` in `skosLoader.js` produces for the JSON path,
 * so SKOSDropdown's tree UI (indentation, collapse/expand, auto-collapse > 30)
 * works without any component changes.
 *
 * Polyhierarchy note: SKOS permits multiple broader parents. SKOSDropdown's
 * `parentId` is a single string, so we take the first `broader` tag per event.
 *
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {(e: import('nostr-tools').NostrEvent) => string} getId - stable id for a concept (e.g., external URI or Nostr coord)
 * @param {(e: import('nostr-tools').NostrEvent) => Record<string,string>} getLabels - prefLabels by language
 * @param {string} locale - preferred label language for the DFS alphabetical sort
 * @returns {import('./skosLoader.js').SKOSConcept[]}
 */
export function conceptEventsToSkosTree(events, getId, getLabels, locale) {
  if (!Array.isArray(events) || events.length === 0) return [];

  // coord → id map, plus per-event index for O(1) lookup during tree walks.
  /** @type {Map<string,string>} */
  const coordToId = new Map();
  /** @type {Map<string, {event: import('nostr-tools').NostrEvent, id: string, labels: Record<string,string>, notation?: string}>} */
  const byId = new Map();

  for (const e of events) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1] || '';
    const coord = `39737:${e.pubkey}:${d}`;
    const id = getId(e);
    coordToId.set(coord, id);
    const notation = e.tags.find((t) => t[0] === 'notation')?.[1];
    byId.set(id, { event: e, id, labels: getLabels(e), ...(notation ? { notation } : {}) });
  }

  // id → parentId map (first broader wins). Missing parent → undefined → treated as root.
  /** @type {Map<string, string>} */
  const idToParentId = new Map();
  for (const [id, entry] of byId) {
    const firstBroader = entry.event.tags.find((t) => t[0] === 'a' && t[3] === 'broader');
    if (!firstBroader) continue;
    const parentId = coordToId.get(firstBroader[1]);
    if (parentId && parentId !== id) idToParentId.set(id, parentId);
  }

  // Children index: parentId → sorted children (alphabetical by preferred label).
  /** @type {Map<string, string[]>} */
  const childrenOf = new Map();
  /** @type {string[]} */
  const roots = [];
  for (const id of byId.keys()) {
    const parentId = idToParentId.get(id);
    if (parentId && byId.has(parentId)) {
      let arr = childrenOf.get(parentId);
      if (!arr) {
        arr = [];
        childrenOf.set(parentId, arr);
      }
      arr.push(id);
    } else {
      roots.push(id);
    }
  }

  /** @param {string} id */
  const labelFor = (id) => {
    const l = byId.get(id)?.labels;
    return l?.[locale] || l?.de || l?.en || (l ? Object.values(l)[0] : '') || '';
  };

  /** @param {string[]} ids */
  const sortByLabel = (ids) =>
    ids.sort((a, b) => labelFor(a).toLowerCase().localeCompare(labelFor(b).toLowerCase(), locale));

  sortByLabel(roots);
  for (const arr of childrenOf.values()) sortByLabel(arr);

  /** @type {import('./skosLoader.js').SKOSConcept[]} */
  const out = [];
  const MAX_DEPTH = 10;
  /** @type {Set<string>} */
  const emitted = new Set();

  /**
   * @param {string} id
   * @param {number} level
   */
  function visit(id, level) {
    if (emitted.has(id) || level > MAX_DEPTH) return;
    emitted.add(id);
    const entry = /** @type {NonNullable<ReturnType<typeof byId.get>>} */ (byId.get(id));
    const parentId = idToParentId.get(id);
    /** @type {import('./skosLoader.js').SKOSConcept} */
    const concept = { id, labels: entry.labels, level };
    if (parentId && byId.has(parentId)) concept.parentId = parentId;
    if (entry.notation) concept.notation = entry.notation;
    out.push(concept);
    const kids = childrenOf.get(id);
    if (kids) for (const k of kids) visit(k, level + 1);
  }

  for (const r of roots) visit(r, 0);

  // Any concept caught in a cycle (skipped by root iteration) — emit as root
  // so the user can still see/search it. This keeps the UI usable against
  // malformed vocabularies rather than silently dropping concepts.
  if (emitted.size < byId.size) {
    for (const id of byId.keys()) {
      if (emitted.has(id)) continue;
      const entry = /** @type {NonNullable<ReturnType<typeof byId.get>>} */ (byId.get(id));
      /** @type {import('./skosLoader.js').SKOSConcept} */
      const concept = { id, labels: entry.labels, level: 0 };
      if (entry.notation) concept.notation = entry.notation;
      out.push(concept);
      emitted.add(id);
    }
  }

  return out;
}
