import { EKW_KONFI_NS } from './ekwNamespace.js';
import { BILDUNGSBEREICHE } from './bildungsbereich.js';

/**
 * @typedef {{ id: string, label: string }} ConceptLabel
 * @typedef {{ id: string, type: 'Concept', prefLabel: Record<string, string> }} Concept
 */

/**
 * Build a `Concept` per id from a flat `{id, label}` label list, keyed by id.
 *
 * Both the EKW facets (`formDataToEkwTags.js`) and the Konfi facets
 * (`formDataToKonfiTags.js`) read this exact shape from formData — neither
 * carries more than one language today (both are German-only wizard
 * pickers) — so a single label lookup covers both callers. If a genuinely
 * multi-language label source is ever added, this is the seam to extend:
 * `prefLabel` is already forwarded verbatim rather than hardcoding a `de`
 * property name.
 *
 * @param {string[] | undefined} ids
 * @param {ConceptLabel[] | undefined} labels
 * @returns {Concept[]}
 */
function conceptsFromFlatLabels(ids, labels) {
  if (!ids || ids.length === 0) return [];
  const labelById = new Map((labels || []).map((l) => [l.id, l.label]));
  return ids.map((id) => {
    const label = labelById.get(id);
    /** @type {Record<string, string>} */
    const prefLabel = label ? { de: label } : {};
    return { id, type: /** @type {const} */ ('Concept'), prefLabel };
  });
}

/**
 * Build the `ekw` ext namespace facets. Mirrors the field access of
 * `formDataToEkwTags.js` (same formData fields, same semantics) but produces
 * Concept objects / string arrays instead of flattened tag pairs.
 *
 * @param {Record<string, any>} formData
 * @returns {Record<string, Concept[] | string[]>}
 */
function buildEkwFacets(formData) {
  /** @type {Record<string, Concept[] | string[]>} */
  const facets = {};

  /**
   * @param {string} facet
   * @param {string[] | undefined} ids
   * @param {ConceptLabel[] | undefined} labels
   */
  function addConceptFacet(facet, ids, labels) {
    const concepts = conceptsFromFlatLabels(ids, labels);
    if (concepts.length > 0) facets[facet] = concepts;
  }

  addConceptFacet('gradeLevel', formData.gradeLevels, formData.gradeLevelLabels);
  addConceptFacet('schoolType', formData.schoolTypes, formData.schoolTypeLabels);
  addConceptFacet('didacticConcept', formData.didacticConcepts, formData.didacticConceptLabels);
  addConceptFacet('method', formData.methods, formData.methodLabels);

  const otherLines = /** @type {string} */ (formData.methodOther || '')
    .split(/\r?\n/)
    .map((/** @type {string} */ s) => s.trim())
    .filter(Boolean);
  if (otherLines.length > 0) facets.methodOther = otherLines;

  const refs = /** @type {string[]} */ (formData.bibleReferences || [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (refs.length > 0) facets.bibleReference = refs;

  return facets;
}

/**
 * Build the Konfi ext namespace facets, keyed by the bare `tagSlug` (e.g.
 * `zielgruppen`, `themen`) — no `konfi:` segment, since that's the illegal
 * shape this task fixes (the namespace carries the `konfi` marker instead,
 * see `EKW_KONFI_NS`).
 *
 * Walks the same `step4SubSteps` config `formDataToKonfiTags.js` walks, and
 * reads the same `<schemeKey>Ids` / `<schemeKey>Labels` / `<schemeKey>Custom`
 * / `<tagSlug>` formData fields it reads.
 *
 * @param {Record<string, any>} formData
 * @returns {Record<string, Array<Concept | string>>}
 */
function buildKonfiFacets(formData) {
  const subSteps = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];
  /** @type {Record<string, Array<Concept | string>>} */
  const facets = {};

  for (const step of subSteps) {
    for (const field of step.fields) {
      if (field.kind === 'vocab') {
        const ids = formData[`${field.schemeKey}Ids`];
        const labels = formData[`${field.schemeKey}Labels`];
        const concepts = conceptsFromFlatLabels(ids, labels);
        if (concepts.length > 0) {
          facets[field.tagSlug] = [...(facets[field.tagSlug] || []), ...concepts];
        }
        if (field.allowCustom) {
          const custom = formData[`${field.schemeKey}Custom`];
          if (typeof custom === 'string' && custom.trim() !== '') {
            facets[field.tagSlug] = [...(facets[field.tagSlug] || []), custom];
          }
        }
      } else {
        const value = formData[field.tagSlug];
        if (value === undefined || value === null || value === false) continue;
        const str = typeof value === 'boolean' ? 'true' : String(value);
        if (str.trim() === '') continue;
        facets[field.tagSlug] = [str];
      }
    }
  }

  return facets;
}

/**
 * Build the NIP-AMB `ext` object from wizard formData, covering the EKW and
 * Konfi facet sets. Two namespaces:
 *   - `ekw` — non-Konfi EKW facets (gradeLevel, schoolType, didacticConcept,
 *     method, methodOther, bibleReference)
 *   - `EKW_KONFI_NS` (`org.edufeed.ekw.konfi`) — Konfi facets keyed by bare
 *     tagSlug (zielgruppen, themen, …)
 *
 * Conformance: the legacy hand-appended shape emitted `ext:ekw:konfi:<slug>:id`,
 * an illegal key (facet segment contains `:`, plus a disallowed 5th segment).
 * Putting `konfi` in the namespace instead keeps every emitted key to the
 * legal `ext:<ns>:<facet>[:sub]` grammar.
 *
 * @param {Record<string, any>} formData
 * @returns {Record<string, Record<string, Array<Concept | string>>> | undefined}
 */
export function formDataToAmbExt(formData) {
  if (!formData) return undefined;

  const ekw = buildEkwFacets(formData);
  const konfi = buildKonfiFacets(formData);

  const hasEkw = Object.keys(ekw).length > 0;
  const hasKonfi = Object.keys(konfi).length > 0;
  if (!hasEkw && !hasKonfi) return undefined;

  /** @type {Record<string, Record<string, Array<Concept | string>>>} */
  const ext = {};
  if (hasEkw) ext.ekw = ekw;
  if (hasKonfi) ext[EKW_KONFI_NS] = konfi;
  return ext;
}
