// One channel list for a community, from two sources.
//
// A community is extended by ONE protected area — a Concord area or a set of
// NIP-29 groups — so in practice only one source is populated at a time. Both
// are merged here anyway, sorted by name rather than by source: the rail is a
// list of channels, and which protocol carries a row is not something a reader
// should have to think about.
//
// Rows are plain data. Rendering (PrivateChannelsView) stays presentational.
//
// The NIP-29 rows come from the relay SUBTREE (useCommunityChannels →
// buildSubtreeChannels), not from a kind-10222 `group` pointer: each channel
// arrives with its id/relay/name, its access `level` already computed from the
// relay's `private` flag, and its kind:39000 `metadata`. So this file no longer
// resolves metadata or level itself — it just shapes rows and merges sources.
import { channelGlyph } from './channel-access.js';
import { channelKey } from './community-pointer.js';
import { safeImageUrl } from './relay-directory.js';

// A row is one of two shapes, and which one is decided by `source`. Modelling
// that as a union rather than two optional fields lets the rail narrow on
// `source` instead of re-checking that the field it needs happens to be there.
/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   symbol: string,
 *   worldReadable: boolean,
 *   locked: boolean,
 *   accessible: boolean,
 *   pending: boolean
 * }} ChannelRowBase
 * @typedef {ChannelRowBase & {source: 'concord', channel_id: string}} ConcordChannelRow
 * @typedef {ChannelRowBase & {
 *   source: 'group',
 *   category: 'channel' | 'dm',
 *   level: import('./channel-access.js').ChannelAccessLevel,
 *   about?: string,
 *   picture?: string,
 *   pointer: {id: string, relay: string, name?: string}
 * }} GroupChannelRow
 * @typedef {ConcordChannelRow | GroupChannelRow} ChannelRow
 */
// `level` rides along with `symbol` because the glyph is lossy: '#' stands for
// both "world" and "members". The rail only needs the glyph, but the card grid
// says the level in words, and it cannot get back to the level from a '#'.

/**
 * @param {{
 *   concordChannels?: Array<{channel_id: string, name?: string, private?: boolean, accessible?: boolean}>,
 *   subtreeChannels?: Array<import('./subtree-channels.js').SubtreeChannel>,
 *   rootChannel?: import('./subtree-channels.js').SubtreeChannel | null,
 *   rootLabel?: string
 * }} input `subtreeChannels` / `rootChannel` come from useCommunityChannels
 *   (the relay subtree). `rootChannel`, when present, is pinned FIRST as the
 *   "General" channel (`rootLabel`) — its own kind:39000 name is the community
 *   name, and generic clients (Armada) list the root anyway, so naming it and
 *   placing it first makes it a purposeful #general instead of a confusing
 *   duplicate.
 * @returns {ChannelRow[]}
 */
export function buildChannelRows({
  concordChannels = [],
  subtreeChannels = [],
  rootChannel = null,
  rootLabel = ''
}) {
  /** @type {ChannelRow[]} */
  const rows = [];

  for (const channel of concordChannels) {
    if (!channel?.channel_id) continue;
    rows.push({
      key: `concord:${channel.channel_id}`,
      name: channel.name ?? channel.channel_id,
      // Concord encrypts every channel, so no row here is ever world-readable:
      // even its "public" channel means "everyone in the area", not "everyone".
      symbol: channelGlyph(channel.private ? 'invited' : 'members').symbol,
      worldReadable: false,
      locked: channelGlyph(channel.private ? 'invited' : 'members').locked,
      accessible: channel.accessible !== false,
      pending: false,
      source: 'concord',
      channel_id: channel.channel_id
    });
  }

  for (const channel of subtreeChannels) {
    const row = groupRow(channel);
    if (row) rows.push(row);
  }

  const sorted = rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // The root membership group, pinned first as "General" (its own name is the
  // community name; the label overrides it). Built like any group row so it
  // opens GroupChat on the root pointer. Skipped if it somehow already appears
  // among the channels (never should — buildSubtreeChannels returns the root
  // separately — but guard anyway to never double-list it).
  const rootRow = rootChannel ? groupRow(rootChannel, rootLabel) : null;
  if (rootRow && !sorted.some((r) => r.key === rootRow.key)) {
    return [rootRow, ...sorted];
  }

  return sorted;
}

/**
 * Shape one subtree channel (id/relay/name/level/metadata) into a GroupChannelRow.
 * @param {import('./subtree-channels.js').SubtreeChannel} channel
 * @param {string} [nameOverride] used for the root's "General" label
 * @returns {GroupChannelRow | null}
 */
function groupRow(channel, nameOverride = '') {
  const pointer = {
    id: channel.id,
    relay: channel.relay,
    ...(channel.name ? { name: channel.name } : {})
  };
  const key = channelKey(pointer);
  if (!key) return null; // unaddressable — better absent than a broken row
  const metadata = channel.metadata;
  const level = channel.level;
  const glyph = channelGlyph(level);
  return {
    key: `group:${key}`,
    name: nameOverride || channel.name || metadataName(metadata) || channel.id,
    symbol: glyph.symbol,
    worldReadable: glyph.worldReadable,
    locked: glyph.locked,
    accessible: true,
    // Metadata not yet arrived → level 'unknown'; the row is drawn locked
    // meanwhile and callers can show that it is still settling.
    pending: level === 'unknown',
    source: 'group',
    category: channelCategory(metadata),
    level,
    ...(metadataTag(metadata, 'about') ? { about: metadataTag(metadata, 'about') } : {}),
    // A channel's own picture, when its kind:39000 carries one. Absent is the
    // norm, so the key is omitted rather than set to null.
    ...(safeImageUrl(metadataTag(metadata, 'picture'))
      ? { picture: /** @type {string} */ (safeImageUrl(metadataTag(metadata, 'picture'))) }
      : {}),
    pointer
  };
}

/**
 * Whether a group is a conversation between people or a channel.
 *
 * NIP-29 has one object for both, so the only honest source is what the group
 * says about ITSELF: the `t` tag on its kind:39000. Buzz relays write
 * `t=stream` on a channel and `t=dm` on a direct message; a host that uses no
 * such convention writes no `t`, and everything it has is a channel.
 *
 * Deliberately NOT read: the `hidden` tag. Armada treats it as a second DM
 * signal because early Buzz DMs carried no `t`; the relay measured here writes
 * both, so the weaker signal buys nothing and would misfile a merely unlisted
 * channel on any other host.
 *
 * @param {{tags?: string[][]} | null | undefined} metadata
 * @returns {'channel' | 'dm'}
 */
function channelCategory(metadata) {
  // Every `t`, not just the first: a group may carry more than one topic tag,
  // and being a DM is a property of the group, not of tag order.
  const tags = Array.isArray(metadata?.tags) ? metadata.tags : [];
  return tags.some((t) => t[0] === 't' && t[1] === 'dm') ? 'dm' : 'channel';
}

/** @param {{tags?: string[][]} | null | undefined} metadata */
function metadataName(metadata) {
  return metadataTag(metadata, 'name');
}

/**
 * A single-value tag off an untrusted kind:39000. Whitespace-only is the same
 * as absent — a group that writes `["about", "  "]` has said nothing, and a
 * card must not reserve a line for it.
 * @param {{tags?: string[][]} | null | undefined} metadata
 * @param {string} name
 * @returns {string | undefined}
 */
function metadataTag(metadata, name) {
  if (!metadata || !Array.isArray(metadata.tags)) return undefined;
  const value = metadata.tags.find((t) => t[0] === name)?.[1];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
