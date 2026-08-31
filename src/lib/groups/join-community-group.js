// src/lib/groups/join-community-group.js
//
// Applicant side of a moderated community's join flow: a bare or
// invite-coded NIP-29 kind-9021 request against the community's root group
// (see community-membership.js for the ["membership", id, relay] pointer
// this targets). Membership itself is never granted here — the relay/admin
// side (Task 5/7) decides; this only sends the request and lets the caller
// react to acceptance or refusal.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildJoinRequestTemplate } from './groups.js';
import { publishToGroupRelay } from './group-management.js';

/**
 * Send a kind-9021 join request for a moderated community's root group.
 * Rethrows the relay's rejection reason (e.g. via {@link isMembershipRefusal}
 * in groups.js) so the caller can toast it.
 * @param {{
 *   pointer: {id: string, relay: string},
 *   code?: string | null,
 *   user: {pubkey: string, signer: any}
 * }} args
 * @returns {Promise<void>}
 */
export async function joinCommunityGroup({ pointer, code = null, user }) {
  const relayConn = pool.relay(pointer.relay);
  const template = buildJoinRequestTemplate(pointer.id, code ?? undefined);
  await publishToGroupRelay(relayConn, template, user);
}
