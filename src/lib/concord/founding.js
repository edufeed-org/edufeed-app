// Founding flow: create the Concord community backing a Communikey community
// and publish the updated kind-10222 with the pointer tag. Only imports
// pointer.js/client.svelte.js at the top level (both SSR-safe, no top-level
// package imports) — publish-service.js and nostr-infrastructure.svelte are
// dynamically imported so this module stays importable from the wizard
// component without adding a new static edge into the concord dep tree.
import { withConcordPointer } from './pointer.js';
import { getConcordClient } from './client.svelte.js';

/**
 * Unsigned kind-10222 template with the concord pointer set. Preserves all
 * other tags + content; bumps created_at past the source event.
 * @param {any} communikeyEvent
 * @param {string} communityId
 * @param {string} [relay]
 */
export function buildPointerUpdate(communikeyEvent, communityId, relay) {
  return {
    kind: 10222,
    content: communikeyEvent.content ?? '',
    tags: withConcordPointer(communikeyEvent.tags ?? [], communityId, relay),
    created_at: Math.max(Math.floor(Date.now() / 1000), (communikeyEvent.created_at ?? 0) + 1)
  };
}

/**
 * Found the Concord community backing a Communikey community and publish the
 * pointer. Concord owner = the human owner's PERSONAL key (client signer);
 * the community signer only signs the 10222 update (spec §3.1).
 *
 * The 10222 update goes through the NORMAL publish path (`publishEvent`,
 * outbox model) since it's a Communikey event like any other — only Concord's
 * own 1059 traffic bypasses it. `additionalRelays` mirrors
 * EditCommunityModal's pattern for republishing a community's own 10222: the
 * community's already-configured relays (`getCommunityGlobalRelays`) must be
 * included explicitly, since they may not overlap with the deployment's
 * shared communikey app relays.
 * @param {{communikeyEvent: any, communityName: string, relays: string[], communitySigner: any}} args
 * @returns {Promise<{community: any, communityId: string}>}
 */
export async function foundConcordArea({
  communikeyEvent,
  communityName,
  relays,
  communitySigner
}) {
  const client = getConcordClient();
  if (!client) throw new Error('Concord client not ready');
  if (!communitySigner) throw new Error('No signer available for this community');
  const community = await client.createNewCommunity(communityName, '', relays);
  const communityId = community.communityId;

  const template = buildPointerUpdate(communikeyEvent, communityId, relays[0]);
  const signed = await communitySigner.signEvent(template);
  const [{ publishEvent }, { eventStore }, { getCommunityGlobalRelays }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/communityRelays.js')
  ]);
  await publishEvent(signed, [], { additionalRelays: getCommunityGlobalRelays(signed) });
  eventStore.add(signed);
  return { community, communityId };
}
