// Batched NIP-29 rosters (kind 39001 admins + 39002 members) for a set of
// channel pointers — read THROUGH the eventStore.
//
// A community's channels can be spread over several relays, and a roster is
// only authoritative on the relay that hosts the group — so this asks each
// relay ONCE for every channel it hosts, not once per channel. Same rule
// channel-metadata.svelte.js already follows for kind 39000; both kinds live
// in one request here because a roster consumer (AreaMembersModal, Task 5)
// always wants admins and members together.
//
// Why the eventStore, not local Sets (laoc, 2026-08-20): rosters used to be
// held in per-hook `$state` Sets, rebuilt from each relay request's own
// events. That gave every surface its own un-deduped subscription with no
// shared source of truth, so the member count disagreed across Settings /
// Members / chat and — worse — FLICKERED to 0. applesauce's
// `pool.relay().request()` does not replay already-delivered events to a
// late/duplicate subscriber, so on a remount a fresh REQ for a roster the
// relay had already answered on another open REQ came back empty, and the old
// "resolve requested ids to an empty Set on EOSE/timeout" logic then CLOBBERED
// the real roster with `∅` and stuck isLoading false. Routing every roster
// event through the eventStore fixes all of it: a remounted/duplicate reader
// reads the ALREADY-STORED roster instantly (no reliance on relay replay), and
// the store gives replaceable dedup + newest-wins + NIP-09 deletion filtering
// for free — the same treatment kind-9 chat already gets (GroupChat.svelte).
//
// The request now only FEEDS the store (`storeEvents`); the roster records are
// DERIVED from `eventStore.model(TimelineModel, …)`. "This channel has been
// asked, and the relay said nothing" (empty/inaccessible) is tracked as
// `fetchedKeys` — it flips isLoading false WITHOUT fabricating an empty roster
// that could clobber a real one from the store.
//
// Value-stable key + 300ms debounce: exactly host-unread.svelte.js's
// idsKey pattern, for the same reason — a caller's pointer list is often
// rebuilt (new array identity, same content) on every unrelated re-render,
// and reopening every relay subscription on that churn is what starved a
// 1277-channel host's connection (see host-unread.svelte.js's header comment).
//
// The stable key is `sorted channelKeys joined '\x1f'` and is the ONLY
// TRACKED read the effect makes for the pointer set. The actual `{relay, ids}`
// request plan and the event→pointer mapping are rebuilt from `getPointers()`
// inside `untrack()` so that read itself creates no dependency: reading it
// plainly would reintroduce the exact bug the key exists to prevent (a fresh
// array with the same content reopening every subscription).
//
// Earlier versions parsed `{id, relay}` back out of the key string
// (`lastIndexOf('@')`). That was unsound: channelKey's relay validation accepts
// '@' inside the RELAY half (userinfo, or a path segment), so a well-formed key
// could split at the wrong character. Rebuilding from the pointers themselves
// sidesteps that — never re-derive addressing from a string meant only to be
// compared.
import { untrack } from 'svelte';
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { TimelineModel } from 'applesauce-core/models';
import { storeEvents } from 'applesauce-relay/operators';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
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

/** @param {any} event @returns {string | undefined} the group id from the `d` tag */
function dTagOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
}

/**
 * @param {() => Array<{id: string, relay: string}>} getPointers
 * @returns {() => {
 *   membersByKey: Record<string, Set<string>>,
 *   adminsByKey: Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>,
 *   fetchedKeys: Set<string>,
 *   refresh: () => void
 * }}
 */
