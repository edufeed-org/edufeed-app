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
 * MIXED FACETS. A facet may carry both concepts and free-text scalars at once —
 * `ambToNostr` emits exactly that for an `amb.ext` facet whose array mixes
 * `Concept` objects and plain strings, which is how the Konfi "custom value
 * alongside vocabulary picks" case serializes (concept triples first, then a
 * bare `ext:<ns>:<facet>` tag for the custom string). Both halves are kept:
 * `concepts` and `scalars` are separate arrays and `kind` is derived from which
 * of them are populated. This mirrors the reference implementation in
 * `nostrlib/eventstore/typesense30142/nostr_amb.go`, which accumulates concept
 * instances and scalars independently and concatenates them — keeping the two
 * readers from drifting apart again.
 *
 * @typedef {{ id: string, prefLabels: Record<string, string>, name?: string }} ConceptItem
 * @typedef {{ kind: 'concept' | 'scalar' | 'mixed', concepts: ConceptItem[], scalars: string[] }} Facet
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

    let f = nsEntry.facets.get(facet);
    if (!f) {
      f = { kind: 'scalar', concepts: [], scalars: [] };
      nsEntry.facets.set(facet, f);
    }

    if (sub === null) {
      // Scalar (bare `ext:<ns>:<facet>` tag) — one item per tag, in tag order.
      if (value) f.scalars.push(value);
    } else {
      // Concept (id / prefLabel:<lang> / type / name)
      if (sub === 'id') {
        if (!value) continue;
        f.concepts.push({ id: value, prefLabels: {} });
      } else if (sub === 'type') {
        // value ignored; presence is signal enough
      } else if (sub === 'name') {
        // `name` is in the NIP's closed sub set, so parseTagKey accepts it —
        // give it an explicit branch rather than letting it fall through and
        // vanish. Like prefLabel, it attaches to the concept opened by the
        // preceding `:id`. Unlike amb-nostr-converter's `reconstructExt`, a
        // name with no open concept is dropped instead of starting an id-less
        // entry: concepts here are keyed on `id` and consumers assume it. No
        // `ext:*:*:name` tag exists in the corpus today (0 of 8476 events
        // scanned 2026-07-29), so this branch is currently unreachable.
        const last = f.concepts[f.concepts.length - 1];
        if (last && value) last.name = value;
      } else if (sub.startsWith('prefLabel:')) {
        const lang = sub.slice('prefLabel:'.length);
        if (!lang) continue;
        const last = f.concepts[f.concepts.length - 1];
        if (last) last.prefLabels[lang] = value;
      }
    }
  }

  // Derive `kind` from what actually landed, and drop facets that ended up
  // empty (e.g. only `:type` tags, no `:id`).
  for (const [nsName, nsEntry] of namespaces) {
    for (const [facetName, facet] of nsEntry.facets) {
      if (facet.concepts.length === 0 && facet.scalars.length === 0) {
        nsEntry.facets.delete(facetName);
        continue;
      }
      facet.kind =
        facet.concepts.length > 0 && facet.scalars.length > 0
          ? 'mixed'
          : facet.concepts.length > 0
            ? 'concept'
            : 'scalar';
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
