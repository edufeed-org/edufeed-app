// The user's kind-10009 GROUPS list, updated in place. Published to the
// user's OWN relays (outbox), never the group relay — the list is what makes
// joined and created groups roam across devices. Extracted from GroupChat so
// the relay page's create flow and the chat's join/leave speak through one
// door.
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { buildGroupsListTemplate } from './groups.js';

/**
 * @param {{pubkey: string, signer: any} | null | undefined} user
 * @param {{add?: {id: string, relay: string}, remove?: {id: string, relay: string} | {id: string, relay: string}[]}} change
 */
export async function updatePersonalGroupsList(user, change) {
  if (!user?.signer) return;
  const existing = eventStore.getReplaceable(10009, user.pubkey) ?? null;
  const template = buildGroupsListTemplate(existing, change);
  const signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
  eventStore.add(signed);
  publishEventOptimistic(signed);
}
