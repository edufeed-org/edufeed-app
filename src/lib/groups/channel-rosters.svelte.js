// Batched NIP-29 rosters (kind 39001 admins + 39002 members) for a set of
// channel pointers.
//
// A community's channels can be spread over several relays, and a roster is
// only authoritative on the relay that hosts the group — so this asks each
// relay ONCE for every channel it hosts, not once per channel. Same rule
// channel-metadata.svelte.js already follows for kind 39000; both kinds live
// in one request here because a roster consumer (AreaMembersModal, Task 5)
// always wants admins and members together.
//
// Value-stable key + 300ms debounce: exactly host-unread.svelte.js's
// idsKey pattern, for the same reason — a caller's pointer list is often
// rebuilt (new array identity, same content) on every unrelated re-render,
// and reopening every relay subscription on that churn is what starved a
// 1277-channel host's connection (see host-unread.svelte.js's header comment).
//
// The stable key is `sorted channelKeys joined '\x1f'`. Deliberately NOT
// re-reading getPointers() inside the effect body to rebuild the per-relay
// request plan — that would call the getter a second time, undoing the
// derived key's whole purpose (the effect would then depend on the pointers
// array's IDENTITY again, not just its content). Instead the id/relay pairs
// are recovered by parsing the key string itself, same trick host-unread
// uses when it turns its key back into `ids` via `key.split('')`.
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { channelKey } from './community-pointer.js';

/**
 * Recover `{id, relay}` from one `channelKey()` output. The relay half is
 * already normalised (channelKey did that), so this is pure string surgery,
 * not a second validation pass.
 * @param {string} key
 * @returns {{id: string, relay: string} | null}
 */
function splitChannelKey(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0 || at === key.length - 1) return null;
  return { id: key.slice(0, at), relay: key.slice(at + 1) };
}

/**
 * @param {string} key non-empty `pointersKey` value
 * @returns {Map<string, string[]>} relay -> group ids to ask that relay for
 */
function idsByRelay(key) {
  /** @type {Map<string, string[]>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain accumulator local to this call, never held in $state
  const map = new Map();
  for (const entry of key.split('\x1f')) {
    const parsed = splitChannelKey(entry);
    if (!parsed) continue;
    let ids = map.get(parsed.relay);
    if (!ids) {
      ids = [];
      map.set(parsed.relay, ids);
    }
    ids.push(parsed.id);
  }
  return map;
}

/**
 * @param {() => Array<{id: string, relay: string}>} getPointers
 * @returns {() => {
 *   membersByKey: Record<string, Set<string>>,
 *   adminsByKey: Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>,
 *   refresh: () => void
 * }}
 */
export function useChannelRosters(getPointers) {
  /** @type {Record<string, Set<string>>} */
  let membersByKey = $state.raw({});
  /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
  let adminsByKey = $state.raw({});

  // Bumped by refresh() to re-run the effect below without the pointer set
  // itself having changed — read FIRST in the effect: an effect that returns
  // early before reading reactive state captures no dependency on it and
  // never re-runs on a bump (see GroupChat.svelte's rosterSeq for the same
  // shape, and the project's svelte-effect-early-return-dead lesson).
  let seq = $state(0);

  const pointersKey = $derived.by(() => {
    const pointers = getPointers() ?? [];
    const keys = pointers.map((pointer) => channelKey(pointer)).filter((key) => key !== null);
    return [...keys].sort().join('\x1f');
  });

  // Tracks the last key this effect actually subscribed for. Plain `let`,
  // not $state: it is an internal ref read/written only inside the effect,
  // never something the UI renders from directly.
  let previousKey = '';

  $effect(() => {
    void seq;
    const key = pointersKey;
    const keyChanged = key !== previousKey;
    previousKey = key;
    // Only drop prior results when the pointer SET changed. A refresh() bump
    // must not flash the UI back to empty while it re-fetches the same
    // channels — stale-while-revalidate, same as GroupChat's roster effect.
    if (keyChanged) {
      membersByKey = {};
      adminsByKey = {};
    }
    if (key === '') return;

    const requests = idsByRelay(key);
    if (requests.size === 0) return;

    // Accumulate into plain locals and only ever WRITE the reactive state —
    // reading membersByKey/adminsByKey here to spread them would make this
    // effect depend on what it writes.
    /** @type {Record<string, Set<string>>} */
    const collectedMembers = {};
    /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
    const collectedAdmins = {};

    /** @type {Array<{unsubscribe: () => void}>} */
    const open = [];
    const timer = setTimeout(() => {
      for (const [relay, ids] of requests) {
        const sub = pool
          .relay(relay)
          .request({ kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': ids }, { timeout: 8000 })
          .subscribe({
            next: (/** @type {any} */ event) => {
              if (!event || !Array.isArray(event.tags)) return;
              const id = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
              if (!id) return;
              const rosterKey = channelKey({ id, relay });
              if (!rosterKey) return;
              if (event.kind === GROUP_MEMBERS_KIND) {
                // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain data inside a $state.raw record, never mutated in place
                collectedMembers[rosterKey] = new Set(getGroupMembers(event) ?? []);
                membersByKey = { ...collectedMembers };
              } else if (event.kind === GROUP_ADMINS_KIND) {
                collectedAdmins[rosterKey] = getGroupAdmins(event) ?? [];
                adminsByKey = { ...collectedAdmins };
              }
            },
            // One unreachable or auth-walled relay must not blind the rest of
            // the community's channels to their rosters.
            error: () => {}
          });
        open.push(sub);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      for (const sub of open) sub.unsubscribe();
    };
  });

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let healTimer;
  $effect(() => {
    return () => clearTimeout(healTimer);
  });

  /**
   * Bumps immediately for a snappy UI, then once more ~800ms later: the
   * relay's OK for a 9000/9001/9002 admin op doesn't guarantee the
   * 39001/39002 addressables it materialises are already updated by the time
   * the immediate re-request lands, so a stale roster from that first
   * request would otherwise never self-heal. Same shape as GroupChat's
   * onRosterChanged.
   */
  function refresh() {
    seq++;
    clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      seq++;
    }, 800);
  }

  return () => ({ membersByKey, adminsByKey, refresh });
}
