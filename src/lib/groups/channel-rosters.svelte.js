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
// The stable key is `sorted channelKeys joined '\x1f'` and is the ONLY
// TRACKED read the effect makes for the pointer set — it decides whether the
// effect re-runs at all. The actual `{relay, ids}` request plan is rebuilt
// from `getPointers()` on every run, but wrapped in `untrack()` so that read
// itself creates no dependency: reading it plainly would reintroduce the
// exact bug the key exists to prevent (a fresh array with the same content
// reopening every subscription).
//
// Earlier versions of this file tried to avoid the untracked re-read by
// parsing `{id, relay}` back out of the key string (`lastIndexOf('@')`).
// That was unsound: channelKey's relay validation accepts '@' inside the
// RELAY half (userinfo `wss://user:pass@host/`, or a path segment like
// `wss://relay.example/room@42` — both pass `isValidRelayWebsocketUrl`), so
// `lastIndexOf('@')` could split a well-formed key at the wrong character and
// hand `pool.relay()` a garbage URL. Rebuilding from the pointers themselves
// sidesteps that entirely — never re-derive addressing from a string that
// was only ever meant to be compared, not decoded.
import { untrack } from 'svelte';
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { channelKey } from './community-pointer.js';

/**
 * @param {Array<{id: string, relay: string}>} pointers
 * @returns {Map<string, string[]>} relay (normalised) -> group ids to ask that relay for
 */
function groupPointersByRelay(pointers) {
  /** @type {Map<string, string[]>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain accumulator local to this call, never held in $state
  const map = new Map();
  for (const pointer of pointers) {
    if (!channelKey(pointer)) continue; // unaddressable — nothing to ask for
    const relay = normalizeURL(pointer.relay);
    let ids = map.get(relay);
    if (!ids) {
      ids = [];
      map.set(relay, ids);
    }
    if (!ids.includes(pointer.id)) ids.push(pointer.id);
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
    // (same key, seq-only change) must not flash the UI back to empty while
    // it re-fetches the same channels — stale-while-revalidate, same as
    // GroupChat's roster effect.
    if (keyChanged) {
      membersByKey = {};
      adminsByKey = {};
    }
    if (key === '') return;

    // untrack(): getPointers() is read here to build the per-relay request
    // plan, NOT to decide whether to re-run — that job belongs to
    // `pointersKey` alone. A plain (tracked) read here would put this effect
    // right back into the bug pointersKey exists to avoid: a fresh pointers
    // array with the same content reopening every subscription.
    const requests = untrack(() => groupPointersByRelay(getPointers() ?? []));
    if (requests.size === 0) return;

    // Accumulate into plain locals and only ever WRITE the reactive state —
    // reading membersByKey/adminsByKey here (untracked) seeds a refresh from
    // what is already known; a plain (tracked) read would make this effect
    // depend on state it itself writes a few lines down, inside the very
    // same run.
    /** @type {Record<string, Set<string>>} */
    const collectedMembers = keyChanged ? {} : untrack(() => ({ ...membersByKey }));
    /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
    const collectedAdmins = keyChanged ? {} : untrack(() => ({ ...adminsByKey }));

    /** @type {Array<{unsubscribe: () => void}>} */
    const open = [];
    const timer = setTimeout(() => {
      for (const [relay, ids] of requests) {
        try {
          // A relay that has finished speaking — EOSE with no roster for
          // some requested id, or the pool's own request timeout — must
          // resolve that id to non-member rather than leave rosterView()
          // reporting isLoading forever. Only fill keys still undefined:
          // this must never clobber a roster a previous round (or this
          // same round's `next`) already delivered.
          //
          // Wired to BOTH `complete` and `error`: applesauce's
          // pool.relay().request() completes on EOSE (including an EOSE
          // with zero matching events), but a truly silent/unresponsive
          // relay instead ERRORS — its internal `timeout({first: ms})` has
          // no `with:` fallback, so rxjs's default timeout behavior
          // (throw) applies when nothing arrives within the window at all
          // (see applesauce-relay's relay.js `request()`). Both endings
          // must resolve-empty the same requested ids.
          const resolveEmpty = () => {
            for (const id of ids) {
              const rosterKey = channelKey({ id, relay });
              if (!rosterKey) continue;
              // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain data inside a $state.raw record, never mutated in place
              collectedMembers[rosterKey] = collectedMembers[rosterKey] ?? new Set();
            }
            membersByKey = { ...collectedMembers };
          };
          const sub = pool
            .relay(relay)
            .request(
              { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': ids },
              { timeout: 8000 }
            )
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
              complete: resolveEmpty,
              // One unreachable or auth-walled relay must not blind the rest
              // of the community's channels to their rosters — but it must
              // also not leave them spinning forever; see resolveEmpty above.
              error: resolveEmpty
            });
          open.push(sub);
        } catch (err) {
          // A relay URL the pool refuses synchronously (malformed, etc.)
          // must not stop siblings later in iteration order from being
          // asked at all.
          console.warn('[channel-rosters] failed to request roster from relay', relay, err);
        }
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
