/**
 * Parse a kind-30142 event's tags into a normalized map of extension metadata,
 * grouped by namespace and facet.
 *
 * Implements the normative NIP-AMB ext-key grammar (see `nips/AMB.md`):
 *
 *   ext-key = "ext" ":" ns ":" facet [ ":" sub ]
 *   sub     = "id" / "type" / "name" / "prefLabel" ":" lang
 *
 * `<ns>` and `<facet>` MUST NOT contain `:` (`.` is permitted; reverse-DNS is
 * RECOMMENDED), so keys are parsed **left-anchored with fixed arity** and a key
 * that falls outside the grammar is ignored outright, never guessed at. See
 * `parseTagKey` for the details and for why surplus-segment keys such as the
 * legacy `ext:ekw:konfi:<slug>:id` are dropped rather than mis-bucketed.
 *
 * Also recognizes the legacy unprefixed `ekw:<facet>(:<sub>)?` shape emitted by
 * the EKW wizard before the prefix migration — treated as `ns = 'ekw'`.
 *
 * Sub-keys:
 *   - `:id`                 → concept facet, sets the entry's URI
 *   - `:prefLabel:<lang>`   → concept facet, attaches a localized label
 *   - `:name`               → concept facet, attaches a plain name
 *   - `:type`               → concept facet, value ignored (always 'Concept')
 *   - none (bare key)       → scalar facet; multiple tags become multiple items
 *
 * Concept entries within a facet are positionally aligned: each new `:id`
 * starts a new entry; subsequent `:prefLabel:*` / `:name` / `:type` tags attach
 * to the most recent entry. This matches the emission order of `ambToNostr`
 * (the amb-nostr-converter serializer): `:id`, `:prefLabel:*`, `:type` per
 * concept.
 *
 * KNOWN LIMITATION — mixed facets. A facet is resolved to a single `kind` by
 * whichever tag is seen first, and later tags of the other kind are skipped. So
 * a facet carrying both concepts and free-text scalars loses one half, and
 * which half depends on tag order. `ambToNostr` emits exactly this shape for an
 * `amb.ext` facet whose array mixes `Concept` objects and plain strings — which
 * is how the Konfi "custom value alongside vocabulary picks" case now
 * serializes. Corpus impact today is one event (a single `zeitstruktur:custom`
 * key, 8,476 kind-30142 events scanned 2026-07-29), and the wizard edit path is
 * unaffected because `parseKonfiTags` reads the bare tag itself — this only
 * affects the read-only extension sections on the resource view. Fixing it
 * means widening the `Facet` union, which `extensionMetadata.js` switches on;
 * deliberately left out of the grammar fix to keep that change reviewable.
 *
 * @typedef {{ id: string, prefLabels: Record<string, string>, name?: string }} ConceptItem
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
      } else if (sub === 'name') {
        // `name` is in the NIP's closed sub set, so parseTagKey accepts it —
        // give it an explicit branch rather than letting it fall through and
        // vanish. Like prefLabel, it attaches to the concept opened by the
        // preceding `:id`. Unlike amb-nostr-converter's `reconstructExt`, a
        // name with no open concept is dropped instead of starting an id-less
        // entry: items here are keyed on `id` and consumers assume it. No
        // `ext:*:*:name` tag exists in the corpus today (0 of 8476 events
        // scanned 2026-07-29), so this branch is currently unreachable.
        const last = f.items[f.items.length - 1];
        if (last && value) last.name = value;
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
 * Implements the normative NIP-AMB grammar (see `nips/AMB.md`):
 *
 *   ext-key = "ext" ":" ns ":" facet [ ":" sub ]
 *   sub     = "id" / "type" / "name" / "prefLabel" ":" lang
 *
 * `ns` and `facet` MUST NOT contain `:` — so the key is parsed **left-anchored
 * with fixed arity**: `ns` and `facet` are the first two segments after the
 * prefix, and everything after them is the sub. A key whose sub falls outside
 * the closed set is returned as null and MUST be ignored by the caller — it is
 * never guessed at. Surplus-segment keys such as the legacy
 * `ext:ekw:konfi:<slug>:id` are exactly this case: their two possible
 * segmentations (`ns=ekw,facet=konfi` vs `ns=ekw:konfi,facet=<slug>`) are
 * indistinguishable, so they are dropped rather than mis-bucketed. They are
 * migrated to `ext:org.edufeed.ekw.konfi:<slug>:id` by
 * `scripts/migrate-konfi-namespace.mjs`; there is deliberately no read shim.
 *
 * The legacy unprefixed `ekw:` shape keeps ns='ekw' and is parsed the same way.
 *
 * @param {string} key
 * @returns {{ ns: string, facet: string, sub: string | null } | null}
 */
function parseTagKey(key) {
  if (!key) return null;
  const segments = key.split(':');

  let offset;
  if (segments[0] === 'ext') {
    offset = 1;
  } else if (segments[0] === 'ekw') {
    // Legacy unprefixed shape: ns is the literal 'ekw' at index 0.
    offset = 0;
  } else {
    return null;
  }

  const ns = segments[offset];
  const facet = segments[offset + 1];
  if (!ns || !facet) return null;

  const rest = segments.slice(offset + 2).join(':');
  if (rest === '') return { ns, facet, sub: null }; // bare scalar

  const legal =
    rest === 'id' ||
    rest === 'type' ||
    rest === 'name' ||
    (rest.startsWith('prefLabel:') && rest.slice('prefLabel:'.length) !== '');
  if (!legal) return null;

  return { ns, facet, sub: rest };
}
