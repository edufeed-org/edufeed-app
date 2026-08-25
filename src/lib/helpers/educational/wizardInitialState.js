/**
 * @typedef {import('./bildungsbereich.js').BildungsbereichKey} BildungsbereichKey
 * @typedef {{ id: string, label: string }} CompactConcept
 * @typedef {{ url: string, name: string, type: string, size: number, sha256: string, licenseEvent?: import('nostr-tools').NostrEvent | null }} UploadedFile
 * @typedef {{ name: string, type: 'Person' | 'Organization', pubkey?: string, affiliationName?: string, honorificPrefix?: string, orcid?: string }} Creator
 * @typedef {{
 *   coordinate: string,
 *   pubkey: string,
 *   dTag: string,
 *   relayHint?: string | undefined,
 *   event?: import('nostr-tools').NostrEvent
 * }} AMBRelationRef
 * @typedef {{ id: string, label: string }} ConceptLabel
 */

/**
 * Build a fresh, default form-data object for ResourceFormWizard.
 *
 * Used in two places:
 * 1. Initial `$state(...)` declaration on mount.
 * 2. `discardDraft()` resets the form back to this shape after the user
 *    chooses to throw away a restored draft.
 *
 * Returns a new object on every call — important because Svelte's `$state`
 * proxies the reference and `discardDraft` reassigns to it; sharing a
 * frozen literal would let one wizard instance mutate another's defaults.
 */
export function createInitialFormData() {
  return {
    // Step 1: Bildungsbereich
    bildungsbereich: /** @type {'' | BildungsbereichKey} */ (''),

    // Step 2: URL/naddr input (carried into step 3 as identifier)
    urlInput: '',

    // Step 3: Basic Info
    name: '',
    description: '',
    inLanguage: 'de',
    image: '',
    imageWasUploaded: false,
    imageLicenseEvent: /** @type {import('nostr-tools').NostrEvent | null} */ (null),
    identifier: '',
    // null = auto (hash-derived) cover color; number = user-chosen hue
    coverHue: /** @type {number | null} */ (null),

    // schema.org/AMB dates (date-only, YYYY-MM-DD). Optional; auto-filled from
    // fetched AMB JSON-LD when present, otherwise left blank.
    datePublished: '',
    dateCreated: '',

    // Step 4: Classification
    learningResourceType: /** @type {CompactConcept[]} */ ([]),
    educationalLevels: /** @type {CompactConcept[]} */ ([]),
    keywords: /** @type {string[]} */ ([]),

    // Step 4 (AMB only): Lehrplan-bezug. The curriculum picker emits one
    // SKOS Concept into one of these three pedagogical fields (radio,
    // mutually exclusive in v1). EKW variant ignores them.
    teaches: /** @type {{ id: string, type: 'Concept', prefLabel: { de: string } }[]} */ ([]),
    assesses: /** @type {{ id: string, type: 'Concept', prefLabel: { de: string } }[]} */ ([]),
    competencyRequired:
      /** @type {{ id: string, type: 'Concept', prefLabel: { de: string } }[]} */ ([]),

    // Step 5: Content & Creators
    creators: /** @type {Creator[]} */ ([]),
    encodings: /** @type {UploadedFile[]} */ ([]),
    externalUrls: /** @type {string[]} */ ([]),

    // Step 6: Relations
    hasPart: /** @type {AMBRelationRef[]} */ ([]),
    isPartOf: /** @type {AMBRelationRef[]} */ ([]),

    // Step 7: Rights
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,

    // EKW-only (variantId === 'ekw'); ignored for AMB
    gradeLevels: /** @type {string[]} */ ([]),
    gradeLevelLabels: /** @type {ConceptLabel[]} */ ([]),
    schoolTypes: /** @type {string[]} */ ([]),
    schoolTypeLabels: /** @type {ConceptLabel[]} */ ([]),
    didacticConcepts: /** @type {string[]} */ ([]),
    didacticConceptLabels: /** @type {ConceptLabel[]} */ ([]),
    methods: /** @type {string[]} */ ([]),
    methodLabels: /** @type {ConceptLabel[]} */ ([]),
    methodOther: '',
    bibleReferences: /** @type {string[]} */ ([''])
  };
}
