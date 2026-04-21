import { parseConcept } from 'nostr-vocab-core/parsers';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { createReplaceableAddress } from 'applesauce-core/helpers';

/**
 * @typedef {Object} ParsedConcept
 * @property {string | undefined} d
 * @property {string} pubkey
 * @property {{ value: string, lang: string }[]} prefLabels
 * @property {string | undefined} notation
 * @property {{ address: string, relay: string }[]} broader
 */

/**
 * Convert a set of Concept events (kind CONCEPT_KIND = 39738) into
 * SKOSConcept[] with level/parentId derived from the library-parsed
 * `broader` relations, emitted in depth-first order (root alphabetical →
 * children alphabetical). This matches what `extractConceptsRecursively` in
 * `skosLoader.js` produces for the JSON path, so SKOSDropdown's tree UI
 * (indentation, collapse/expand, auto-collapse > 30) works without any
 * component changes.
 *
 * Polyhierarchy note: SKOS permits multiple broader parents. SKOSDropdown's
 * `parentId` is a single string, so we take the first broader entry per concept.
 *
 * Concepts that cannot be addressed (missing `d` tag) are dropped — their
 * coordinate would be unstable and they couldn't be referenced as a parent.
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
  /** @type {Map<string, {parsed: ParsedConcept, id: string, labels: Record<string,string>, notation?: string}>} */
  const byId = new Map();

  for (const e of events) {
    const parsed = /** @type {ParsedConcept} */ (parseConcept(e));
    // Drop concepts without a `d` tag — they have no stable address.
    if (!parsed.d) continue;

    const coord = createReplaceableAddress(CONCEPT_KIND, e.pubkey, parsed.d);
    const id = getId(e);
    coordToId.set(coord, id);
    byId.set(id, {
      parsed,
      id,
      labels: getLabels(e),
      ...(parsed.notation ? { notation: parsed.notation } : {})
    });
  }

  // id → parentId map (first broader wins). Missing parent → undefined → treated as root.
  /** @type {Map<string, string>} */
  const idToParentId = new Map();
  for (const [id, entry] of byId) {
    const firstBroader = entry.parsed.broader?.[0];
    if (!firstBroader) continue;
    const parentId = coordToId.get(firstBroader.address);
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
