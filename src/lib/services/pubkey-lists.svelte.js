/**
 * Deployment pubkey lists — the shape behind `BLOCKED_PUBKEYS` and
 * `CALENDAR_HIDDEN_PUBKEYS`.
 *
 * An entry is a pubkey (`npub1…` or 64-char hex) or a NIP-51 list: the
 * `naddr1…` of a kind 30000 follow set whose `p` tags are the members (the
 * same form `CURATED_PUBKEYS_SETS` takes). Direct pubkeys apply at once;
 * lists resolve from their hint relays (else the lookup relays) by the first
 * relay answer and are remembered in localStorage, so the next load applies
 * the last known members immediately and refreshes them in the background.
 * A list that no relay answers keeps its remembered members.
 */
import { firstValueFrom } from 'rxjs';
import { nip19 } from 'nostr-tools';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';

const STORAGE_PREFIX = 'edufeed:pubkey-list:';
const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/**
 * @typedef {{ pubkey: string, identifier: string, relays: string[] }} ListPointer
 * @typedef {object} PubkeyList
 * @property {(pubkey: string) => boolean} has
 * @property {string[]} pubkeys - Direct entries plus the resolved list members
 * @property {number} version - Bumps when the members change (read it in a $derived)
 * @property {Promise<void>} ready - Resolves once every list answered or failed
 */

/**
 * Sort entries into direct pubkeys and kind 30000 list pointers.
 * @param {string[]} entries
 * @returns {{ direct: string[], sets: ListPointer[] }}
 */
export function parseListEntries(entries) {
  /** @type {string[]} */
  const direct = [];
  /** @type {ListPointer[]} */
  const sets = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    if (HEX_PUBKEY.test(entry)) {
      direct.push(entry.toLowerCase());
      continue;
    }
    try {
      const decoded = nip19.decode(entry);
      if (decoded.type === 'npub') {
        direct.push(decoded.data);
      } else if (decoded.type === 'naddr' && decoded.data.kind === 30000) {
        sets.push({
          pubkey: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          relays: decoded.data.relays || []
        });
      } else {
        console.warn('Pubkey list: expected npub, hex or kind 30000 naddr, got', entry);
      }
    } catch {
      console.warn('Pubkey list: cannot decode entry', entry);
    }
  }
  return { direct: unique(direct), sets };
}

/** @param {string} name */
const storageKey = (name) => `${STORAGE_PREFIX}${name}`;

/**
 * @param {string} name
 * @returns {string[] | null}
 */
function remembered(name) {
  try {
    const raw = localStorage.getItem(storageKey(name));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((p) => HEX_PUBKEY.test(p)) : null;
  } catch {
    return null;
  }
}

/** @param {string} name @param {string[]} pubkeys */
function remember(name, pubkeys) {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(pubkeys));
  } catch {
    // storage full or unavailable
  }
}

/**
 * The members of one kind 30000 list, by the first relay that answers.
 * @param {ListPointer} pointer
 * @returns {Promise<string[]>}
 */
async function resolveList(pointer) {
  const relays = pointer.relays.length > 0 ? pointer.relays : getAllLookupRelays();
  const event = await firstValueFrom(
    pool.request(
      relays,
      { kinds: [30000], authors: [pointer.pubkey], '#d': [pointer.identifier] },
      /** @type {any} */ ({ timeout: 5000 })
    )
  );
  return event.tags.filter((t) => t[0] === 'p' && HEX_PUBKEY.test(t[1] || '')).map((t) => t[1]);
}

/**
 * @param {string} name - Cache key (one per setting)
 * @param {string[]} entries - The setting's raw entries
 * @returns {PubkeyList}
 */
export function createPubkeyList(name, entries) {
  const { direct, sets } = parseListEntries(entries);
  let members = $state.raw(/** @type {string[]} */ ([]));
  let version = $state(0);

  /** @param {string[]} next */
  const setMembers = (next) => {
    const merged = unique([...direct, ...next]);
    if (merged.join(',') === members.join(',')) return;
    members = merged;
    version++;
  };
  setMembers([]);

  const known = sets.length > 0 ? remembered(name) : null;
  if (known) setMembers(known);

  const ready =
    sets.length === 0
      ? Promise.resolve()
      : Promise.allSettled(sets.map(resolveList)).then((results) => {
          const answered = results.filter((r) => r.status === 'fulfilled');
          if (answered.length === 0) return; // offline: keep the remembered members
          const resolved = unique(
            answered.flatMap((r) => /** @type {PromiseFulfilledResult<string[]>} */ (r).value)
          );
          // A list some relay could not answer keeps its remembered members
          const fromMemory = answered.length < sets.length ? (known ?? []) : [];
          const next = unique([...resolved, ...fromMemory]);
          remember(name, next);
          setMembers(next);
        });

  return {
    has: (pubkey) => members.includes(pubkey),
    get pubkeys() {
      return members;
    },
    get version() {
      return version;
    },
    ready
  };
}
