import * as m from '$lib/paraglide/messages';

/**
 * Registry-driven Paraglide messages, resolved by key string.
 *
 * Config registries — `ALL_VARIANTS` / `EXTENSION_NAMESPACE_LABELS` in
 * `resource-form-variants.js` and the Konfi `step4SubSteps` in
 * `bildungsbereich.js` — name their labels by message key so new variants can
 * be added as data. Do NOT resolve those with `m[key]` on the namespace
 * import: a computed index forces rollup to keep every compiled message in
 * every locale (~340KB) in one shared chunk. This table references each
 * message statically, so only the listed ones are bundled.
 *
 * Adding a key to a registry means adding it here; the drift catcher in
 * `src/lib/__tests__/message-lookup.test.js` fails until you do.
 *
 * @type {Readonly<Record<string, () => string>>}
 */
const REGISTRY_MESSAGES = Object.freeze({
  // Resource form variants (picker cards)
  resource_form_variant_amb_label: m.resource_form_variant_amb_label,
  resource_form_variant_amb_description: m.resource_form_variant_amb_description,
  resource_form_variant_ekw_label: m.resource_form_variant_ekw_label,
  resource_form_variant_ekw_description: m.resource_form_variant_ekw_description,
  resource_form_variant_hochschule_label: m.resource_form_variant_hochschule_label,
  resource_form_variant_hochschule_description: m.resource_form_variant_hochschule_description,
  // EKW extension section + facets
  amb_resource_ekw_metadata: m.amb_resource_ekw_metadata,
  amb_resource_ekw_grade_level: m.amb_resource_ekw_grade_level,
  amb_resource_ekw_school_type: m.amb_resource_ekw_school_type,
  amb_resource_ekw_didactic_concept: m.amb_resource_ekw_didactic_concept,
  amb_resource_ekw_method: m.amb_resource_ekw_method,
  amb_resource_ekw_method_other: m.amb_resource_ekw_method_other,
  amb_resource_ekw_bible_reference: m.amb_resource_ekw_bible_reference,
  // Konfi extension section + facets / step-4 field labels
  konfi_metadata_section: m.konfi_metadata_section,
  konfi_field_zielgruppen: m.konfi_field_zielgruppen,
  konfi_field_lernformat: m.konfi_field_lernformat,
  konfi_field_zeitstruktur: m.konfi_field_zeitstruktur,
  konfi_field_zeitstruktur_custom: m.konfi_field_zeitstruktur_custom,
  konfi_field_beteiligte: m.konfi_field_beteiligte,
  konfi_field_themen: m.konfi_field_themen,
  konfi_field_dimensionen: m.konfi_field_dimensionen,
  konfi_field_methode: m.konfi_field_methode,
  konfi_field_materialaufwand: m.konfi_field_materialaufwand,
  konfi_field_technikbedarf: m.konfi_field_technikbedarf,
  konfi_field_lernorte: m.konfi_field_lernorte,
  konfi_field_landeskirche: m.konfi_field_landeskirche,
  konfi_field_subtitle: m.konfi_field_subtitle,
  konfi_field_plain_language: m.konfi_field_plain_language,
  konfi_field_required_materials_note: m.konfi_field_required_materials_note,
  // Konfi step-4 sub-step headings
  konfi_step4a_title: m.konfi_step4a_title,
  konfi_step4b_title: m.konfi_step4b_title,
  konfi_step4c_title: m.konfi_step4c_title
});

/**
 * Resolve a registry message key to its localized string.
 * @param {string} key
 * @returns {string | undefined} undefined when the key is not registered —
 *   callers keep their own fallback (raw key, humanized name, …)
 */
export function resolveMessage(key) {
  const fn = Object.prototype.hasOwnProperty.call(REGISTRY_MESSAGES, key)
    ? REGISTRY_MESSAGES[key]
    : undefined;
  return typeof fn === 'function' ? fn() : undefined;
}
