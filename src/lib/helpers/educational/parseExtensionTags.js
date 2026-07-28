/**
 * Parse a kind-30142 event's tags into a normalized map of extension metadata,
 * grouped by namespace and facet.
 *
 * Recognizes two tag-key shapes (NIP-AMB flattening convention):
 *
 *   1. `ext:<ns>:<facet>(:<sub>)?` — forward-compatible prefixed shape.
 *      `<ns>` may itself contain colons. For form-emitted extensions
 *      `<ns>` is the form coordinate `30168:<pub>:<d>`. The facet is the
 *      single segment immediately preceding the optional sub-key
 *      (`id` / `prefLabel:<lang>` / `type`).
 *
 *   2. `ekw:<facet>(:<sub>)?` — legacy unprefixed shape emitted by the
 *      EKW wizard before the prefix migration. Treated as if it were
 *      `ext:ekw:<facet>(:<sub>)?`.
 *
 * Sub-keys:
 *   - `:id`                 → concept facet, sets the entry's URI
 *   - `:prefLabel:<lang>`   → concept facet, attaches a localized label
 *   - `:type`               → concept facet, value ignored (always 'Concept')
 *   - none (bare key)       → scalar facet; multiple tags become multiple items
 *
 * Concept entries within a facet are positionally aligned: each new `:id`
 * starts a new entry; subsequent `:prefLabel:*` / `:type` tags attach to the
 * most recent entry. This matches the emission order in `formDataToEkwTags`
 * and `formValuesToAmbJson.js` + `ambToNostr` (the amb-nostr-converter
 * serializer) (`:id`, `:prefLabel:*`, `:type` per concept).
 *
 * @typedef {{ id: string, prefLabels: Record<string, string> }} ConceptItem
 * @typedef {{ kind: 'concept', items: ConceptItem[] } | { kind: 'scalar', items: string[] }} Facet
 * @typedef {{ facets: Map<string, Facet> }} Namespace
 *
 * @param {{ tags?: string[][] | null } | null | undefined} event
 * @returns {{ namespaces: Map<string, Namespace> }}
 */
export function parseExtensionTags(event) {
  /** @type {Map<string, Namespace>} */
  const namespaces = new Map();
  const tags = event?.tags;
  if (!Array.isArray(tags)) return { namespaces };

  for (const tag of tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string') continue;
    const parsed = parseTagKey(tag[0]);
    if (!parsed) continue;
    const { ns, facet, sub } = parsed;
    const value = typeof tag[1] === 'string' ? tag[1] : '';

    let nsEntry = namespaces.get(ns);
    if (!nsEntry) {
      nsEntry = { facets: new Map() };
      namespaces.set(ns, nsEntry);
    }

    if (sub === null) {
      // Scalar
      let f = nsEntry.facets.get(facet);
      if (!f) {
        f = { kind: 'scalar', items: [] };
        nsEntry.facets.set(facet, f);
      }
      if (f.kind !== 'scalar') continue; // mixed shapes — ignore
      if (value) f.items.push(value);
    } else {
      // Concept (id / prefLabel:<lang> / type)
      let f = nsEntry.facets.get(facet);
      if (!f) {
        f = { kind: 'concept', items: [] };
        nsEntry.facets.set(facet, f);
      }
      if (f.kind !== 'concept') continue;

      if (sub === 'id') {
        if (!value) continue;
        f.items.push({ id: value, prefLabels: {} });
      } else if (sub === 'type') {
        // value ignored; presence is signal enough
      } else if (sub.startsWith('prefLabel:')) {
        const lang = sub.slice('prefLabel:'.length);
        if (!lang) continue;
        const last = f.items[f.items.length - 1];
        if (last) last.prefLabels[lang] = value;
      }
    }
  }

  // Drop any facets that ended up empty (e.g. only :type tags, no :id)
  for (const [nsName, nsEntry] of namespaces) {
    for (const [facetName, facet] of nsEntry.facets) {
      if (facet.items.length === 0) nsEntry.facets.delete(facetName);
    }
    if (nsEntry.facets.size === 0) namespaces.delete(nsName);
  }

  return { namespaces };
}

/**
 * Split a tag key into `{ ns, facet, sub }`. Returns null if the key is not a
 * recognized extension shape.
 *
 * Algorithm: split on `:`; require ≥ 2 segments. Strip the `ext:` prefix if
 * present (forward-compatible shape) — otherwise the key must start with
 * `ekw:` (legacy fallback). The trailing 1-2 segments determine the sub-key:
 *
 *   - `…:id`                 → sub = 'id', last 1 segment consumed
 *   - `…:type`               → sub = 'type', last 1 segment consumed
 *   - `…:prefLabel:<lang>`   → sub = 'prefLabel:<lang>', last 2 segments consumed
 *   - otherwise              → sub = null (scalar), no segments consumed
 *
 * Whatever remains: last segment = facet, prior segments joined by `:` = ns.
 *
 * @param {string} key
 * @returns {{ ns: string, facet: string, sub: string | null } | null}
 */
function parseTagKey(key) {
  if (!key) return null;
  const segments = key.split(':');
  if (segments.length < 2) return null;

  let body;
  if (segments[0] === 'ext') {
    body = segments.slice(1);
  } else if (segments[0] === 'ekw') {
    // Legacy: synthesize ns='ekw', the rest is the facet path
    body = segments;
  } else {
    return null;
  }

  if (body.length < 2) return null;

  // Detect optional sub at the tail
  /** @type {string | null} */
  let sub = null;
  let tail = body.length;
  const lastSeg = body[body.length - 1];
  const prevSeg = body[body.length - 2];

  if (prevSeg === 'prefLabel') {
    if (!lastSeg) return null;
    sub = `prefLabel:${lastSeg}`;
    tail = body.length - 2;
  } else if (lastSeg === 'id' || lastSeg === 'type') {
    sub = lastSeg;
    tail = body.length - 1;
  }

  if (tail < 2) return null; // need at least ns + facet

  const facet = body[tail - 1];
  const ns = body.slice(0, tail - 1).join(':');
  if (!ns || !facet) return null;

  return { ns, facet, sub };
}
