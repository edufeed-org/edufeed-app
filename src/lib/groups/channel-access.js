// Which access level a community channel has, and how the rail draws it.
//
// Three levels, two glyphs (see PLANS/EDUFEED_APP_GRUPPEN_MERGE.md §1):
//   world    #  + globe  — anyone on the network can read
//   members  #           — everyone inside this community can read
//   invited  🔒          — only the people put in this channel
//
// Only the FIRST split is observable on the relay: a kind:39000 either carries
// `private` or it does not. Levels "members" and "invited" are the same object
// there — both are a private group with a member list, differing only in who
// our client puts on it. So the second split is read from OUR ["group", …]
// pointer, whose 5th element carries the community's intent.
//
// That marker can drift from the relay's member list. It is therefore used
// ONLY to pick the glyph, never to decide what is fetched or shown: reading is
// enforced by the relay either way. And when it is missing or unrecognised we
// fall back to the LOCK — overstating openness is the harmful direction.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';

/**
 * @typedef {'world' | 'members' | 'invited' | 'unknown'} ChannelAccessLevel
 */

const LOCK = '\u{1F512}';

/**
 * @param {{ kind?: number, tags?: string[][] } | null | undefined} metadata
 *   the channel's kind:39000, or null while it has not loaded
 * @param {{ access?: string } | null | undefined} pointer
 *   the community's ["group", id, relay, name, access] pointer
 * @returns {ChannelAccessLevel}
 */
export function channelAccessLevel(metadata, pointer) {
  if (!metadata || metadata.kind !== GROUP_METADATA_KIND || !Array.isArray(metadata.tags)) {
    return 'unknown';
  }
  // Openness is stated by the ABSENCE of `private`. Do not read applesauce's
  // isPublic/isOpen here: they come from the dropped inverse tags of an older
  // NIP-29 draft, so they are false on every spec-current relay.
  const isPrivate = metadata.tags.some((t) => t[0] === 'private');
  if (!isPrivate) return 'world';
  return pointer?.access === 'members' ? 'members' : 'invited';
}

/**
 * How the channel row is drawn for a level.
 * @param {ChannelAccessLevel} level
 * @returns {{ symbol: string, worldReadable: boolean }}
 */
export function channelGlyph(level) {
  if (level === 'world') return { symbol: '#', worldReadable: true };
  if (level === 'members') return { symbol: '#', worldReadable: false };
  return { symbol: LOCK, worldReadable: false };
}
