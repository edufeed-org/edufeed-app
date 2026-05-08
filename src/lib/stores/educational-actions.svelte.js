/**
 * Educational Actions Store
 * Actions for creating and managing educational resources (AMB) with Nostr integration
 */

import { ambToNostr } from 'amb-nostr-converter';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { manager } from '$lib/stores/accounts.svelte';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
import {
  appendCreatorPTags,
  appendExternalUrlTags,
  appendVariantLabelTags
} from '$lib/helpers/educational/eventTags.js';
import { formDataToEkwTags } from '$lib/helpers/educational/formDataToEkwTags.js';

/**
 * @typedef {Object} Creator
 * @property {string} name - Creator name
 * @property {'Person'|'Organization'} type - Creator type
 * @property {string} [pubkey] - Nostr pubkey (hex)
 * @property {string} [affiliationName] - Affiliation/organization name
 * @property {string} [honorificPrefix] - Honorific prefix (Dr., Prof., etc.)
 */

/**
 * @typedef {Object} UploadedFile
 * @property {string} url - Blossom URL
 * @property {string} mimeType - MIME type
 * @property {number} size - File size in bytes
 * @property {string} name - Original filename
 * @property {string} sha256 - SHA-256 hash
 */

/**
 * @typedef {Object} EducationalFormData
 * @property {string} name - Resource title
 * @property {string} description - Resource description
 * @property {string} slug - URL-safe identifier (d-tag)
 * @property {string} learningResourceType - SKOS URI for resource type
 * @property {string} learningResourceTypeLabel - Human-readable label
 * @property {string[]} about - Array of SKOS URIs for subjects
 * @property {{id: string, label: string}[]} aboutLabels - Array of {id, label} objects
 * @property {string} inLanguage - ISO 639-1 language code
 * @property {string} license - License URI
 * @property {Creator[]} creators - Array of creators
 * @property {string[]} keywords - Array of keywords/tags
 * @property {UploadedFile[]} files - Array of uploaded files
 * @property {boolean} [isAccessibleForFree] - Whether the resource is freely accessible
 * @property {string} [educationalLevel] - Optional SKOS URI for educational level (singular, legacy)
 * @property {string} [educationalLevelLabel] - Human-readable label (singular, legacy)
 * @property {string[]} [educationalLevels] - Optional SKOS URIs for educational levels (plural, preferred)
 * @property {{id: string, label: string}[]} [educationalLevelLabels] - Labels for `educationalLevels`
 * @property {string[]} [externalUrls] - Array of external reference URLs (r-tags)
 * @property {AMBRelationRef[]} [hasPart] - Linked child AMB resources
 * @property {AMBRelationRef[]} [isPartOf] - Linked parent AMB resources
 * @property {string[]} [gradeLevels] - EKW: SKOS URIs for grade levels (Klassenstufen)
 * @property {{id: string, label: string}[]} [gradeLevelLabels] - EKW: labels for `gradeLevels`
 * @property {string[]} [schoolTypes] - EKW: SKOS URIs for school types (Schularten)
 * @property {{id: string, label: string}[]} [schoolTypeLabels] - EKW: labels for `schoolTypes`
 * @property {string[]} [didacticConcepts] - EKW: SKOS URIs for didactic concepts
 * @property {{id: string, label: string}[]} [didacticConceptLabels] - EKW: labels for `didacticConcepts`
 * @property {string[]} [methods] - EKW: SKOS URIs for methods
 * @property {{id: string, label: string}[]} [methodLabels] - EKW: labels for `methods`
 * @property {string} [methodOther] - EKW: free-form method description (newline-separated)
 * @property {string[]} [bibleReferences] - EKW: free-form Bible references
 * @property {{id: string, type: 'Concept', prefLabel: {de: string}}[]} [teaches] - AMB: SKOS Concepts for pedagogical "teaches" relation
 * @property {{id: string, type: 'Concept', prefLabel: {de: string}}[]} [assesses] - AMB: SKOS Concepts for pedagogical "assesses" relation
 * @property {{id: string, type: 'Concept', prefLabel: {de: string}}[]} [competencyRequired] - AMB: SKOS Concepts for required competencies
 */

