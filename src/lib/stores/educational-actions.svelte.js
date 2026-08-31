/**
 * Educational Actions Store
 * Actions for creating and managing educational resources (AMB) with Nostr integration
 */

import { ambToNostr } from 'amb-nostr-converter';
import { getSha256FromURL } from 'applesauce-common/helpers';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { manager } from '$lib/stores/accounts.svelte';
import { canSign } from '$lib/helpers/signing-guard.js';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { nextCreatedAt } from '$lib/helpers/replaceableUpdates.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
import {
  appendCreatorPTags,
  appendExternalUrlTags,
  appendVariantLabelTags,
  appendInteractiveTags
} from '$lib/helpers/educational/eventTags.js';
import { appendCoverColorTag } from '$lib/helpers/educational/coverColor.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';
import { bildungsbereichToNip32Tags } from '$lib/helpers/educational/bildungsbereichNamespace.js';

/**
 * @typedef {Object} Creator
 * @property {string} name - Creator name
 * @property {'Person'|'Organization'} type - Creator type
 * @property {string} [pubkey] - Nostr pubkey (hex)
 * @property {string} [affiliationName] - Affiliation/organization name
 * @property {string} [honorificPrefix] - Honorific prefix (Dr., Prof., etc.)
 * @property {string} [orcid] - ORCID iD as canonical https URI
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
 * @property {number | null} [coverHue] - User-chosen cover hue (null = auto)
 * @property {string} [image] - Thumbnail image URL; emitted as an `image` tag
 * @property {import('nostr-tools').NostrEvent | null} [imageLicenseEvent] - NIP-94 license attestation for the thumbnail; its `x` tag becomes the resource's `x` tag
 * @property {string} [datePublished] - schema.org datePublished (YYYY-MM-DD); emitted as a `datePublished` tag
 * @property {string} [dateCreated] - schema.org dateCreated (YYYY-MM-DD); emitted as a `dateCreated` tag
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
 * @property {string} [bildungsbereich] - Wizard step-1 pick ('schule'|'hochschule'|'extra'|'konfi'|''); drives the Konfi required-field skip and the Bildungsbereich NIP-32 detection tag
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
 * Resolve the NIP-32 `l` slug for the wizard's Bildungsbereich pick
 * (`formData.bildungsbereich`, forwarded verbatim by `buildResourceData`).
 * Returns undefined for the AMB variant (no Bildungsbereich picker) or an
 * unrecognized/empty value.
 *
 * @param {any} formData
 * @returns {string | undefined}
 */
function getBildungsbereichTag(formData) {
  const key = formData?.bildungsbereich;
  if (!key) return undefined;
  return /** @type {any} */ (BILDUNGSBEREICHE)[key]?.bildungsbereichTag;
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
  const result = ambToNostr(
    /** @type {any} */ (ambData),
    // `relatedEvents` is accepted at runtime but missing from the upstream
    // package's ConversionOptions .d.ts — cast to bypass the stale type.
    /** @type {any} */ ({
      pubkey,
      timestamp: Math.floor(Date.now() / 1000),
      relatedEvents: buildRelatedEventsMap(formData)
    })
  );
  if (!result.success || !result.data) {
    const msg = result.error?.message ?? 'Unknown conversion error';
    throw new Error(`AMB serialization failed: ${msg}`);
  }
  return { tags: result.data.tags, content: result.data.content ?? '' };
}

/**
 * Resolve the SHA-256 hash for the resource's thumbnail image, if any.
 * Prefers the license-event's `x` tag (set via the upload+license flow).
 * Falls back to parsing the URL itself (only succeeds for Blossom-style
 * URLs that carry the hash in the path).
 *
 * @param {any} formData
 * @returns {string | undefined}
 */
