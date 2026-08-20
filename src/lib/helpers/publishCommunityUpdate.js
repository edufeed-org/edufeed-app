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
 * Plain (non-reactive) copy of a template's tags. The source 10222 lives in
 * Svelte component `$state`, so its tag entries — reused verbatim by the
 * flip/attach/access-tier builders — are deep reactive proxies. In-process
 * signers (nsec) sign those fine, but a NIP-07 extension signer serialises the
 * template through `window.postMessage`, and structuredClone throws
 * `DataCloneError` on a Svelte proxy. Rebuilding each tag as a plain string
 * array (elements are always strings) de-proxies it; nothing else in a 10222
 * template is a proxy (kind/created_at are numbers, content a string).
 * @param {any} template
 */
function plainTemplate(template) {
  return {
    ...template,
    tags: Array.isArray(template?.tags)
      ? template.tags.map((/** @type {string[]} */ tag) => [...tag])
      : template?.tags
  };
}

/**
 * @param {any} template unsigned kind-10222
 * @param {any} communitySigner
 */
export async function publishCommunityUpdate(template, communitySigner) {
  const signed = await communitySigner.signEvent(plainTemplate(template));
  const [{ publishEvent }, { eventStore }, { getCommunityGlobalRelays }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/communityRelays.js')
  ]);
  await publishEvent(signed, [], { additionalRelays: getCommunityGlobalRelays(signed) });
  eventStore.add(signed);
  return signed;
}
