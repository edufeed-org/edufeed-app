// extensionMetadata.js
// ---------------------
// Pure transforms turning a kind-30142 event's `ext:<ns>:<facet>` tags into the
// editorial card model rendered by MetadataCardGrid. Label resolution mirrors
// ExtensionMetadataPanel's old priority order (form-driven → registered variant
// → namespace registry → humanized fallback) but is side-effect free: the
// async form lookup (kind 30168) is done by the caller, which passes the
// resolved `formEvent` in. That keeps every label/icon/wrap decision unit
// testable without a relay or an effect.

import { parseExtensionTags } from './parseExtensionTags.js';
import { getFormReferenceFromResource } from './formReference.js';
import { parseFormTemplate } from '../forms.js';
import { toDieBibelUrl } from './bibleReference.js';
import { ALL_VARIANTS, EXTENSION_NAMESPACE_LABELS } from '$lib/config/resource-form-variants.js';
import * as m from '$lib/paraglide/messages.js';

// Registered-variant labels keyed by namespace id (e.g. "ekw").
const variantLabelsByNs = new Map(
  ALL_VARIANTS.filter((v) => v.extensionLabels).map((v) => [v.id, v.extensionLabels])
);

/**
 * @typedef {{ facetName: string, label: string, kind: 'concept' | 'scalar' | 'mixed', concepts: any[], scalars: string[] }} ExtensionFacet
 * @typedef {{ ns: string, sectionLabel: string, facets: ExtensionFacet[] }} ExtensionSection
 */

/**
 * Resolve the section + per-facet labels for every extension namespace on a
 * resource. Pure: pass the already-loaded 30168 form event (or null).
 *
 * Section/facet label resolution is locale-independent (paraglide message keys
 * resolve against the active locale at call time); the concept item labels are
 * localized later in buildExtensionCards.
 *
 * @param {{ tags?: string[][] | null } | null | undefined} event
 * @param {any} formEvent  Resolved kind-30168 form event, or null.
 * @returns {ExtensionSection[]}
 */
export function buildExtensionSections(event, formEvent) {
  const parsed = parseExtensionTags(event ?? null);
  const formRef = event ? getFormReferenceFromResource(/** @type {any} */ (event)) : null;
  const formCoord = parseFormCoord(formRef?.address);

  /** @type {Record<string, string>} */
  const formFieldLabels = {};
  if (formEvent) {
    try {
      const template = parseFormTemplate(formEvent);
      for (const f of template.fields) formFieldLabels[f.id] = f.label || f.id;
    } catch {
      // malformed form template — fall back to registry/humanize labels
    }
  }

  /** @type {ExtensionSection[]} */
  const out = [];
  for (const [ns, nsEntry] of parsed.namespaces) {
    // Form-emitted ext uses the form's bare `d`-tag as <ns> (colon-free per the
    // NIP-AMB grammar); the form author's pubkey lives in the `a` back-ref, not
    // in the tag key. This previously compared against the full
    // `30168:<pub>:<d>` coordinate, which is not a legal <ns> and no longer
    // survives parseExtensionTags.
    const isFormDriven = !!formCoord && ns === formCoord.identifier;
    const nsLabels = EXTENSION_NAMESPACE_LABELS[ns] ?? variantLabelsByNs.get(ns);

    const sectionLabel = isFormDriven
      ? formEvent
        ? readFormName(formEvent, formCoord)
        : humanize(ns)
      : nsLabels?.sectionKey
        ? translate(nsLabels.sectionKey)
        : humanize(ns);

    /** @type {ExtensionFacet[]} */
    const facets = [];
    for (const [facetName, facet] of nsEntry.facets) {
      let label;
      if (isFormDriven && formFieldLabels[facetName]) {
        label = formFieldLabels[facetName];
      } else if (nsLabels?.facets?.[facetName]) {
        label = translate(nsLabels.facets[facetName]);
      } else {
        label = humanize(facetName);
      }
      facets.push({
        facetName,
        label,
        kind: facet.kind,
        concepts: facet.concepts,
        scalars: facet.scalars
      });
    }
    if (facets.length > 0) out.push({ ns, sectionLabel, facets });
  }
  return out;
}

/**
 * @typedef {Object} MetadataCard
 * @property {string} key
 * @property {string} iconKey  Registry key resolved to an icon by MetadataCardGrid.
 * @property {string} label
 * @property {string} [chip]   Provenance chip text (extension cards only).
 * @property {boolean} [wide]  Spans two grid columns for long values.
 * @property {string} [value]  Plain display value (concept join / boolean tick).
 * @property {string} [valueMuted]  Muted suffix after the value (e.g. fallback-language hint).
 * @property {{ text: string, href?: string, long?: boolean }[]} [scalars]  Per-item scalar values.
 */

/**
 * Flatten resolved extension sections into editorial cards. Each extension card
 * carries a provenance `chip` derived from its section label.
 *
 * @param {ExtensionSection[]} sections
 * @param {string} locale
 * @returns {MetadataCard[]}
 */
