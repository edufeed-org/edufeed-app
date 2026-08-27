// Where a host channel's read marker is kept.
//
// ON THIS DEVICE, per account — the same decision, and the same storage shape,
// as the rail's arrangement (rail/rail-layout-store.svelte.js). The DRY move
// would have been the inbox's encrypted kind:30078 (inbox-service.svelte.js:
// `comcal/inbox/last-seen`), which would also sync across devices. It is the
// right end state and it fits on top of this file without touching a reader.
//
// It is not the start, because of WHEN a marker is written. The inbox
// publishes on an explicit "mark all read"; a channel marker is written every
// time you open a channel. Through a remote event that is a NIP-44 encrypt, a
// signature and a publish per open — with Amber or a bunker, a prompt per
// click. Local first, encrypted sync later, same open question as the rail.
//
// Reads are made reactive in-tab by a version counter, the convention every
// other localStorage-backed store here follows.

const MARKERS_PREFIX = 'groups-unread:';

let version = $state(0);

/**
 * Read markers for one account: channelKey → unix seconds.
 *
 * Storage is untrusted — it survives app versions, and a user can edit it — so
 * anything that is not a timestamp is dropped here rather than allowed to
 * reach the comparison, where a string would silently make a channel read.
 *
 * @param {string | null | undefined} pubkey
 * @returns {Record<string, number>}
 */
export function readUnreadMarkers(pubkey) {
  void version;
  if (!pubkey || typeof localStorage === 'undefined') return {};
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(MARKERS_PREFIX + pubkey) ?? '{}');
  } catch {
    // Markers that will not parse cost the user their bolding once. Throwing
    // here would cost them the channel list.
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  /** @type {Record<string, number>} */
  const markers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) markers[key] = value;
  }
  return markers;
}

/**
 * @param {string | null | undefined} pubkey
 * @param {Record<string, number>} markers
 */
export function writeUnreadMarkers(pubkey, markers) {
  if (!pubkey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MARKERS_PREFIX + pubkey, JSON.stringify(markers));
  } catch {
    // A full quota must not take the reading with it: the channel is marked
    // read in memory and stays that way until reload.
  }
  version++;
}
