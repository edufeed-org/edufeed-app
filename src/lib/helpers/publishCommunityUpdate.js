// Sign a kind-10222 template with the community signer and publish it through
// the normal outbox path, including the community's own configured relays —
// they may not overlap the deployment's shared communikey relays.
//
// The signed event is added to the EventStore as an optimistic local echo, so
// pointer-derived UI (the channels rail, the settings card) flips immediately
// instead of waiting for the event to come back from a relay.
//
// Extracted from concord/attach.js so the NIP-29 channel pointers publish
// through exactly the same path rather than a second copy of it. Imports are
// dynamic on purpose: callers can import this without adding a static edge
// into the publish dep tree.

/**
 * @param {any} template unsigned kind-10222
 * @param {any} communitySigner
 */
export async function publishCommunityUpdate(template, communitySigner) {
  const signed = await communitySigner.signEvent(template);
  const [{ publishEvent }, { eventStore }, { getCommunityGlobalRelays }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/communityRelays.js')
  ]);
  await publishEvent(signed, [], { additionalRelays: getCommunityGlobalRelays(signed) });
  eventStore.add(signed);
  return signed;
}
