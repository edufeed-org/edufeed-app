/**
 * Bildungsbereich (educational area) configuration.
 *
 * Drives the AMB resource wizard:
 *   - which subject vocabulary picker(s) to show (`subjectVocabKeys`)
 *   - reverse-maps `educationalLevel` concepts back to a Bildungsbereich in
 *     edit-mode prefill (`educationalLevelMapping`, via
 *     `inferBildungsbereichFromEducationalLevels`). The form never uses this
 *     list as a preselect default.
 *
 * The KIM educationalLevel vocabulary (https://w3id.org/kim/educationalLevel/) is flat,
 * so "Schule" maps to multiple concepts (Primarbereich, Sek I, Sek II) rather than a
 * single parent. "Hochschule" and "Fortbildung" are single concepts.
 *
 * Add a new Bildungsbereich = one entry. Add a vocab to an existing one = append a
 * key to `subjectVocabKeys` (the key must match a `SCHEME_NADDR_*` env var slug).
 */

/**
 * @typedef {Object} SubStepFieldVocab
 * @property {'vocab'} kind
 * @property {string} schemeKey
 * @property {string} tagSlug
 * @property {string} labelKey  - Paraglide message key (e.g. `konfi_field_zielgruppen`); resolved at render time
 * @property {boolean} [multi]
 * @property {boolean} [required]
 * @property {string} [requiredOneOf]
 * @property {boolean} [allowCustom] - When true, the wizard renders a "+ eigene Angabe" affordance below the vocab picker. The custom value lives at `<schemeKey>Custom` in formData and serializes (via `formDataToAmbExt.js` → `ambToNostr`) as a bare `ext:org.edufeed.ekw.konfi:<tagSlug>` scalar tag alongside that facet's Concept triples — there is no separate `:custom` sub-key on the wire. Vocab + custom may coexist.
 * @property {string} [customLabelKey] - Paraglide key for the custom input label (required when `allowCustom`).
 * @property {string} [customButtonLabelKey] - Paraglide key for the "+ Hinzufügen" button (required when `allowCustom`).
 * @property {string} [customPlaceholderKey] - Paraglide key for the input placeholder (optional).
 */

/**
 * @typedef {Object} SubStepFieldScalar
 * @property {'scalar'} kind
 * @property {string} tagSlug
 * @property {string} labelKey  - Paraglide message key (e.g. `konfi_field_subtitle`); resolved at render time
 * @property {'text' | 'textarea' | 'checkbox'} input
 */

/**
 * @typedef {Object} SubStepConfig
 * @property {string} key
 * @property {string} titleKey
 * @property {Array<SubStepFieldVocab | SubStepFieldScalar>} fields
 */

/**
 * @typedef {Object} BildungsbereichConfig
 * @property {{ de: string, en: string }} label
 * @property {string[]} subjectVocabKeys  - vocab `d` slugs (e.g. `schulfaecher`, `hochschulfaecher`). Empty array = no subject picker rendered on step 4.
 * @property {string[]} educationalLevelMapping  - educationalLevel concept URIs that identify this Bildungsbereich (used for edit-mode inference only). Empty array = never auto-inferred.
 * @property {string} [bildungsbereichTag]  - short slug for NIP-32 `l` tag; omitted = no Bildungsbereich detection tag emitted
 * @property {SubStepConfig[]} [step4SubSteps]  - when present, step 4 splits into named sub-steps
 */

/**
 * @typedef {'schule' | 'hochschule' | 'extra' | 'konfi'} BildungsbereichKey
 */

