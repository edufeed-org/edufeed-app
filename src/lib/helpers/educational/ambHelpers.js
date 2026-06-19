/**
 * AMB Resource Helper Functions
 *
 * Application-specific helpers for working with AMB (kind 30142) events in the UI.
 * These functions extract and format data from AMB events for display.
 */

import {
  getTagValue,
  getTagValues,
  getNestedTagValues,
  getLabelsWithFallback
} from './ambTransform.js';
import { formatLicenseUrl } from './licenseLabel.js';

/**
 * Extracts the resource name from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string} Resource name or "Untitled Resource"
 */
export function getAMBName(event) {
  return getTagValue(event.tags, 'name') || 'Untitled Resource';
}

/**
 * Extracts the resource description from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string} Resource description or empty string
 */
export function getAMBDescription(event) {
  return getTagValue(event.tags, 'description') || '';
}

/**
 * Extracts the resource image URL from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string|null} Image URL or null
 */
export function getAMBImage(event) {
  return getTagValue(event.tags, 'image');
}

/**
 * Extracts resource types from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of resource types
 */
export function getAMBTypes(event) {
  return getTagValues(event.tags, 'type');
}

/**
 * Extracts learning resource types with language-aware labels from an AMB event.
 * Uses language fallback: userLang → 'en' → ID
 * @param {any} event - AMB event (kind 30142)
 * @param {string} [lang='en'] - User's preferred language code
 * @returns {Array<{id: string, label: string}>} Array of learning resource types
 */
export function getAMBLearningResourceTypes(event, lang = 'en') {
  return getLabelsWithFallback(event.tags, 'learningResourceType', lang);
}

/**
 * Extracts subjects/topics with language-aware labels from an AMB event.
 * Uses language fallback: userLang → 'en' → ID
 * @param {any} event - AMB event (kind 30142)
 * @param {string} [lang='en'] - User's preferred language code
 * @returns {Array<{id: string, label: string}>} Array of subjects
 */
export function getAMBSubjects(event, lang = 'en') {
  return getLabelsWithFallback(event.tags, 'about', lang);
}

/**
 * Extracts educational levels with language-aware labels from an AMB event.
 * Uses language fallback: userLang → 'en' → ID
 * @param {any} event - AMB event (kind 30142)
 * @param {string} [lang='en'] - User's preferred language code
 * @returns {Array<{id: string, label: string}>} Array of educational levels
 */
export function getAMBEducationalLevels(event, lang = 'en') {
  return getLabelsWithFallback(event.tags, 'educationalLevel', lang);
}

/**
 * Extracts license information from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {{id: string, label: string}|null} License info or null
 */
export function getAMBLicense(event) {
  const licenseId = getTagValue(event.tags, 'license:id');
  if (!licenseId) return null;

  return { id: licenseId, label: formatLicenseUrl(licenseId) };
}

/**
 * Checks if the resource is free to access
 * @param {any} event - AMB event (kind 30142)
 * @returns {boolean} True if resource is free
 */
export function isAMBFree(event) {
  const value = getTagValue(event.tags, 'isAccessibleForFree');
  return value === 'true';
}

/**
 * Extracts keywords from an AMB event (from 't' tags)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of keywords
 */
export function getAMBKeywords(event) {
  return getTagValues(event.tags, 't');
}

/**
 * Extracts in-language codes from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of language codes (e.g., ['de', 'en'])
 */
export function getAMBLanguages(event) {
  return getTagValues(event.tags, 'inLanguage');
}

/**
 * Gets the published date for an AMB resource
 * Falls back to dateCreated or created_at
 * @param {any} event - AMB event (kind 30142)
 * @returns {number} Unix timestamp in seconds
 */
export function getAMBPublishedDate(event) {
  // Try datePublished first
  const datePublished = getTagValue(event.tags, 'datePublished');
  if (datePublished) {
    return new Date(datePublished).getTime() / 1000;
  }

  // Fallback to dateCreated
  const dateCreated = getTagValue(event.tags, 'dateCreated');
  if (dateCreated) {
    return new Date(dateCreated).getTime() / 1000;
  }

  // Final fallback to event created_at
  return event.created_at;
}

/**
 * Reads the raw `datePublished` tag value (schema.org/AMB), or '' if absent.
 * Unlike `getAMBPublishedDate`, this does NOT fall back to dateCreated or
 * created_at — it reflects exactly what the form captured, suitable for
 * prefilling a date input.
 * @param {any} event - AMB event (kind 30142)
 * @returns {string} ISO date string, or '' if no datePublished tag
 */
export function getAMBDatePublished(event) {
  return getTagValue(event.tags, 'datePublished') || '';
}

/**
 * Reads the raw `dateCreated` tag value (schema.org/AMB), or '' if absent.
 * @param {any} event - AMB event (kind 30142)
 * @returns {string} ISO date string, or '' if no dateCreated tag
 */
export function getAMBDateCreated(event) {
  return getTagValue(event.tags, 'dateCreated') || '';
}

/**
 * Extracts creator names from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of creator names
 */
export function getAMBCreatorNames(event) {
  return getNestedTagValues(event.tags, 'creator:name');
}

/**
 * Extracts main entity of page URLs (links to the actual resource)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of URLs where the resource can be accessed
 */
export function getAMBResourceURLs(event) {
  return getNestedTagValues(event.tags, 'mainEntityOfPage:id');
}

/**
 * Gets the primary resource URL (first mainEntityOfPage)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string|null} Primary URL or null
 */
export function getAMBPrimaryURL(event) {
  const urls = getAMBResourceURLs(event);
  return urls.length > 0 ? urls[0] : null;
}

/**
 * Extracts the resource identifier (d-tag value)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string|null} Resource identifier
 */
