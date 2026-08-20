// Mints the NIP-29 ROOT group for a moderated community — the group whose
// roster/roles ARE the membership (docs/nips/communikey-groups.md). Runs with
// the HUMAN creator's signer, and BEFORE any account switch in the creation
// flow (same constraint as Concord founding: src/lib/concord/founding.js).
//
// Founding marker: if the group is created but the 10222 publish fails,
// re-running the wizard must reuse the pending group instead of littering
// the relay — identical shape to Concord's readFoundingMarker.
import {
  generateGroupId,
  createGroupOnRelay,
  confirmGroupMetadata,
  confirmGroupAdmins,
  buildPutUserTemplate,
  publishToGroupRelay
} from './group-management.js';
import { getGroupAdmins } from 'applesauce-common/helpers/groups';
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
 * Fail-safe admin check for a founding marker's group id: any error, timeout,
 * or absent/empty 39001 means "not verified" — the caller must treat the
 * marker as unusable and create a fresh group rather than pointing the
 * community at a foreign or unconfirmed roster. Never throws.
 * @param {any} relayConn
 * @param {string} groupId
 * @param {string} pubkey
 * @returns {Promise<boolean>}
 */
async function isConfirmedGroupAdmin(relayConn, groupId, pubkey) {
  try {
    const adminsEvent = await confirmGroupAdmins(relayConn, groupId);
    if (!adminsEvent) return false;
    const admins = getGroupAdmins(adminsEvent) ?? [];
    return admins.some((admin) => admin.pubkey === pubkey);
  } catch {
    return false;
  }
}

/**
 * Seat the community pubkey itself as a 39001 admin (role 'admin', signed by
 * the human creator — measured accepted on groups.0xchat.com 2026-08-14).
 * Load-bearing, not cosmetic: roster put/remove ops must be signable while
 * the community account is the ACTIVE one — the state the creation wizard
 * leaves the creator in. Without the seat, the community account cannot
 * manage its own roster (journey-test bugs #2/#3). A failed seat fails provisioning: a community that cannot
 * manage itself must not be created (the founding marker makes re-runs
 * recover and re-seat).
 * @param {any} relayConn
 * @param {string} groupId
 * @param {{pubkey: string, signer: any}} user
 * @param {string | undefined} communityPubkey
 */
async function seatCommunityAdmin(relayConn, groupId, user, communityPubkey) {
  if (!communityPubkey || communityPubkey === user.pubkey) return;
  await publishToGroupRelay(
    relayConn,
    buildPutUserTemplate(groupId, communityPubkey, ['admin']),
    user
  );
}

/**
 * @param {{relay: string, name: string, about?: string, picture?: string, user: {pubkey: string, signer: any}, existingId?: string | null, communityPubkey?: string}} args
 * @returns {Promise<{id: string, relay: string}>}
 */
export async function provisionRootGroup({
  relay,
  name,
  about,
  picture,
  user,
  existingId = null,
  communityPubkey
}) {
  const relayConn = pool.relay(relay);
  if (existingId) {
    const confirmed = await confirmGroupMetadata(relayConn, existingId);
    // Metadata confirmation alone isn't enough — a poisoned/stale marker could
    // point at a group the current user isn't (or no longer is) an admin of.
    // Verify the roster before reuse.
    if (confirmed && (await isConfirmedGroupAdmin(relayConn, existingId, user.pubkey))) {
      // Re-seat on reuse: the pending group may predate the community-admin
      // seat (idempotent — 39001 is replaceable relay state).
      await seatCommunityAdmin(relayConn, existingId, user, communityPubkey);
      return { id: existingId, relay };
    }
  }
  const id = generateGroupId();
  // isOpen: false → `closed`: join requests are relay-ignored for now; Plan 4's
  // join flow decides open-vs-closed against live relay behavior. isPublic:
  // true → metadata/roster world-readable, which the public gating verifiability
  // story depends on.
  // Seed the community's picture + about onto the root group's 39000 so the
  // per-community /c NIP-11 (synthesized from it) shows an icon + description
  // in clients like Armada. Same fields A7's syncRootGroupMetadata keeps in
  // step on later profile edits, sourced from the community's kind-0 — seed
  // from that same source so the first edit can't overwrite the seed.
  // metadataTags drops empty values, so an absent picture/about emits no tag.
  await createGroupOnRelay({
    relayConn,
    id,
    metadata: { name, about, picture, isPublic: true, isOpen: false },
    user
  });
  await seatCommunityAdmin(relayConn, id, user, communityPubkey);
  return { id, relay };
}
