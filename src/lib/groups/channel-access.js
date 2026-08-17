// Which access level a community channel has, and how the rail draws it.
//
// Three levels, one glyph + two badges (design §1, presentation revised
// 2026-08-17 to match Armada's rail — laoc):
//   world    #  + trailing globe — anyone on the network can read
//   members  #                   — everyone inside this community can read
//   invited  #  + trailing lock  — only the people put in this channel
//
// Only the FIRST split is observable on the relay: a kind:39000 either carries
// `private` or it does not. Levels "members" and "invited" are the same object
// there — both are a private group with a member list, differing only in who
// our client puts on it. So the second split is read from OUR ["group", …]
// pointer, whose 5th element carries the community's intent.
//
// That marker can drift from the relay's member list. It is therefore used
// ONLY to pick the badge, never to decide what is fetched or shown: reading is
// enforced by the relay either way. And when it is missing or unrecognised we
// fall back to the lock — overstating openness is the harmful direction.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';

/**
 * @typedef {'world' | 'members' | 'invited' | 'unknown'} ChannelAccessLevel
 */

/**
 * @param {{ kind?: number, tags?: string[][] } | null | undefined} metadata
 *   the channel's kind:39000, or null while it has not loaded
 * @param {{ access?: string } | null | undefined} pointer
 *   the community's ["group", id, relay, name, access] pointer
 * @param {boolean} [hostRequiresAuth] the HOST gates every read behind
 *   NIP-42 (NIP-11 auth_required, or a REQ closed auth-required). A group
 *   without `private` on such a relay is readable by whoever the relay
 *   admits — not by the world, whatever its own tags omit.
 * @returns {ChannelAccessLevel}
 */
export function channelAccessLevel(metadata, pointer, hostRequiresAuth = false) {
  if (!metadata || metadata.kind !== GROUP_METADATA_KIND || !Array.isArray(metadata.tags)) {
    return 'unknown';
  }
  // Openness is stated by the ABSENCE of `private`. Do not read applesauce's
  // isPublic/isOpen here: they come from the dropped inverse tags of an older
  // NIP-29 draft, so they are false on every spec-current relay.
  const isPrivate = metadata.tags.some((t) => t[0] === 'private');
  if (!isPrivate) return hostRequiresAuth ? 'members' : 'world';
  return pointer?.access === 'members' ? 'members' : 'invited';
}

/**
 * How the channel row is drawn for a level. Every row leads with '#' — the
 * access level rides as trailing badges (globe for world, lock for invited),
 * so closedness never costs the row its channel affordance.
 * @param {ChannelAccessLevel} level
 * @returns {{ symbol: string, worldReadable: boolean, locked: boolean }}
 */
export function channelGlyph(level) {
  if (level === 'world') return { symbol: '#', worldReadable: true, locked: false };
  if (level === 'members') return { symbol: '#', worldReadable: false, locked: false };
  return { symbol: '#', worldReadable: false, locked: true };
}