export function buildExtensionCards(sections, locale) {
  /** @type {MetadataCard[]} */
  const cards = [];
  for (const section of sections) {
    const chip = deriveChipLabel(section.sectionLabel);
    for (const facet of section.facets) {
      const bool = booleanFacetValue(facet);
      if (bool === false) continue; // a disabled flag is not a fact
      const key = `${section.ns}:${facet.facetName}`;

      if (bool === true) {
        cards.push({ key, iconKey: 'check', label: facet.label, chip, value: '✓' });
        continue;
      }

      if (facet.kind === 'concept') {
        const value = facet.concepts
          .map((it) => pickLabel(it, locale))
          .filter(Boolean)
          .join(', ');
        cards.push({
          key,
          iconKey: extensionFacetIconKey(facet.facetName),
          label: facet.label,
          chip,
          value,
          wide: value.length > 40
        });
      } else {
        // Scalar or mixed. A mixed facet (vocabulary picks *and* a free-text
        // custom value — see `formDataToAmbExt.buildKonfiFacets`) renders both
        // halves through the scalar stack, concept labels first, so nothing is
        // dropped. MetadataCardGrid renders `scalars` in place of `value`, so
        // the two cannot be combined on one card; a stacked list is the shape
        // that shows everything without touching the component.
        const conceptLabels =
          facet.kind === 'mixed'
            ? facet.concepts.map((it) => pickLabel(it, locale)).filter(Boolean)
            : [];
        const scalars = [...conceptLabels, ...facet.scalars]
          .filter(Boolean)
          .map((/** @type {string} */ v) => {
            const href = toDieBibelUrl(v) ?? undefined;
            return { text: v, href, long: !href && (v.includes('\n') || v.length > 40) };
          });
        const totalLen = scalars.reduce((n, s) => n + s.text.length, 0);
        cards.push({
          key,
          iconKey: extensionFacetIconKey(facet.facetName),
          label: facet.label,
          chip,
          scalars,
          wide: totalLen > 40 || scalars.some((s) => s.long)
        });
      }
    }
  }
  return cards;
}

// Known extension facets → semantic icon registry key. Everything else gets the
// neutral "tag" fallback (never the old lightning bolt).
const FACET_ICON_KEYS = /** @type {Record<string, string>} */ ({
  gradelevel: 'klassenstufe',
  klassenstufe: 'klassenstufe',
  schooltype: 'schulart',
  schulart: 'schulart',
  didacticconcept: 'didaktKonzept',
  didaktischeskonzept: 'didaktKonzept',
  didaktik: 'didaktKonzept',
  method: 'methode',
  methode: 'methode',
  methods: 'methode',
  methodother: 'methode',
  biblereference: 'bibelstelle',
  bibelstelle: 'bibelstelle',
  bibelstellen: 'bibelstelle'
});

/**
 * Map an extension facet id to a MetadataCardGrid icon key.
 * @param {string} facetName
 * @returns {string}
 */
export function extensionFacetIconKey(facetName) {
  return FACET_ICON_KEYS[String(facetName ?? '').toLowerCase()] ?? 'tag';
}

/**
 * Compact provenance chip text from a section label: strips a trailing
 * "Metadaten" / "Metadata" word so "EKKW-Metadaten" → "EKKW".
 * @param {string} sectionLabel
 * @returns {string}
 */
export function deriveChipLabel(sectionLabel) {
  const s = String(sectionLabel ?? '').trim();
  const stripped = s.replace(/[\s-]*Metadat(?:en|a)$/i, '').trim();
  return stripped || s;
}

/**
 * Classify a scalar facet as a boolean (single 'true' / 'false' value). A mixed
 * facet is never a boolean — it carries concepts too.
 * @param {{ kind: string, scalars: string[] }} facet
 * @returns {boolean | null}
 */
function booleanFacetValue(facet) {
  if (facet.kind !== 'scalar') return null;
  if (facet.scalars.length !== 1) return null;
  const v = facet.scalars[0];
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/**
 * @param {{ id?: string, prefLabels?: Record<string, string> }} item
 * @param {string} locale
 */
function pickLabel(item, locale) {
  const p = item?.prefLabels ?? {};
  return p[locale] || p.de || p.en || Object.values(p)[0] || item?.id || '';
}

/**
 * @param {string | undefined} address  e.g. "30168:<pub>:<d>"
 * @returns {{ pubkey: string, identifier: string } | null}
 */
function parseFormCoord(address) {
  if (!address) return null;
  const parts = address.split(':');
  if (parts.length < 3 || parts[0] !== '30168') return null;
  return { pubkey: parts[1], identifier: parts.slice(2).join(':') };
}

/**
 * @param {any} ev
 * @param {{ identifier: string } | null} formCoord
 */
function readFormName(ev, formCoord) {
  const tags = Array.isArray(ev?.tags) ? ev.tags : [];
  return (
    tags.find((/** @type {any} */ t) => t[0] === 'name')?.[1] ||
    humanize(formCoord?.identifier ?? '')
  );
}

/**
 * "someFieldId" / "some-field-id" / "30168:abc:my-form" → Title Case.
 * @param {string} s
 */
function humanize(s) {
  if (!s) return '';
  return s
    .replace(/^30168:/, '')
    .replace(/[-_:]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Paraglide message lookup by key; humanized fallback if the key is missing.
 * @param {string} key
 */
function translate(key) {
  /** @type {any} */
  const fn = /** @type {Record<string, any>} */ (m)[key];
  if (typeof fn === 'function') return fn();
  return humanize(key);
}
