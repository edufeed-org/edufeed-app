// src/lib/groups/join-community-group.js
//
// Applicant side of a moderated community's join flow: a bare or
// invite-coded NIP-29 kind-9021 request against the community's root group
// (see community-membership.js for the ["membership", id, relay] pointer
// this targets). Membership itself is never granted here — the relay/admin
// side (Task 5/7) decides; this sends the request, mirrors the group into the
// user's kind-10009 list (what every NIP-29 client does on a join click) and
// lets the caller react to acceptance or refusal.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildJoinRequestTemplate } from './groups.js';
import { publishToGroupRelay } from './group-management.js';
import { communityGroupsEndpoint } from './community-endpoint.js';
import { updatePersonalGroupsList } from './personal-groups-list.js';

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
  // Listed under the community's own /c address, like the channels the
  // wizard writes. Best-effort: the request is out, a failed list write must
  // not read as a failed join.
  await updatePersonalGroupsList(user, {
    add: { id: pointer.id, relay: communityGroupsEndpoint(pointer.relay, pointer.id) }
  }).catch(() => {});
}
