// One channel list for a community, from two sources.
//
// A community is extended by ONE protected area — a Concord area or a set of
// NIP-29 groups — so in practice only one source is populated at a time. Both
// are merged here anyway, sorted by name rather than by source: the rail is a
// list of channels, and which protocol carries a row is not something a reader
// should have to think about.
//
// Rows are plain data. Rendering (PrivateChannelsView) stays presentational.
import { channelAccessLevel, channelGlyph } from './channel-access.js';
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
 *   accessible: boolean,
 *   pending: boolean
 * }} ChannelRowBase
 * @typedef {ChannelRowBase & {source: 'concord', channel_id: string}} ConcordChannelRow
 * @typedef {ChannelRowBase & {
 *   source: 'group',
 *   level: import('./channel-access.js').ChannelAccessLevel,
 *   about?: string,
 *   picture?: string,
 *   pointer: {id: string, relay: string, name?: string, access?: string}
 * }} GroupChannelRow
 * @typedef {ConcordChannelRow | GroupChannelRow} ChannelRow
 */
// `level` rides along with `symbol` because the glyph is lossy: '#' stands for
// both "world" and "members". The rail only needs the glyph, but the card grid
// says the level in words, and it cannot get back to the level from a '#'.

/**
 * @param {{
 *   concordChannels?: Array<{channel_id: string, name?: string, private?: boolean, accessible?: boolean}>,
 *   groupPointers?: Array<{id: string, relay: string, name?: string, access?: string}>,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {ChannelRow[]}
 */
export function buildChannelRows({ concordChannels = [], groupPointers = [], metadataByKey = {} }) {
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
      accessible: channel.accessible !== false,
      pending: false,
      source: 'concord',
      channel_id: channel.channel_id
    });
  }

  for (const pointer of groupPointers) {
    const key = channelKey(pointer);
    if (!key) continue; // unaddressable — better absent than a broken row
    const metadata = metadataByKey[key];
    const level = channelAccessLevel(metadata, pointer);
    const glyph = channelGlyph(level);
    rows.push({
      key: `group:${key}`,
      name: pointer.name || metadataName(metadata) || pointer.id,
      symbol: glyph.symbol,
      worldReadable: glyph.worldReadable,
      accessible: true,
      // The relay has not told us yet what this channel is; the row is drawn
      // locked meanwhile, and callers can show that it is still settling.
      pending: level === 'unknown',
      source: 'group',
      level,
      ...(metadataTag(metadata, 'about') ? { about: metadataTag(metadata, 'about') } : {}),
      // A channel's own picture, when its kind:39000 carries one. Absent is
      // the norm, so the key is omitted rather than set to null — a card
      // reserves no space for a picture nobody published.
      ...(safeImageUrl(metadataTag(metadata, 'picture'))
        ? { picture: /** @type {string} */ (safeImageUrl(metadataTag(metadata, 'picture'))) }
        : {}),
      pointer
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
