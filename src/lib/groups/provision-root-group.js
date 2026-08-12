// Mints the NIP-29 ROOT group for a moderated community — the group whose
// roster/roles ARE the membership (docs/nips/communikey-groups.md). Runs with
// the HUMAN creator's signer, and BEFORE any account switch in the creation
// flow (same constraint as Concord founding: src/lib/concord/founding.js).
//
// Founding marker: if the group is created but the 10222 publish fails,
// re-running the wizard must reuse the pending group instead of littering
// the relay — identical shape to Concord's readFoundingMarker.
import { generateGroupId, createGroupOnRelay, confirmGroupMetadata } from './group-management.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

const MARKER_PREFIX = 'groups:root-founding:';

/** @returns {Storage | null} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {string} communityPubkey
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 * @returns {string | null}
 */
export function readRootGroupMarker(communityPubkey, storage = defaultStorage()) {
  return storage?.getItem(MARKER_PREFIX + communityPubkey) ?? null;
}

/**
 * @param {string} communityPubkey
 * @param {string} groupId
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 */
export function writeRootGroupMarker(communityPubkey, groupId, storage = defaultStorage()) {
  storage?.setItem(MARKER_PREFIX + communityPubkey, groupId);
}

/**
 * @param {string} communityPubkey
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 */
export function clearRootGroupMarker(communityPubkey, storage = defaultStorage()) {
  storage?.removeItem(MARKER_PREFIX + communityPubkey);
}

/**
 * @param {{relay: string, name: string, user: {pubkey: string, signer: any}, existingId?: string | null}} args
 * @returns {Promise<{id: string, relay: string}>}
 */
export async function provisionRootGroup({ relay, name, user, existingId = null }) {
  const relayConn = pool.relay(relay);
  if (existingId) {
    const confirmed = await confirmGroupMetadata(relayConn, existingId);
    if (confirmed) return { id: existingId, relay };
  }
  const id = generateGroupId();
  // isOpen: false → `closed`: join requests are relay-ignored for now; Plan 4's
  // join flow decides open-vs-closed against live relay behavior. isPublic:
  // true → metadata/roster world-readable, which the public gating verifiability
  // story depends on.
  await createGroupOnRelay({
    relayConn,
    id,
    metadata: { name, isPublic: true, isOpen: false },
    user
  });
  return { id, relay };
}
