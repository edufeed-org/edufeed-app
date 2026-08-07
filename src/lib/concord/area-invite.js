// Area (public/membership) direct invite. The pinned dist's grantChannelAccess
// hands over PRIVATE channel keys and throws for a public channel or an empty
// channel list ("not a private channel we hold a key for" / "no channels to
// grant"). A public channel derives its key from community_root, so inviting
// someone there = making them an AREA member — a §1 bundle with channels:[]
// gift-wrapped to the invitee (CORD-05 §6), i.e. exactly what grantChannelAccess
// builds minus the private keys. Dynamic imports keep the concord dep tree out
// of SSR chunks (mirror send-message.js + the src/lib/concord convention).

/**
 * @param {any} community ConcordCommunity
 * @param {string} member invitee pubkey (hex)
 * @returns {Promise<void>}
 */
export async function directInviteToArea(community, member) {
  const { buildInviteBundle } = await import('applesauce-concord/helpers');
  const { DirectInviteFactory } = await import('applesauce-concord/factories');
  const state = community.state$?.value;
  const bundle = buildInviteBundle(community.material, {
    name: state?.metadata?.name,
    icon: state?.metadata?.icon,
    creator_npub: community.pubkey,
    channels: []
  });
  const wrap = await DirectInviteFactory.create(bundle, member, community.signer);
  community.eventStore.add(wrap);
  await community.pool
    .publish(community.relays(), wrap)
    .catch((/** @type {any} */ e) => console.warn('concord: area invite publish failed', e));
}