/** @type {Record<BildungsbereichKey, BildungsbereichConfig>} */
export const BILDUNGSBEREICHE = {
  schule: {
    label: { de: 'Schule', en: 'School' },
    subjectVocabKeys: ['schulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_1', // Primarbereich
      'https://w3id.org/kim/educationalLevel/level_2', // Sekundarbereich I
      'https://w3id.org/kim/educationalLevel/level_3' // Sekundarbereich II
    ],
    bildungsbereichTag: 'schule'
  },
  hochschule: {
    label: { de: 'Hochschule', en: 'Higher Education' },
    subjectVocabKeys: ['hochschulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_A' // Hochschule
    ],
    bildungsbereichTag: 'hochschule'
  },
  extra: {
    label: { de: 'Extra-Institutionell', en: 'Informal / Continuing Education' },
    subjectVocabKeys: ['schulfaecher', 'hochschulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_C' // Fortbildung
    ],
    bildungsbereichTag: 'extra'
  },
  konfi: {
    label: { de: 'Konfi-Arbeit', en: 'Confirmation program' },
    subjectVocabKeys: [],
    educationalLevelMapping: [],
    bildungsbereichTag: 'konfi',
    step4SubSteps: [
      {
        key: '4a',
        titleKey: 'konfi_step4a_title',
        fields: [
          {
            kind: 'vocab',
            schemeKey: 'konfiZielgruppen',
            tagSlug: 'zielgruppen',
            labelKey: 'konfi_field_zielgruppen',
            multi: true,
            required: true
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiLernformat',
            tagSlug: 'lernformat',
            labelKey: 'konfi_field_lernformat',
            multi: true
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiZeitstruktur',
            tagSlug: 'zeitstruktur',
            labelKey: 'konfi_field_zeitstruktur',
            multi: true,
            allowCustom: true,
            customLabelKey: 'konfi_field_zeitstruktur_custom',
            customButtonLabelKey: 'konfi_field_zeitstruktur_add_custom',
            customPlaceholderKey: 'konfi_field_zeitstruktur_custom_placeholder'
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiBeteiligte',
            tagSlug: 'beteiligte',
            labelKey: 'konfi_field_beteiligte',
            multi: true
          }
        ]
      },
      {
        key: '4b',
        titleKey: 'konfi_step4b_title',
        fields: [
          {
            kind: 'vocab',
            schemeKey: 'konfiThemen',
            tagSlug: 'themen',
            labelKey: 'konfi_field_themen',
            multi: true,
            requiredOneOf: 'topicOrDimension'
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiDimensionen',
            tagSlug: 'dimensionen',
            labelKey: 'konfi_field_dimensionen',
            multi: true,
            requiredOneOf: 'topicOrDimension'
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiMethode',
            tagSlug: 'methode',
            labelKey: 'konfi_field_methode',
            multi: true
          },
          {
            kind: 'scalar',
            tagSlug: 'plainLanguage',
            labelKey: 'konfi_field_plain_language',
            input: 'checkbox'
          }
        ]
      },
      {
        key: '4c',
        titleKey: 'konfi_step4c_title',
        fields: [
          {
            kind: 'vocab',
            schemeKey: 'konfiMaterialaufwand',
            tagSlug: 'materialaufwand',
            labelKey: 'konfi_field_materialaufwand',
            multi: false
          },
          {
            kind: 'scalar',
            tagSlug: 'requiredMaterialsNote',
            labelKey: 'konfi_field_required_materials_note',
            input: 'textarea'
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiTechnikbedarf',
            tagSlug: 'technikbedarf',
            labelKey: 'konfi_field_technikbedarf',
            multi: true
          },
          {
            kind: 'vocab',
            schemeKey: 'konfiLernorte',
            tagSlug: 'lernorte',
            labelKey: 'konfi_field_lernorte',
            multi: true
          },
          {
            kind: 'vocab',
            schemeKey: 'landeskirchen',
            tagSlug: 'landeskirche',
            labelKey: 'konfi_field_landeskirche',
            multi: false
          }
        ]
      }
    ]
  }
};

/** Declaration order is significant — used as fallback priority by `inferBildungsbereichFromEducationalLevels`. */
export const BILDUNGSBEREICH_KEYS = /** @type {BildungsbereichKey[]} */ ([
  'schule',
  'hochschule',
  'extra',
  'konfi'
]);

/**
 * Human-readable labels for subject vocabulary slugs. Used to disambiguate
 * parallel pickers in the `extra` Bildungsbereich (which shows both the
 * `schulfaecher` and `hochschulfaecher` vocabs at once). Values mirror the
 * corresponding `BILDUNGSBEREICHE[*].label` wording so the UI vocabulary
 * stays consistent.
 *
 * @type {Record<string, { de: string, en: string }>}
 */
export const SUBJECT_VOCAB_LABELS = {
  schulfaecher: { de: 'Schule', en: 'School' },
  hochschulfaecher: { de: 'Hochschule', en: 'Higher Education' }
};

/**
 * Resolve a subject vocab slug to a localized human label. Falls back to the
 * raw slug if no label is registered.
 *
 * @param {string} key
 * @param {string} [locale] - Paraglide locale ('de', 'en', …). Defaults to 'en'.
 * @returns {string}
 */
export function getSubjectVocabLabel(key, locale = 'en') {
  const entry = SUBJECT_VOCAB_LABELS[key];
  if (!entry) return key;
  return locale === 'de' ? entry.de : entry.en;
}

/**
 * @param {string} key
 * @returns {BildungsbereichConfig | undefined}
 */
export function getBildungsbereich(key) {
  return BILDUNGSBEREICHE[/** @type {keyof typeof BILDUNGSBEREICHE} */ (key)];
}

/**
 * Map an event's `educationalLevel` URIs back to a Bildungsbereich key.
 * Used in edit mode to infer step 1 from an existing kind 30142.
 *
 * Walks Bildungsbereiche in declaration order; the first one whose `educationalLevelMapping`
 * intersects with `levels` wins. Returns undefined if nothing matches.
 *
 * @param {string[]} levels - educational level concept URIs from the existing event
 * @returns {keyof typeof BILDUNGSBEREICHE | undefined}
 */
export function inferBildungsbereichFromEducationalLevels(levels) {
  if (!levels?.length) return undefined;
  const set = new Set(levels);
  for (const key of BILDUNGSBEREICH_KEYS) {
    const mapping = BILDUNGSBEREICHE[key].educationalLevelMapping;
    if (mapping.some((uri) => set.has(uri))) return key;
  }
  return undefined;
}
