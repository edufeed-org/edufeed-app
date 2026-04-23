/**
 * Resolve the metadata-form variant id from a published resource event.
 *
 * Events created by the multi-variant wizard carry NIP-32 label tags
 * identifying which variant produced them:
 *   ["L", "metadata-form"]
 *   ["l", "<variantId>", "metadata-form"]
 *
 * Legacy events (created before the variant system) lack these tags; we
 * fall back to `'amb'` so the edit flow keeps working. Events tagged with a
 * variant that isn't enabled on this deployment also fall back to `'amb'`.
 */

import { getVariantById } from '$lib/config/resource-form-variants.js';

/**
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string} — an enabled variant id, guaranteed present in the registry
 */
export function resolveVariantIdFromEvent(event) {
  const tag = event?.tags?.find((t) => t[0] === 'l' && t[2] === 'metadata-form');
  const candidate = tag?.[1];
  if (!candidate) return 'amb';
  return getVariantById(candidate) ? candidate : 'amb';
}
