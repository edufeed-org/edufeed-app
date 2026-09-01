// Where a channel favourite is kept.
//
// ON THIS DEVICE, per account — the same decision, and the same storage shape,
// as the read markers beside it (unread-markers.svelte.js). Here the privacy
// argument is stronger than convenience: a synced NIP-51 list would name the
// NIP-29 group ids an account cares about on public relays — membership
// metadata — and for Concord channels any public trace is off the table
// (the same reason Concord read-state never syncs via NIP-78).
//
// Reads are made reactive in-tab by a version counter, the convention every
// other localStorage-backed store here follows.

/* eslint-disable svelte/prefer-svelte-reactivity -- the Sets here are built
   fresh per read and handed out, never mutated reactively; in-tab reactivity
   comes from the version counter, like every sibling store. */

const FAVOURITES_PREFIX = 'channel-favourites:';

let version = $state(0);

/**
 * Read one account's favourites: a Set of channel row keys
 * (`group:<id>@<relay>` / `concord:<channel_id>`).
 *
 * Storage is untrusted — it survives app versions, and a user can edit it —
 * so anything that is not a non-empty string is dropped here.
 *
 * @param {string | null | undefined} pubkey
 * @returns {Set<string>}
 */
export function readFavouriteChannels(pubkey) {
  void version;
  if (!pubkey || typeof localStorage === 'undefined') return new Set();
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(FAVOURITES_PREFIX + pubkey) ?? '[]');
  } catch {
    // Favourites that will not parse cost the user their stars once. Throwing
    // here would cost them the channel list.
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((key) => typeof key === 'string' && key.length > 0));
}

/**
 * Star a channel, or unstar it if it already is one.
 *
 * @param {string | null | undefined} pubkey
 * @param {string | null | undefined} key
 */
export function toggleFavouriteChannel(pubkey, key) {
  if (!pubkey || !key || typeof localStorage === 'undefined') return;
  const favourites = readFavouriteChannels(pubkey);
  if (favourites.has(key)) favourites.delete(key);
  else favourites.add(key);
  try {
    localStorage.setItem(FAVOURITES_PREFIX + pubkey, JSON.stringify([...favourites]));
  } catch {
    // A full quota must not take the click with it: the star just stays as
    // it was on the next read.
  }
  version++;
}
