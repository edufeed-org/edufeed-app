/**
 * AMB JSON-LD Builder
 *
 * Transforms kind 30142 events into AMB-compliant JSON-LD for embedding
 * in HTML pages via <script type="application/ld+json">.
 *
 * Uses the amb-nostr-converter library for complete AMB spec compliance.
 *
 * @see https://dini-ag-kim.github.io/amb/draft/
 * @see https://git.edufeed.org/edufeed/amb-nostr-converter
 */

import { nostrToAmb } from 'amb-nostr-converter';

/**
 * @typedef {Object} AMBResource
 * @property {string} [identifier] - Resource identifier (d-tag value)
 * @property {string} name - Resource name
 */

/**
 * Builds AMB-compliant JSON-LD from a kind 30142 event.
 *
 * Uses the amb-nostr-converter library for complete property extraction,
 * then overrides the `id` field based on resource type:
 * - External resources (d-tag is a URL): use that URL
 * - Nostr-native content: use the page URL
 *
 * @param {import('amb-nostr-converter').NostrEvent} event - Raw Nostr event (kind 30142)
 * @param {AMBResource} resource - Formatted resource from formatAMBResource()
 * @param {string} pageUrl - The Communikey page URL for this resource
 * @returns {Object} JSON-LD object ready for serialization
 */
export function buildAMBJsonLd(event, resource, pageUrl) {
  // Use library to convert Nostr event to AMB JSON-LD
  const result = nostrToAmb(event);

  if (!result.success || !result.data) {
    // Fallback to minimal JSON-LD if conversion fails
    console.warn('AMB JSON-LD conversion failed:', result.error);
    return {
      '@context': 'https://w3id.org/kim/amb/context.jsonld',
      id: pageUrl,
      type: ['LearningResource'],
      name: resource.name
    };
  }

  /** @type {Record<string, any>} */
  const jsonLd = result.data;

  // Override id based on resource type:
  // - External resources (d-tag is URL): use that URL as canonical ID
  // - Nostr-native (slug d-tag): the library derives a nostr:<naddr> id; per
  //   NIP-AMB consumers MAY substitute a dereferenceable landing-page URL,
  //   which is what we do here (AMB prefers dereferenceable HTTP URIs).
  const isExternalResource =
    resource.identifier?.startsWith('http://') || resource.identifier?.startsWith('https://');
  jsonLd.id = isExternalResource ? resource.identifier : pageUrl;

  return jsonLd;
}
