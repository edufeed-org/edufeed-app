// A NIP-29 relay as a container: which channels does this host have for me?
//
// NIP-29 has no object above a channel — each channel IS a group, and the only
// thing that holds a set of them together is the relay they live on. That is
// what Armada's /s/<host> shows, and what a user means by "the whole group".
//
// One source is not enough, and each of the three answers a case the others
// cannot:
//
//   listed      the relay's own open listing of kind:39000. Complete for
//               public channels, and the only source that finds a channel the
//               user has never touched.
//   remembered  the ids in the user's kind:10009 for this relay. A relay MAY
//               hide private channels from an open listing, so a channel the
//               user belongs to can be missing from `listed` entirely.
//   memberships the group ids of kind:9000 put-user events tagging the user.
//               A client that joins without writing a `group` tag into the
//               10009 (Flotilla does exactly this) leaves nothing in
//               `remembered` to recover the channel by.
//
// Pure. The fetching lives in relay-directory.svelte.js.

/** @param {{tags?: string[][]} | null | undefined} event @param {string} name */
function tagValue(event, name) {
  const tag = (event?.tags ?? []).find((t) => t?.[0] === name && typeof t[1] === 'string');
  return tag?.[1] ?? null;
}

/**
 * Whose kind:39000 we are willing to believe on this relay.
 *
 * Group metadata is signed by the RELAY, so when NIP-11 names that key we pin
 * `authors` to it and forged metadata from anyone else never enters the list.
 * A relay that advertises no key gets no pin — an unfiltered listing is worth
 * more than an empty one, and every id still has to survive the merge below.
 * @param {{self?: unknown, pubkey?: unknown} | null | undefined} info
 * @returns {string[]} authors filter, empty when the relay names no key
 */
export function relayMetadataAuthors(info) {
  const key = [info?.self, info?.pubkey].find(
    (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)
  );
  return key ? [/** @type {string} */ (key).toLowerCase()] : [];
}

/**
 * The channel ids this relay holds for this user, in display order.
 *
 * Order is by source, not by name: the relay's own listing first (that is the
 * host's order, and the one another client shows), then what only the user's
 * own records know about. Sorting by name happens later, in buildChannelRows.
 *
 * Inputs are untrusted network events, so the shapes stay loose on purpose —
 * every field this function reads is re-checked below.
 * @param {{
 *   listed?: Array<{kind?: number, pubkey?: string, tags?: string[][]}>,
 *   remembered?: Array<string | null | undefined>,
 *   memberships?: Array<{kind?: number, tags?: string[][]}>,
 *   authors?: string[]
 * }} input
 * @returns {{ids: string[], bySource: {listed: string[], remembered: string[], memberships: string[]}}}
 */
export function relayChannelIds({
  listed = [],
  remembered = [],
  memberships = [],
  authors = []
} = {}) {
  // A second gate on the same rule the `authors` filter states: a merged set
  // is assembled from several requests, and one of them not carrying the
  // filter must not be a way in for someone else's metadata.
  const trusted = (/** @type {{pubkey?: string}} */ event) =>
    authors.length === 0 || (event?.pubkey && authors.includes(event.pubkey.toLowerCase()));

  const fromListed = listed
    .filter((event) => trusted(event))
    .map((event) => tagValue(event, 'd'))
    .filter((id) => typeof id === 'string' && id.length > 0);

  const fromRemembered = /** @type {string[]} */ (
    remembered.filter((id) => typeof id === 'string' && id.length > 0)
  );

  // NIP-29 moderation events carry the group id in `h`, not `d`.
  const fromMemberships = memberships
    .map((event) => tagValue(event, 'h'))
    .filter((id) => typeof id === 'string' && id.length > 0);

  /** @type {{listed: string[], remembered: string[], memberships: string[]}} */
  const bySource = { listed: [], remembered: [], memberships: [] };
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  /** @param {string[]} from @param {'listed'|'remembered'|'memberships'} source */
  const take = (from, source) => {
    for (const id of from) {
      // bySource records where an id was FIRST found, so "the listing already
      // had it" and "only your own list knows it" stay distinguishable — that
      // difference is the whole reason there are three sources.
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(/** @type {string} */ (id));
      bySource[source].push(/** @type {string} */ (id));
    }
  };
  take(/** @type {string[]} */ (fromListed), 'listed');
  take(fromRemembered, 'remembered');
  take(/** @type {string[]} */ (fromMemberships), 'memberships');

  return { ids, bySource };
}

