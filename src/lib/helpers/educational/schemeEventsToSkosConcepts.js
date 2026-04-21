import { parseConceptScheme } from 'nostr-vocab-core/parsers';
import { VOCAB_KIND } from 'nostr-vocab-core/constants';
import { createReplaceableAddress } from 'applesauce-core/helpers';

/**
 * @typedef {Object} ParsedScheme
 * @property {string | undefined} d
 * @property {string} pubkey
 * @property {number | null} publishedAt
 * @property {{ value: string, lang: string }[]} prefLabels
 */

/**
 * Fold a library-parsed `prefLabels: [{value, lang}]` array into the
 * `Record<string,string>` shape SKOSDropdown expects.
 * @param {{ value: string, lang: string }[]} prefLabels
 * @returns {Record<string,string>}
 */
function prefLabelsToMap(prefLabels) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const { value, lang } of prefLabels || []) {
    if (value && lang) out[lang] = value;
  }
  return out;
}

/**
 * Flatten a set of ConceptScheme events (kind VOCAB_KIND = 39737) into
 * SKOSConcept[] for consumption by SKOSDropdown. Filters out anything that is
 * not a ConceptScheme (post-split concepts/collections live on different kinds;
 * pre-split events are guarded by a `type === 'ConceptScheme'` check on the
 * parsed output). Each scheme becomes a root-level item. `notation` is set
 * to the `d`-tag so SKOSDropdown renders it inline beside the label — useful
 * for distinguishing e.g. `schulfaecher` vs `hochschulfaecher`.
 *
 * **Draft filter:** schemes whose parsed `publishedAt` is null/falsy are
 * skipped. This is an app-level convention established by `nocabs` (the
 * vocab-authoring app) — unpublished drafts are not surfaced in pickers so
 * form authors only bind `field-vocab` to stable, published taxonomies.
 *
 * prefLabels are preserved by language; the caller's locale drives the
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
    // Post-split: only kind VOCAB_KIND is a ConceptScheme. Anything else
    // (concepts on 39738, collections on 39739) falls out here.
    if (e.kind !== VOCAB_KIND) continue;

    const parsed = /** @type {ParsedScheme} */ (parseConceptScheme(e));

    // Pre-split legacy guard: a kind-39737 event with `type: Concept` or
    // `type: Collection` tag is not a scheme. Library's parseConceptScheme
    // parses any kind-39737 event blindly, so we re-assert the type here.
    const typeTag = e.tags.find((t) => t[0] === 'type')?.[1];
    if (typeTag && typeTag !== 'ConceptScheme') continue;

    // Skip drafts — parsed.publishedAt is null/NaN when unpublished.
    if (!parsed.publishedAt) continue;
    if (!parsed.d) continue;

    const labels = prefLabelsToMap(parsed.prefLabels);
    if (Object.keys(labels).length === 0) labels[locale] = parsed.d;

    out.push({
      id: createReplaceableAddress(VOCAB_KIND, parsed.pubkey, parsed.d),
      labels,
      level: 0,
      notation: parsed.d
    });
  }

  /** @param {import('./skosLoader.js').SKOSConcept} c */
  const labelFor = (c) =>
    c.labels?.[locale] || c.labels?.de || c.labels?.en || Object.values(c.labels ?? {})[0] || '';

  out.sort((a, b) => labelFor(a).toLowerCase().localeCompare(labelFor(b).toLowerCase(), locale));

  return out;
}

/**
 * Pick the best-matching `['prefLabel', value, lang]` tag value for a given
 * locale. Uses the same fallback chain as `schemeEventsToSkosConcepts`
 * (`locale → de → en → first`), falling back to the d-tag so the caller
 * always has something to display. Returns '' only if the event has no
 * prefLabel *and* no d-tag.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} locale
 * @returns {string}
 */
export function pickSchemeLabel(event, locale) {
  if (!event?.tags) return '';

  /** @type {Record<string,string>} */
  const byLang = {};
  for (const t of event.tags) {
    if (t[0] === 'prefLabel' && t[1] && t[2]) byLang[t[2]] = t[1];
  }

  const fromLabel = byLang[locale] || byLang.de || byLang.en || Object.values(byLang)[0];
  if (fromLabel) return fromLabel;

  return event.tags.find((t) => t[0] === 'd')?.[1] || '';
}

/**
 * Pick the best-matching `['description', value, lang]` tag value for a given
 * locale. Uses the same fallback chain as labels (`locale → de → en → first`).
 * Returns '' when the scheme has no usable description tag.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} locale
 * @returns {string}
 */
export function pickSchemeDescription(event, locale) {
  if (!event?.tags) return '';

  /** @type {Record<string,string>} */
  const byLang = {};
  for (const t of event.tags) {
    if (t[0] === 'description' && t[1] && t[2]) byLang[t[2]] = t[1];
  }

  return byLang[locale] || byLang.de || byLang.en || Object.values(byLang)[0] || '';
}
