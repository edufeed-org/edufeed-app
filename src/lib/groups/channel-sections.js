// The two sections a host's channel list has.
//
// Armada's sidebar draws them the same way (ChannelSidebar.tsx: a "Channels"
// section, then "Direct messages" below it), and for the same reason: on a
// NIP-29 relay a DM is a group like any other, so one flat list puts a
// conversation with one person between two project channels.
//
// Which section a row belongs to is decided in community-channel-rows.js, off
// the group's own kind:39000. This function only groups — it never classifies,
// so a row cannot end up in a section its metadata does not claim.
//
// Pure.

/**
 * @param {import('./community-channel-rows.js').ChannelRow[] | null | undefined} rows
 * @returns {{
 *   channels: import('./community-channel-rows.js').ChannelRow[],
 *   dms: import('./community-channel-rows.js').ChannelRow[]
 * }}
 */
export function splitChannelSections(rows) {
  /** @type {import('./community-channel-rows.js').ChannelRow[]} */
  const channels = [];
  /** @type {import('./community-channel-rows.js').ChannelRow[]} */
  const dms = [];
  for (const row of rows ?? []) {
    if (!row) continue;
    // A Concord channel has no category at all — Concord has no DM object, so
    // "not a channel" is not a state it can be in.
    if (row.source === 'group' && row.category === 'dm') dms.push(row);
    else channels.push(row);
  }
  return { channels, dms };
}

/**
 * Lift the rows a user has starred into their own section, keeping the
 * builder's order on both sides. Which rows are starred is decided in
 * favourite-channels.svelte.js, off local per-account state — this function
 * only groups, it never classifies.
 *
 * @param {import('./community-channel-rows.js').ChannelRow[] | null | undefined} rows
 * @param {Set<string> | null | undefined} favouriteKeys row keys, as stored
 * @returns {{
 *   favourites: import('./community-channel-rows.js').ChannelRow[],
 *   rest: import('./community-channel-rows.js').ChannelRow[]
 * }}
 */
export function splitFavouriteRows(rows, favouriteKeys) {
  /** @type {import('./community-channel-rows.js').ChannelRow[]} */
  const favourites = [];
  /** @type {import('./community-channel-rows.js').ChannelRow[]} */
  const rest = [];
  for (const row of rows ?? []) {
    if (!row) continue;
    if (favouriteKeys?.has(row.key)) favourites.push(row);
    else rest.push(row);
  }
  return { favourites, rest };
}