/**
 * @typedef {Object} AMBRelationRef
 * @property {string} coordinate - `kind:pubkey:dTag`
 * @property {string} pubkey - Author pubkey
 * @property {string} dTag - d-tag identifier
 * @property {string} [relayHint] - Relay hint for the referenced event
 * @property {import('nostr-tools').NostrEvent} [event] - Resolved event (edit-mode prefill)
 */

/**
 * @typedef {Object} EducationalActions
 * @property {(formData: EducationalFormData, variantId?: string) => Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>} createResource
 * @property {(formData: EducationalFormData, existingEvent: import('nostr-tools').NostrEvent, communityEvent?: import('nostr-tools').NostrEvent | null, variantId?: string) => Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>} updateResource
 */

/** Kind number for AMB Educational Resource events */
const AMB_RESOURCE_KIND = 30142;

/**
 * Build the `relatedEvents` map for `ambToNostr` so it emits marker `a`-tags
 * (`["a", coord, relay, "hasPart"|"isPartOf"]`) alongside its generic
 * `hasPart:id` / `isPartOf:id` tags.
 *
 * @param {EducationalFormData} formData
 * @returns {Record<string, {pubkey: string, dTag: string, relayHint?: string}>}
 */
function buildRelatedEventsMap(formData) {
  /** @type {Record<string, {pubkey: string, dTag: string, relayHint?: string}>} */
  const map = {};
  const refs = [...(formData.hasPart ?? []), ...(formData.isPartOf ?? [])];
  for (const r of refs) {
    map[r.coordinate] = {
      pubkey: r.pubkey,
      dTag: r.dTag,
      relayHint: r.relayHint
    };
  }
  return map;
}

/**
 * Serialize formData into AMB-spec kind 30142 tags + content via
 * `amb-nostr-converter`. Throws on conversion failure.
 *
 * @param {EducationalFormData} formData
 * @param {string} pubkey - Author pubkey (used only for `ambToNostr`'s preview; real signing happens later)
 * @returns {{tags: string[][], content: string}}
 */
function buildAMBEventTagsFromFormData(formData, pubkey) {
  const ambData = convertFormDataToAMB(formData);
  const result = ambToNostr(/** @type {any} */ (ambData), {
    pubkey,
    timestamp: Math.floor(Date.now() / 1000),
    relatedEvents: buildRelatedEventsMap(formData)
  });
  if (!result.success || !result.data) {
    const msg = result.error?.message ?? 'Unknown conversion error';
    throw new Error(`AMB serialization failed: ${msg}`);
  }
  return { tags: result.data.tags, content: result.data.content ?? '' };
}

/**
 * Create educational actions for managing AMB resources
 * @returns {EducationalActions} Educational actions object
 */