export function getAMBIdentifier(event) {
  return getTagValue(event.tags, 'd');
}

/**
 * Extracts the external reference URL from r-tag (NIP-24)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string|null} External URL or null
 * @deprecated Use getAMBExternalUrls for multiple URLs support
 */
export function getAMBExternalUrl(event) {
  return getTagValue(event.tags, 'r');
}

/**
 * Extracts all external reference URLs from r-tags (NIP-24)
 * @param {any} event - AMB event (kind 30142)
 * @returns {string[]} Array of external URLs
 */
export function getAMBExternalUrls(event) {
  return getTagValues(event.tags, 'r');
}

/**
 * Extracts uploaded files/encodings from an AMB event
 * @param {any} event - AMB event (kind 30142)
 * @returns {Array<{url: string, mimeType: string, size: number, sha256?: string, name?: string}>} Array of uploaded files
 */
export function getAMBEncodings(event) {
  // Get all encoding-related tags
  const contentUrls = getNestedTagValues(event.tags, 'encoding:contentUrl');
  const encodingFormats = getNestedTagValues(event.tags, 'encoding:encodingFormat');
  const contentSizes = getNestedTagValues(event.tags, 'encoding:contentSize');
  const sha256Hashes = getNestedTagValues(event.tags, 'encoding:sha256');

  // Reconstruct file objects
  return contentUrls.map((url, index) => {
    // Extract filename from URL (last part after /)
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1] || 'file';

    return {
      url,
      mimeType: encodingFormats[index] || 'application/octet-stream',
      size: parseInt(contentSizes[index]) || 0,
      sha256: sha256Hashes[index],
      name: filename
    };
  });
}

/**
 * Formats AMB resource for display with language-aware labels.
 * Combines all relevant metadata into a structured object.
 *
 * Labels for subjects, learning resource types, and educational levels
 * use the following fallback order:
 * 1. User's preferred language (e.g., 'de')
 * 2. English ('en')
 * 3. ID as final fallback
 *
 * @param {any} event - AMB event (kind 30142)
 * @param {string} [lang='en'] - User's preferred language code for labels
 * @returns {Object} Formatted resource object
 */
export function formatAMBResource(event, lang = 'en') {
  return {
    id: event.id,
    identifier: getAMBIdentifier(event),
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    name: getAMBName(event),
    description: getAMBDescription(event),
    image: getAMBImage(event),
    types: getAMBTypes(event),
    learningResourceTypes: getAMBLearningResourceTypes(event, lang),
    subjects: getAMBSubjects(event, lang),
    educationalLevels: getAMBEducationalLevels(event, lang),
    keywords: getAMBKeywords(event),
    languages: getAMBLanguages(event),
    license: getAMBLicense(event),
    isFree: isAMBFree(event),
    publishedDate: getAMBPublishedDate(event),
    creatorNames: getAMBCreatorNames(event),
    resourceURLs: getAMBResourceURLs(event),
    primaryURL: getAMBPrimaryURL(event),
    encodings: getAMBEncodings(event),
    externalUrl: getAMBExternalUrl(event), // Deprecated: use externalUrls
    externalUrls: getAMBExternalUrls(event),
    tags: event.tags, // Keep original tags for reference
    rawEvent: event // Keep original raw Nostr event for debug purposes
  };
}

/**
 * @typedef {Object} AMBRelationRef
 * @property {string} coordinate - Full `kind:pubkey:dTag` coordinate
 * @property {string} pubkey - Author pubkey extracted from coordinate
 * @property {string} dTag - d-tag extracted from coordinate (may be empty)
 * @property {string | undefined} relayHint - Optional relay hint from the tag's 3rd slot
 */

/**
 * Bounded split for a `kind:pubkey:dTag` coordinate — only splits on the
 * first two colons so a d-tag that is a URL (e.g. `https://…`) is preserved.
 * @param {string} coord
 * @returns {{kind: string, pubkey: string, dTag: string} | null}
 */
function splitCoord(coord) {
  const i = coord.indexOf(':');
  if (i < 0) return null;
  const j = coord.indexOf(':', i + 1);
  if (j < 0) return null;
  return {
    kind: coord.slice(0, i),
    pubkey: coord.slice(i + 1, j),
    dTag: coord.slice(j + 1)
  };
}

/**
 * Reads relation `a`-tags carrying the given marker from an AMB event.
 * Skips tags whose coordinate is not in `kind:pubkey:dTag` form.
 *
 * @param {{tags?: Array<Array<string>>} | null | undefined} event
 * @param {'hasPart' | 'isPartOf' | 'isBasedOn'} marker
 * @returns {AMBRelationRef[]}
 */
function readRelations(event, marker) {
  /** @type {AMBRelationRef[]} */
  const out = [];
  for (const t of event?.tags ?? []) {
    if (t[0] !== 'a' || t[3] !== marker) continue;
    const coord = t[1] ?? '';
    const parts = splitCoord(coord);
    if (!parts || !parts.kind || !parts.pubkey) continue;
    out.push({
      coordinate: coord,
      pubkey: parts.pubkey,
      dTag: parts.dTag,
      relayHint: t[2] ? t[2] : undefined
    });
  }
  return out;
}

/**
 * Extracts `hasPart` relation references from an AMB event.
 * @param {{tags?: Array<Array<string>>} | null | undefined} event
 * @returns {AMBRelationRef[]}
 */
export function getAMBHasPart(event) {
  return readRelations(event, 'hasPart');
}

/**
 * Extracts `isPartOf` relation references from an AMB event.
 * @param {{tags?: Array<Array<string>>} | null | undefined} event
 * @returns {AMBRelationRef[]}
 */
export function getAMBIsPartOf(event) {
  return readRelations(event, 'isPartOf');
}