/**
 * Group the rail's unlinked NIP-29 rows by the relay that hosts them.
 *
 * One entry per host rather than per channel: seven channels on five hosts is
 * five icons, and each opens a page that shows ALL of that host's channels —
 * including the ones no list of ours ever named.
 *
 * @param {Array<{key: string, pointer?: {relay?: string}}>} rows
 * @returns {Array<{relay: string, rows: any[]}>}
 */
export function groupsByRelay(rows = []) {
  /** @type {Map<string, any[]>} */
  const byRelay = new Map();
  for (const row of rows) {
    const relay = row?.pointer?.relay;
    // A row with no relay cannot be opened at all, let alone grouped — the
    // rail already drops it, and inventing a bucket for it would print a host
    // named "undefined".
    if (!relay) continue;
    if (!byRelay.has(relay)) byRelay.set(relay, []);
    /** @type {any[]} */ (byRelay.get(relay)).push(row);
  }
  return [...byRelay.entries()].map(([relay, grouped]) => ({ relay, rows: grouped }));
}

/**
 * The host part of a relay URL, for a rail tooltip or a page title.
 * @param {string} relay
 * @returns {string}
 */
export function relayLabel(relay) {
  try {
    // `host`, not `hostname`: a relay on a non-default port is a DIFFERENT
    // relay, and dropping the port would label two of them identically.
    return new URL(relay).host;
  } catch {
    return relay;
  }
}

/**
 * App route for a relay's channel directory, with the URL encoded once.
 *
 * The relay is spelled out rather than shortened: `encodeGroupPointer`'s
 * hostname-only form drops scheme and port, and a directory page that silently
 * points at a different host is worse than a long URL.
 * @param {string} relay
 * @returns {string}
 */
export function relayHref(relay) {
  return `/relays/${encodeURIComponent(relay)}`;
}

/**
 * An image URL off an untrusted document, or null.
 *
 * Only `http:`/`https:` survive: a NIP-11 document and a kind:39000 are both
 * whatever their author typed, and `javascript:` in an `<img src>` is a
 * scripting hole we would be opening on every rail render.
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The relay's own picture, from its NIP-11 document.
 * @param {{icon?: unknown} | null | undefined} info
 * @returns {string | null}
 */
export function relayIconUrl(info) {
  return safeImageUrl(info?.icon);
}

/**
 * What to call the relay: the name it gives itself, else its host.
 *
 * "Buzz Relay" is what the host calls itself and what other clients show;
 * `edufeed.communities.buzz.xyz` is only the fallback for a relay that
 * publishes no NIP-11 name.
 * @param {{name?: unknown} | null | undefined} info
 * @param {string} relay
 * @returns {string}
 */
export function relayDisplayName(info, relay) {
  const name = typeof info?.name === 'string' ? info.name.trim() : '';
  return name || relayLabel(relay);
}

/**
 * Does this host announce NIP-29 at all?
 *
 * `null` while the NIP-11 document has not arrived — three states, not two:
 * "does not support it" and "we have not asked yet" must not share a screen.
 * A relay that does not announce 29 can still hold a stray kind:39000 (anyone
 * may publish one anywhere); an empty channel list there means "wrong kind of
 * host", not "empty host", and saying so beats a silent zero.
 * @param {{supported_nips?: unknown} | null | undefined} info
 * @returns {boolean | null}
 */
export function announcesNip29(info) {
  if (!info) return null;
  const nips = info.supported_nips;
  if (!Array.isArray(nips)) return null;
  return nips.includes(29);
}
