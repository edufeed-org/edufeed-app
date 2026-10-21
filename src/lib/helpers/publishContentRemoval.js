// src/lib/helpers/publishContentRemoval.js
//
// Write side of removing content from a community (data model:
// src/lib/groups/content-removal.js). Mirrors publishSectionOverride's shape:
// sign with whichever key has authority, publish to the community's relays
// on top of the outbox union, add optimistically so the item disappears at
// once instead of waiting for the relay round trip.
import { plainTemplate } from './plain-template.js';
import { buildContentRemovalTemplate, removalAuthorities } from '$lib/groups/content-removal.js';
import { isModerator } from '$lib/groups/roles.js';
import { getCommunitySigner } from '$lib/helpers/community-signer.js';
import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';

/**
 * Relays every removal and every undo must reach: the community's own
 * relays (where its readers look) plus the app's communikey relays (where
 * logged-out readers on a default deployment look). publishEvent adds the
 * signer's NIP-65 write relays on top.
 * @param {any} communityEvent
 * @returns {string[]}
 */
function removalRelays(communityEvent) {
  return unique([...getCommunityGlobalRelays(communityEvent), ...getCommunikeyRelays()]);
}

/**
 * Which key signs a removal. A moderator's OWN key wins when they hold a
 * moderation role: the label then names who acted, and demoting them revokes
 * it (content-removal.js validity). Otherwise the community key, if this
 * browser holds it — the only authority on an open or closed community.
 * @param {{communityEvent: any, admins?: Array<{pubkey: string, roles?: string[]}> | null, activeUser: any}} params
 * @returns {{pubkey: string, signer: any} | null}
 */
export function pickRemovalSigner({ communityEvent, admins, activeUser }) {
  const communityPubkey = communityEvent?.pubkey;
  if (!communityPubkey) return null;
  const authorities = removalAuthorities(communityEvent, admins);
  if (
    activeUser?.pubkey &&
    activeUser.signer &&
    authorities.includes(activeUser.pubkey) &&
    isModerator(admins, activeUser.pubkey)
  ) {
    return { pubkey: activeUser.pubkey, signer: activeUser.signer };
  }
  const communitySigner = getCommunitySigner(communityPubkey);
  if (communitySigner) return { pubkey: communityPubkey, signer: communitySigner };
  return null;
}

/**
 * Publish a removal label for `event` in `communityEvent`'s community.
 * @param {any} event the content event (raw; callers unwrap `originalEvent`)
 * @param {any} communityEvent kind 10222
 * @param {{admins?: Array<{pubkey: string, roles?: string[]}> | null, activeUser: any}} ctx
 * @returns {Promise<any>} the signed label
 */
export async function removeFromCommunity(event, communityEvent, { admins, activeUser }) {
  const picked = pickRemovalSigner({ communityEvent, admins, activeUser });
  if (!picked) throw new Error('Not allowed to remove content from this community');

  const relays = removalRelays(communityEvent);
  const template = buildContentRemovalTemplate(communityEvent.pubkey, event, relays[0] ?? '');
  const created_at = Math.floor(Date.now() / 1000);
  const signed = await picked.signer.signEvent(plainTemplate({ ...template, created_at }));

  const [{ publishEvent }, { eventStore }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte')
  ]);
  await publishEvent(signed, [], { additionalRelays: relays });
  eventStore.add(signed);
  return signed;
}

/**
 * Whether THIS browser can undo a removal: NIP-09 is author-only, so it
 * needs the label author's key (a moderator's own account, or the community
 * key for owner-signed labels).
 * @param {any} label
 * @returns {boolean}
 */
export function canRestoreRemoval(label) {
  return !!label?.pubkey && getCommunitySigner(label.pubkey) !== null;
}

/**
 * Undo a removal: a NIP-09 deletion of the label, signed by its author.
 * @param {any} label the kind-1985 removal event
 * @param {any} communityEvent kind 10222
 */
export async function restoreToCommunity(label, communityEvent) {
  const signer = getCommunitySigner(label?.pubkey);
  if (!signer) throw new Error('The key that removed this item is not available here');
  const { deleteEvent } = await import('$lib/helpers/eventDeletion.js');
  const result = await deleteEvent(
    label,
    { pubkey: label.pubkey, signer },
    { additionalRelays: removalRelays(communityEvent) }
  );
  if (!result.success) throw new Error(result.error ?? 'Restore failed');
}
