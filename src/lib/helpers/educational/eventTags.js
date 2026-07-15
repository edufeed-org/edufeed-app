/**
 * Shared tag-assembly helpers for AMB (kind 30142) events.
 *
 * Extracted from `educational-actions.svelte.js` so `createResource` and
 * `updateResource` can reuse the same tag-composition logic. Helpers mutate
 * the passed `tags` array in place (matching the pre-refactor inline style)
 * and preserve the exact tag shapes the inline code produced.
 */

import { normalizePubkey } from '$lib/helpers/pubkey.js';

/**
 * @typedef {import('$lib/stores/educational-actions.svelte.js').Creator} Creator
 */

/**
 * Append one `["p", pubkey, relayHint, "creator"]` tag per creator that has a
 * valid Nostr pubkey (hex or npub, normalized to hex). Creators without one
 * are skipped — anything that doesn't normalize (nsec, typos) must never end
 * up in a public tag.
 *
 * @param {string[][]} tags - Mutated
 * @param {Creator[] | undefined} creators
 * @param {(pubkey: string) => Promise<string>} resolveRelayHint
 * @returns {Promise<void>}
 */
export async function appendCreatorPTags(tags, creators, resolveRelayHint) {
  if (!creators || creators.length === 0) return;
  for (const creator of creators) {
    if (!creator.pubkey) continue;
    const hexPubkey = normalizePubkey(creator.pubkey);
    if (!hexPubkey) continue;
    const relayHint = await resolveRelayHint(hexPubkey);
    tags.push(['p', hexPubkey, relayHint, 'creator']);
  }
}

/**
 * Append one `["r", trimmedUrl]` tag per non-empty external URL (NIP-24).
 *
 * @param {string[][]} tags - Mutated
 * @param {string[] | undefined} urls
 * @returns {void}
 */
export function appendExternalUrlTags(tags, urls) {
  if (!urls || urls.length === 0) return;
  for (const url of urls) {
    const trimmed = url?.trim();
    if (trimmed) tags.push(['r', trimmed]);
  }
}

/**
 * Append NIP-32 label tags identifying which metadata-form variant produced
 * this event. Always pushes two tags in this order:
 *   ["L", "metadata-form"]
 *   ["l", variantId, "metadata-form"]
 *
 * @param {string[][]} tags - Mutated
 * @param {string} variantId
 * @returns {void}
 */
export function appendVariantLabelTags(tags, variantId) {
  tags.push(['L', 'metadata-form']);
  tags.push(['l', variantId, 'metadata-form']);
}