function resolveImageHash(formData) {
  const licenseEvent = formData?.imageLicenseEvent;
  if (licenseEvent && Array.isArray(licenseEvent.tags)) {
    const xTag = licenseEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'x')?.[1];
    if (xTag) return xTag;
  }
  if (formData?.image) {
    // getSha256FromURL does `new URL(...)` — a malformed pasted image URL
    // must not make the whole publish throw.
    try {
      return getSha256FromURL(formData.image) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
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
      if (!canSign(currentAccount)) {
        throw new Error(
          'This account is read-only. Log in with a signing method to create resources.'
        );
      }

      // Validate required fields
      if (!formData.name?.trim()) {
        throw new Error('Resource name is required');
      }
      if (!formData.description?.trim()) {
        throw new Error('Resource description is required');
      }
      // Note: slug is optional - will auto-generate random ID if empty
      // Konfi resources don't render the LRT/Fach pickers — their Bildungsbereich
      // config replaces those AMB axes with Konfi-specific facets emitted under
      // the ext:org.edufeed.ekw.konfi:* namespace. Detect the Konfi path via
      // the wizard's step-1 Bildungsbereich pick.
      const isKonfi = /** @type any */ (formData).bildungsbereich === 'konfi';
      if (!isKonfi && !formData.learningResourceType) {
        throw new Error('Learning resource type is required');
      }
      // EKKW variant uses its own Fachrichtung field instead of the AMB about/Fach
      // picker, so subjects may legitimately be empty. Mirrors the wizard skip at
      // ResourceFormWizard.svelte step 4.
      if (!isKonfi && variantId !== 'ekw' && (!formData.about || formData.about.length === 0)) {
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
        appendInteractiveTags(tags, formData.files);
        appendCoverColorTag(tags, formData.coverHue);

        // Bildungsbereich NIP-32 detection tag (schule/hochschule/extra/konfi).
        // EKW/Konfi ext:<ns>:<facet> facets themselves come from `amb.ext` via
        // `buildAMBEventTagsFromFormData` above — no separate hand-append.
        const bildungsbereichTag = getBildungsbereichTag(formData);
        if (bildungsbereichTag) {
          for (const t of bildungsbereichToNip32Tags(bildungsbereichTag)) tags.push(t);
        }

        // Image hash (NIP-94 cross-reference). Set when an upload happened
        // OR when the pasted URL was content-addressable Blossom.
        const imageHash = resolveImageHash(formData);
        if (imageHash) {
          tags.push(['x', imageHash]);
        }

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
      if (!canSign(currentAccount)) {
        throw new Error(
          'This account is read-only. Log in with a signing method to update resources.'
        );
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
        appendInteractiveTags(tags, formData.files);
        appendCoverColorTag(tags, formData.coverHue);

        // Bildungsbereich NIP-32 detection tag (schule/hochschule/extra/konfi).
        // EKW/Konfi ext:<ns>:<facet> facets themselves come from `amb.ext` via
        // `buildAMBEventTagsFromFormData` above — no separate hand-append.
        const bildungsbereichTag = getBildungsbereichTag(formData);
        if (bildungsbereichTag) {
          for (const t of bildungsbereichToNip32Tags(bildungsbereichTag)) tags.push(t);
        }

        const imageHash = resolveImageHash(formData);
        if (imageHash) {
          tags.push(['x', imageHash]);
        }

        // Create the updated event
        const eventFactory = createAppEventFactory();

        // Strictly newer than the version being replaced — a same-second edit
        // is dropped by the relay tie-break and deterministically by the
        // cache. (#62/#64)
        const eventTemplate = await eventFactory.build({
          kind: AMB_RESOURCE_KIND,
          content,
          tags,
          created_at: nextCreatedAt(existingEvent)
        });

        // Sign and publish optimistically (adds to store immediately)
        const updatedEvent = await currentAccount.signEvent(eventTemplate);
        publishEventOptimistic(updatedEvent, [], { communityEvent });

        // Generate naddr using educational relays for hint
        const naddr = encodeEventToNaddr(updatedEvent, getAppRelaysForCategory('educational'));

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
