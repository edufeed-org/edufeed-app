/**
 * Resource form variant registry.
 *
 * A "variant" is a named metadata-form path (e.g. AMB-Bildungsmaterial vs.
 * EKW-Bildungsmaterial). Phase 1: variants share the same wizard and fields;
 * they differ only by `id` (used for the route segment and the NIP-32
 * `metadata-form` label on published events) and their picker-modal i18n keys.
 *
 * The flat array below is the source of truth. Add a new variant by:
 *   1. Adding an entry to ALL_VARIANTS
 *   2. Adding the two Paraglide source messages (label + description)
 *   3. Including the id in RESOURCE_FORM_VARIANTS in .env for deployments that
 *      should expose it.
 */

import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { BILDUNGSBEREICH_KEYS } from '$lib/helpers/educational/bildungsbereich.js';

/**
 * @typedef {import('$lib/helpers/educational/bildungsbereich.js').BildungsbereichKey} BildungsbereichKey
 */

/**
 * @typedef {Object} ResourceFormVariant
 * @property {string} id - Stable identifier used in URLs and NIP-32 tags
 * @property {string} labelKey - Paraglide message key for the picker card label
 * @property {string} descriptionKey - Paraglide message key for the picker card description
 * @property {BildungsbereichKey[]} bildungsbereichKeys - Ordered subset of
 *   BILDUNGSBEREICH_KEYS this variant exposes on step 1 of the wizard
 * @property {{ sectionKey?: string, facets?: Record<string, string> }} [extensionLabels]
 *   Optional rendering hints for `ExtensionMetadataPanel`. `sectionKey` is the
 *   Paraglide message key used as the section heading; `facets` maps facet
 *   ids (the segment after `ext:<ns>:`) to Paraglide message keys for their
 *   per-row labels.
 */

/** @type {ResourceFormVariant[]} */
export const ALL_VARIANTS = [
  {
    id: 'amb',
    labelKey: 'resource_form_variant_amb_label',
    descriptionKey: 'resource_form_variant_amb_description',
    bildungsbereichKeys: ['schule', 'hochschule', 'extra']
  },
  {
    id: 'ekw',
    labelKey: 'resource_form_variant_ekw_label',
    descriptionKey: 'resource_form_variant_ekw_description',
    bildungsbereichKeys: ['schule', 'konfi'],
    extensionLabels: {
      sectionKey: 'amb_resource_ekw_metadata',
      facets: {
        gradeLevel: 'amb_resource_ekw_grade_level',
        schoolType: 'amb_resource_ekw_school_type',
        didacticConcept: 'amb_resource_ekw_didactic_concept',
        method: 'amb_resource_ekw_method',
        methodOther: 'amb_resource_ekw_method_other',
        bibleReference: 'amb_resource_ekw_bible_reference'
      }
    }
  }
];

/**
 * Pure filter: return variants whose id appears in `enabledIds`, preserving
 * registry order. Exported primarily for unit tests.
 *
 * @param {string[] | null | undefined} enabledIds
 * @returns {ResourceFormVariant[]}
 */
export function filterVariantsByIds(enabledIds) {
  if (!enabledIds || enabledIds.length === 0) return [];
  const set = new Set(enabledIds);
  return ALL_VARIANTS.filter((v) => set.has(v.id));
}

/**
 * Read the deployment-enabled list from runtime config. Falls back to
 * `['amb']` when nothing is configured so the app remains usable before
 * runtime config has loaded (e.g. during early startup).
 *
 * @returns {ResourceFormVariant[]}
 */
export function getEnabledVariants() {
  const enabled = runtimeConfig.resourceFormVariants?.enabled;
  if (!enabled || enabled.length === 0) return filterVariantsByIds(['amb']);
  return filterVariantsByIds(enabled);
}

/**
 * Look up an enabled variant by id. Returns `undefined` if the id is unknown
 * or disabled on this deployment.
 *
 * @param {string} id
 * @returns {ResourceFormVariant | undefined}
 */
export function getVariantById(id) {
  return getEnabledVariants().find((v) => v.id === id);
}

/**
 * First enabled variant id (used as the default for legacy `/create/resource`
 * URLs and single-variant deployments). Falls back to `'amb'`.
 *
 * @returns {string}
 */
export function getDefaultVariantId() {
  const variants = getEnabledVariants();
  return variants[0]?.id ?? 'amb';
}

/**
 * Return the ordered list of Bildungsbereich keys this variant exposes on
 * step 1 of the wizard. Pure lookup against `ALL_VARIANTS` — does NOT check
 * whether the variant is enabled on this deployment. Defensive fallback to
 * the full `BILDUNGSBEREICH_KEYS` list if the id is not registered.
 *
 * @param {string} variantId
 * @returns {BildungsbereichKey[]}
 */
export function getBildungsbereichKeysForVariant(variantId) {
  const variant = ALL_VARIANTS.find((v) => v.id === variantId);
  return variant?.bildungsbereichKeys ?? BILDUNGSBEREICH_KEYS;
}