export function createEducationalActions() {
  return {
    /**
     * Create a new educational resource (kind:30142).
     *
     * Does not target any community directly. Sharing into communities is
     * performed by the caller as a separate NIP-18 repost step (see
     * `createCommunityReposts` in `helpers/communityRepost.js`).
     *
     * @param {EducationalFormData} formData - Form data from upload modal
     * @param {string} [variantId='amb'] - Metadata-form variant id (NIP-32 label)
     * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
     */
    async createResource(formData, variantId = 'amb') {
      // Get current account from manager
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to create resources.');
      }

      // Validate required fields
      if (!formData.name?.trim()) {
        throw new Error('Resource name is required');
      }
      if (!formData.description?.trim()) {
        throw new Error('Resource description is required');
      }
      // Note: slug is optional - will auto-generate random ID if empty
      if (!formData.learningResourceType) {
        throw new Error('Learning resource type is required');
      }
      // EKKW variant uses its own Fachrichtung field instead of the AMB about/Fach
      // picker, so subjects may legitimately be empty. Mirrors the wizard skip at
      // ResourceFormWizard.svelte step 4.
      if (variantId !== 'ekw' && (!formData.about || formData.about.length === 0)) {
        throw new Error('At least one subject is required');
      }
      if (!formData.inLanguage) {
        throw new Error('Language is required');
      }
      if (!formData.license) {
        throw new Error('License is required');
      }

      try {
        // Serialize AMB → Nostr via amb-nostr-converter. Emits marker `a`-tags
        // for hasPart/isPartOf when `relatedEvents` is supplied.
        const { tags, content } = buildAMBEventTagsFromFormData(formData, currentAccount.pubkey);

        await appendCreatorPTags(tags, formData.creators, getPrimaryWriteRelay);
        appendExternalUrlTags(tags, formData.externalUrls);
        appendVariantLabelTags(tags, variantId);

        const ekwTags = formDataToEkwTags(/** @type {any} */ (formData));
        for (const t of ekwTags) tags.push(t);

        // Create the event using EventFactory
        const eventFactory = createAppEventFactory();

        const eventTemplate = await eventFactory.build({
          kind: AMB_RESOURCE_KIND,
          content,
          tags
        });

        // Sign and publish optimistically (adds to store immediately)
        const resourceEvent = await currentAccount.signEvent(eventTemplate);
        publishEventOptimistic(resourceEvent, []);

        // Generate naddr using educational relays for hint
        const naddr = encodeEventToNaddr(resourceEvent, getAppRelaysForCategory('educational'));

        console.log('📚 Educational resource created:', resourceEvent.id);
        console.log('📚 Resource naddr:', naddr);

        return { event: resourceEvent, naddr };
      } catch (error) {
        console.error('Error creating educational resource:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create educational resource: ${errorMessage}`);
      }
    },

    /**
     * Update an existing educational resource
     * @param {EducationalFormData} formData - Updated form data
     * @param {import('nostr-tools').NostrEvent} existingEvent - Existing event to update
     * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community definition event (kind 10222) for relay routing
     * @param {string} [variantId='amb'] - Metadata-form variant id (NIP-32 label)
     * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
     */
    async updateResource(formData, existingEvent, communityEvent = null, variantId = 'amb') {
      // Get current account
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to update resources.');
      }

      // Extract the original d-tag
      const dTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
      if (!dTag) {
        throw new Error('Cannot update resource: missing d-tag. Resource may not be replaceable.');
      }

      // Extract the original h-tag (community targeting) if present
      const hTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];

      // Verify the user owns this event
      if (existingEvent.pubkey !== currentAccount.pubkey) {
        throw new Error('Cannot update resource: you do not own this resource.');
      }

      try {
        // Use the original d-tag to ensure replacement
        formData.slug = dTag;

        // Serialize AMB → Nostr via amb-nostr-converter.
        const { tags, content } = buildAMBEventTagsFromFormData(formData, currentAccount.pubkey);

        // Preserve h-tag if it was present
        if (hTag) {
          tags.push(['h', hTag]);
        }

        await appendCreatorPTags(tags, formData.creators, getPrimaryWriteRelay);
        appendExternalUrlTags(tags, formData.externalUrls);
        appendVariantLabelTags(tags, variantId);

        const ekwTags = formDataToEkwTags(/** @type {any} */ (formData));
        for (const t of ekwTags) tags.push(t);

        // Create the updated event
        const eventFactory = createAppEventFactory();

        const eventTemplate = await eventFactory.build({
          kind: AMB_RESOURCE_KIND,
          content,
          tags
        });

        // Sign and publish optimistically (adds to store immediately)
        const updatedEvent = await currentAccount.signEvent(eventTemplate);
        publishEventOptimistic(updatedEvent, [], { communityEvent });

        // Generate naddr using educational relays for hint
        const naddr = encodeEventToNaddr(updatedEvent, getAppRelaysForCategory('educational'));

        console.log('📚 Educational resource updated:', updatedEvent.id);

        return { event: updatedEvent, naddr };
      } catch (error) {
        console.error('Error updating educational resource:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to update educational resource: ${errorMessage}`);
      }
    }
  };
}

/**
 * Global educational actions store instance
 * @type {EducationalActions | null}
 */
let educationalActionsInstance = null;

/**
 * Get or create educational actions singleton
 * @returns {EducationalActions} Educational actions instance
 */
export function useEducationalActions() {
  if (!educationalActionsInstance) {
    educationalActionsInstance = createEducationalActions();
  }
  return educationalActionsInstance;
}
