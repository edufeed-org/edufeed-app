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
 * @typedef {Object} BildungsbereichConfig
 * @property {{ de: string, en: string }} label
 * @property {string[]} subjectVocabKeys  - vocab `d` slugs (e.g. `schulfaecher`, `hochschulfaecher`)
 * @property {string[]} educationalLevelMapping  - educationalLevel concept URIs that identify this Bildungsbereich (used for edit-mode inference only)
 */

/** @type {Record<'schule' | 'hochschule' | 'extra', BildungsbereichConfig>} */
export const BILDUNGSBEREICHE = {
  schule: {
    label: { de: 'Schule', en: 'School' },
    subjectVocabKeys: ['schulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_1', // Primarbereich
      'https://w3id.org/kim/educationalLevel/level_2', // Sekundarbereich I
      'https://w3id.org/kim/educationalLevel/level_3' // Sekundarbereich II
    ]
  },
  hochschule: {
    label: { de: 'Hochschule', en: 'Higher Education' },
    subjectVocabKeys: ['hochschulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_A' // Hochschule
    ]
  },
  extra: {
    label: { de: 'Extra-Institutionell', en: 'Informal / Continuing Education' },
    subjectVocabKeys: ['schulfaecher', 'hochschulfaecher'],
    educationalLevelMapping: [
      'https://w3id.org/kim/educationalLevel/level_C' // Fortbildung
    ]
  }
};

/** Declaration order is significant — used as fallback priority by `inferBildungsbereichFromEducationalLevels`. */
export const BILDUNGSBEREICH_KEYS = /** @type {Array<keyof typeof BILDUNGSBEREICHE>} */ ([
  'schule',
  'hochschule',
  'extra'
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
