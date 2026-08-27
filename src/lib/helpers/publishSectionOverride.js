// Sign a kind-30223 content-section override with the ACTING USER's key —
// the whole point of the override is that a root-group admin can reshape the
// community's public surface without the community keypair
// (src/lib/groups/section-override.js).
//
// Deliberately mirrors publishCommunityUpdate's shape, including the
// optimistic eventStore.add so the settings pane and the tabs flip
// immediately instead of waiting for the event to come back from a relay,
// and the heavy dynamic imports so importing this adds no static edge into
// the publish dep tree.
import { plainTemplate } from './plain-template.js';
import { buildSectionOverrideTemplate } from '$lib/groups/section-override.js';

/**
 * @param {string} communityPubkey
 * @param {import('$lib/groups/section-override.js').SectionInput[]} sections
 * @param {any} account the signed-in account (manager.active / useActiveUser)
 * @param {any} communityEvent kind 10222, for its own configured relays
 */
export async function publishSectionOverride(communityPubkey, sections, account, communityEvent) {
  const template = buildSectionOverrideTemplate(communityPubkey, sections);
  // Strictly newer than any override this client already knows about is not
  // enough — it must also beat the 10222, or resolveCommunitySections keeps
  // the owner's sections. Date.now() clears both in practice; the max() is
  // there for a community whose 10222 carries a future timestamp.
  const created_at = Math.max(Math.floor(Date.now() / 1000), (communityEvent?.created_at ?? 0) + 1);
  const signed = await account.signEvent(plainTemplate({ ...template, created_at }));

  const [{ publishEvent }, { eventStore }, { getCommunityGlobalRelays }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/communityRelays.js')
  ]);
  await publishEvent(signed, [], {
    additionalRelays: getCommunityGlobalRelays(communityEvent)
  });
  eventStore.add(signed);
  return signed;
}
