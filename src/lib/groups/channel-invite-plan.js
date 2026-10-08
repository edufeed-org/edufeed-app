// Who gets which NIP-29 put-user when a channel is created with invitees
// (ChannelCreateWizard, NIP-29 mode). Pure.
//
// Issue wcm40ukc: the wizard's people step only offered community members
// and the admin's follows, and an outsider added by npub got a channel seat
// but no community seat — a member of one channel who is not on the root
// roster sees the join lane on the community page and is gated out of every
// `members` section. Inviting someone into a channel of a moderated
// community means inviting them into the community: outsiders are admitted
// to the root group first (same put-user the Beitrittsanfragen approval
// sends), then seated on the channel.
import { unique } from '$lib/helpers/unique.js';

/**
 * @param {{
 *   selected: string[],
 *   self: string | null | undefined,
 *   rootPointer: {id: string, relay: string} | null | undefined,
 *   rootMembers: Iterable<string> | null | undefined
 * }} args
 * @returns {{channel: string[], root: string[]}} pubkeys to seat on the new
 *   channel, and the subset that must be admitted to the root group first.
 *   `root` is empty when the community has no root group (nothing to admit
 *   to) — it never guesses.
 */
export function channelInvitePlan({ selected, self, rootPointer, rootMembers }) {
  const channel = unique(selected ?? []).filter(
    (pubkey) => typeof pubkey === 'string' && pubkey && pubkey !== self
  );
  if (!rootPointer?.id) return { channel, root: [] };
  const onRoot = new Set(rootMembers ?? []);
  return { channel, root: channel.filter((pubkey) => !onRoot.has(pubkey)) };
}
