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
 * Append one `["p", pubkey, relayHint, <role>]` tag per person that has a
 * valid Nostr pubkey (hex or npub, normalized to hex). The role is `creator`
 * unless the entry carries `role: 'contributor'` (NIP-AMB AMB.md l.26/93).
 * People without a pubkey are skipped — anything that doesn't normalize
 * (nsec, typos) must never end up in a public tag.
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
    tags.push([
      'p',
      hexPubkey,
      relayHint,
      creator.role === 'contributor' ? 'contributor' : 'creator'
    ]);
  }
}

/**
 * Append the flattened `creator:*` / `contributor:*` run for every person
 * WITHOUT a Nostr identity (NIP-AMB AMB.md l.81-93) — people with a valid
 * pubkey are represented by their p-tag alone (appendCreatorPTags), never
 * twice. Each person's fields are emitted consecutively so readers can
 * split the run (getAMBCreators).
 *
 * @param {string[][]} tags - Mutated
 * @param {Creator[] | undefined} creators
 * @returns {void}
 */
export function appendFlattenedPeopleTags(tags, creators) {
  for (const person of creators || []) {
    const name = person.name?.trim();
    if (!name || normalizePubkey(person.pubkey)) continue;
    const prefix = person.role === 'contributor' ? 'contributor' : 'creator';
    tags.push([`${prefix}:type`, person.type || 'Person']);
    tags.push([`${prefix}:name`, name]);
    if (person.honorificPrefix) tags.push([`${prefix}:honorificPrefix`, person.honorificPrefix]);
    if (person.affiliationName) tags.push([`${prefix}:affiliation:name`, person.affiliationName]);
    if (person.orcid) tags.push([`${prefix}:id`, person.orcid]);
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

/**
 * Interactive (webxdc) resources: mark the event launchable and pin the
 * package hash for execution-time integrity verification (NIP-DC).
 * @param {string[][]} tags
 * @param {Array<{type?: string, sha256?: string}> | undefined} files
 */
export function appendInteractiveTags(tags, files) {
  const pkg = (files ?? []).find((f) => f.type === 'application/x-webxdc');
  if (!pkg) return;
  tags.push(['m', 'application/x-webxdc']);
  if (pkg.sha256) tags.push(['x', pkg.sha256]);
}
