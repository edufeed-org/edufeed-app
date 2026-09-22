/**
 * Which identity signs a root-roster moderation event (put-user,
 * remove-user, create-invite).
 *
 * The members surfaces open for two kinds of actor: a pubkey the group's
 * 39001 lists with a moderation role, and the key-holding owner
 * (isCommunityOwner). A NIP-29 relay honours only the former — it checks the
 * signing pubkey against the 39001. On the Edufeed community that list holds
 * the community key alone, so the owner's personal account got "not allowed"
 * (laoc, 2026-09-22). Owner actions everywhere else already sign with the
 * community signer (publishCommunityUpdate, pin lists); this makes roster
 * management do the same instead of hiding the section.
 *
 * Call from an event handler, not a $derived: getCommunitySigner reads the
 * account manager.
 */
import { isModerator } from './roles.js';
import { getCommunitySigner } from '$lib/helpers/community-signer.js';

/**
 * @param {{pubkey: string, signer: any} | null | undefined} activeUser
 * @param {{pubkey: string, roles: string[]}[] | undefined} admins - the group's 39001 roster
 * @param {string | null | undefined} communityPubkey - null for per-channel contexts
 * @returns {{pubkey: string, signer: any} | null}
 */
export function resolveGroupActor(activeUser, admins, communityPubkey) {
  if (!activeUser) return null;
  if (isModerator(admins, activeUser.pubkey)) return activeUser;
  const signer = communityPubkey ? getCommunitySigner(communityPubkey) : null;
  if (signer && communityPubkey) return { pubkey: communityPubkey, signer };
  // Not a moderator and no community key: let the relay decide (and refuse).
  return activeUser;
}