export function useChannelRosters(getPointers) {
  /** @type {Record<string, Set<string>>} */
  let membersByKey = $state.raw({});
  /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
  let adminsByKey = $state.raw({});
  // channelKeys whose relay fetch has ENDED (EOSE or timeout). Distinguishes
  // "the relay said nothing → not a member / empty" from "still loading",
  // WITHOUT writing an empty Set into membersByKey that could clobber a real
  // roster the store already holds (see rosterView().isLoading).
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale (never mutated in place)
  let fetchedKeys = $state.raw(new Set());

  // Bumped by refresh() to re-run the FETCH effect without the pointer set
  // itself having changed — read FIRST there: an effect that returns early
  // before reading reactive state captures no dependency on it and never
  // re-runs on a bump (svelte-effect-early-return-dead lesson).
  let seq = $state(0);

  const pointersKey = $derived.by(() => {
    const pointers = getPointers() ?? [];
    const keys = pointers.map((pointer) => channelKey(pointer)).filter((key) => key !== null);
    return [...keys].sort().join('\x1f');
  });

  let previousKey = '';

  // ── Fetch: feed every roster event into the eventStore, then mark the
  //    requested ids as fetched when the relay stops speaking. ──
  $effect(() => {
    void seq;
    const key = pointersKey;
    const keyChanged = key !== previousKey;
    previousKey = key;
    // A new pointer SET starts a fresh loading cycle for its keys. A refresh()
    // bump (same key) keeps fetchedKeys so the UI stays settled while it
    // re-fetches (stale-while-revalidate; the store keeps the old roster).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale
    if (keyChanged) fetchedKeys = new Set();
    if (key === '') return;

    const requests = untrack(() => groupPointersByRelay(getPointers() ?? []));
    if (requests.size === 0) return;

    /** @type {Array<{unsubscribe: () => void}>} */
    const open = [];
    const timer = setTimeout(() => {
      for (const [relay, ids] of requests) {
        // A relay that has finished speaking — EOSE (including EOSE with zero
        // matching events) or the pool's request timeout/error — marks its
        // requested ids fetched so rosterView() stops reporting isLoading.
        // Never writes an empty roster: the store is the only source of member
        // Sets now, so "fetched, nothing stored" is correctly an EMPTY view,
        // not a clobber.
        const markFetched = () => {
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale
          const next = new Set(fetchedKeys);
          for (const id of ids) {
            const rosterKey = channelKey({ id, relay });
            if (rosterKey) next.add(rosterKey);
          }
          fetchedKeys = next;
        };
        try {
          const sub = pool
            .relay(relay)
            .request(
              { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': ids },
              { timeout: 8000 }
            )
            .pipe(storeEvents(eventStore))
            .subscribe({
              complete: markFetched,
              // One unreachable/auth-walled relay must not blind the rest of
              // the community's channels — but it must also not leave them
              // spinning forever; see markFetched above.
              error: markFetched
            });
          open.push(sub);
        } catch (err) {
          console.warn('[channel-rosters] failed to request roster from relay', relay, err);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      for (const sub of open) sub.unsubscribe();
    };
  });

  // ── Read: derive the roster records reactively from the eventStore. Emits
  //    synchronously on subscribe with whatever the store already holds, so a
  //    remount is populated instantly — independent of relay replay. ──
  $effect(() => {
    const key = pointersKey; // dep: re-subscribe only when the pointer SET changes
    if (key === '') {
      membersByKey = {};
      adminsByKey = {};
      return;
    }
    const pointers = untrack(() => getPointers() ?? []);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient local, immediately spread to a plain array
    const ids = [...new Set(pointers.map((pointer) => pointer.id))];

    const sub = eventStore
      .model(TimelineModel, { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': ids })
      .subscribe((/** @type {any[]} */ events) => {
        /** @type {Record<string, Set<string>>} */
        const nextMembers = {};
        /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
        const nextAdmins = {};
        for (const pointer of pointers) {
          const rosterKey = channelKey(pointer);
          if (!rosterKey) continue;
          // Newest 39002/39001 for THIS id (the store already keeps newest per
          // addressable; a forked id served by two relays could yield two —
          // take the newest by created_at, same tie-break the store uses).
          let member;
          let admin;
          for (const ev of events) {
            if (dTagOf(ev) !== pointer.id) continue;
            if (ev.kind === GROUP_MEMBERS_KIND) {
              if (!member || ev.created_at > member.created_at) member = ev;
            } else if (ev.kind === GROUP_ADMINS_KIND) {
              if (!admin || ev.created_at > admin.created_at) admin = ev;
            }
          }
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain data inside a $state.raw record, never mutated in place
          if (member) nextMembers[rosterKey] = new Set(getGroupMembers(member) ?? []);
          if (admin) nextAdmins[rosterKey] = getGroupAdmins(admin) ?? [];
        }
        membersByKey = nextMembers;
        adminsByKey = nextAdmins;
      });

    return () => sub.unsubscribe();
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
   * the immediate re-request lands, so a stale roster would otherwise never
   * self-heal. The store's newest-wins means the second fetch's newer 39002
   * simply replaces the older one and the read model re-emits. Same shape as
   * GroupChat's onRosterChanged.
   */
  function refresh() {
    seq++;
    clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      seq++;
    }, 800);
  }

  return () => ({ membersByKey, adminsByKey, fetchedKeys, refresh });
}
