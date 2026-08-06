// What the rail actually holds, as one list.
//
// Three sources, one order. The DEFAULT order is exactly what the rail showed
// before this feature — communities, then unlinked Concord areas, then
// unlinked NIP-29 groups — so nothing moves for anyone who never drags
// anything; the layout in rail-layout.js only ever departs from this.
//
// Pure. The reactive plumbing (whose communities, whose areas, whose groups)
// stays in CommunitySidebar, and so does the profile lookup for a community —
// that is a rune hook per entry and cannot live in a plain function.
import { railKey } from './rail-layout.js';
import { groupsByRelay } from '$lib/groups/relay-directory.js';

/**
 * @typedef {{key: string, kind: 'community', pubkey: string}} CommunityEntry
 * @typedef {{key: string, kind: 'area', area: any}} AreaEntry
 * @typedef {{key: string, kind: 'relay', relay: string, rows: any[]}} RelayEntry
 * @typedef {CommunityEntry | AreaEntry | RelayEntry} RailEntry
 */

/**
 * @param {{
 *   communityPubkeys?: string[],
 *   areas?: Array<{communityId: string}>,
 *   groups?: Array<{key: string, pointer?: {id?: string, relay?: string}}>
 * }} input
 * @returns {RailEntry[]}
 */
export function buildRailEntries({ communityPubkeys = [], areas = [], groups = [] }) {
  /** @type {RailEntry[]} */
  const entries = [];
  const seen = new Set();

  /** @param {string | null} key @param {() => RailEntry} make */
  const push = (key, make) => {
    // An entry with no key cannot be stored in a layout, so it could never be
    // moved — better absent than pinned to one spot forever.
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push(make());
  };

  for (const pubkey of communityPubkeys) {
    push(railKey({ kind: 'community', pubkey }), () => ({
      key: /** @type {string} */ (railKey({ kind: 'community', pubkey })),
      kind: 'community',
      pubkey
    }));
  }
  for (const area of areas) {
    push(railKey({ kind: 'area', communityId: area?.communityId }), () => ({
      key: /** @type {string} */ (railKey({ kind: 'area', communityId: area.communityId })),
      kind: 'area',
      area
    }));
  }
  // One entry per HOST, not per channel. NIP-29 has no object above a channel,
  // so the relay is the only container a set of them shares — and a rail of
  // single channels made a ten-channel host look like the one channel our own
  // kind-10009 happened to name.
  for (const { relay, rows } of groupsByRelay(groups)) {
    push(railKey({ kind: 'relay', relay }), () => ({
      key: /** @type {string} */ (railKey({ kind: 'relay', relay })),
      kind: 'relay',
      relay,
      rows
    }));
  }

  return entries;
}

/**
 * The rows a folder tile stands for, in the folder's own order, skipping any
 * whose entry has gone away.
 * @param {string[]} keys
 * @param {Map<string, RailEntry>} byKey
 * @returns {RailEntry[]}
 */
export function entriesOf(keys, byKey) {
  /** @type {RailEntry[]} */
  const out = [];
  for (const key of keys ?? []) {
    const entry = byKey?.get(key);
    if (entry) out.push(entry);
  }
  return out;
}
