// Reactive channel list for ONE relay — the fetching half of relay-directory.js.
//
// Three requests, in the order their answers can arrive:
//   1. the open listing   {kinds:[39000], authors:[relay self]}
//   2. my memberships     {kinds:[9000],  '#p':[me]}          → group ids in `h`
//   3. the ids only 1+2 named indirectly {kinds:[39000], '#d': ids}
//
// (3) exists because a hidden channel is absent from (1) BY DESIGN: the relay
// may refuse to list it, while still answering for it when asked by id.
//
// NIP-42 is handled on the CHALLENGE, not on an error. Measured against
// wss://edufeed.communities.buzz.xyz: `request()` on a gated relay emits
// NOTHING — no event, no completion, no error, not even after its own timeout
// (controls: the local relay and relay.damus.io both answer in <500ms). It is
// blocked inside applesauce's waitForAuth, so the error-driven retry that
// GroupChat uses for `subscription()` can never fire here. The only signal is
// `challenge$`. And `authenticate()` RESOLVES with `{ok:false}` on refusal
// rather than throwing, so a try/catch alone would read a refusal as success.
//
// TWO effects, not one, and that split is load-bearing. (3) has to react to
// the memberships (2) discovers, so a single effect would read the same
// `$state` it writes and re-trigger itself until Svelte's update-depth guard
// fires — measured, in the browser, on the first version of this file. The
// metadata both branches collect therefore accumulates in a PLAIN
// hook-scoped object; only ever written to the reactive `byId`, never read
// back from it.
//
// State is $state.raw throughout: these are applesauce/nostr events from an
// external store, and holding them in deep $state lets a memoising helper
// write a Symbol onto one from inside a $derived, which crashes the runtime
// (061c05c9). Same rule as channel-metadata.svelte.js.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { relayChannelIds, acceptsMetadata, isTrustedSigner } from './relay-directory.js';
import { authenticateOnce, isAuthRequiredError } from './relay-auth.js';
import { raceRelayKey } from './relay-key-race.js';

const GROUP_METADATA = 39000;
const PUT_USER = 9000;

/** @param {any} event */
function metadataId(event) {
  return (event?.tags ?? []).find((/** @type {string[]} */ t) => t?.[0] === 'd')?.[1] ?? null;
}

/**
 * Every channel this relay has for this user.
 *
 * @param {() => string | null | undefined} getRelay
 * @param {() => string[]} getRemembered ids from the user's kind-10009 for THIS relay
 * @returns {() => {
 *   metadata: any[],
 *   ids: string[],
 *   bySource: {listed: string[], remembered: string[], memberships: string[]},
 *   authRequired: boolean,
 *   authRefused: string | null,
 *   loading: boolean
 * }}
 */
export function useRelayDirectory(getRelay, getRemembered) {
  const getActiveUser = useActiveUser();

  /** Plain, deliberately NOT reactive — see the note at the top. */
  /** @type {Record<string, any>} */
  let collected = {};
  /** @type {Record<string, any>} */
  let byId = $state.raw({});
  /** @type {any[]} */
  let memberships = $state.raw([]);
  // This relay's own NIP-11 key, raced through the shared bounded primitive
  // (same one channel-metadata.svelte.js uses — armada's C6 shape) instead of
  // useRelayInformation: that hook nulls its document on every effect
  // re-run, which regresses an already-resolved pin the instant either
  // effect below reruns for an unrelated reason (retrySeq, getRemembered()).
  // `authors` only ever changes on a real NIP-11 answer or the race timing
  // out; `ready` becomes true exactly once per relay and stays true.
  /** @type {string[]} */
  let authors = $state.raw([]);
  let ready = $state(false);
  let authRequired = $state(false);
  /** The relay's own words when it refuses us — far better than our guess. */
  let authRefused = $state(/** @type {string | null} */ (null));
  let loading = $state(true);

  // A successful authenticate() re-runs the requests: one that was already
  // blocked or closed will not necessarily emit on its own.
  let retrySeq = $state(0);

  /** @param {string} relay @param {unknown} err */
  const handleError = (relay, err) => {
    loading = false;
    if (isAuthRequiredError(err)) authRequired = true;
  };

  /** @param {string} relay @param {any} filter @param {(event: any) => void} onEvent */
  const ask = (relay, filter, onEvent) =>
    pool
      .relay(relay)
      .request(filter, { timeout: 8000 })
      .subscribe({
        next: onEvent,
        error: (/** @type {unknown} */ err) => handleError(relay, err),
        complete: () => (loading = false)
      });

  /**
   * @param {any} event
   * @param {string[]} authors the relay's own key(s) — passed through to
   *   `acceptsMetadata` so an untrusted or stale event is rejected BEFORE
   *   it can overwrite a trusted one. See that function's doc comment for
   *   why a read-time filter cannot do this job.
   */
  const takeMetadata = (/** @type {any} */ event, /** @type {string[]} */ authors) => {
    const id = metadataId(event);
    if (!id) return;
    if (!acceptsMetadata(collected[id], event, authors)) return;
    collected[id] = event;
    byId = { ...collected };
    loading = false;
  };

  // Effect C — NIP-42. Watching the challenge rather than an error, because a
  // gated `request()` never produces one (see the note at the top).
  $effect(() => {
    const relay = getRelay();
    const user = getActiveUser();
    authRefused = null;
    if (!relay) return;
    const instance = pool.relay(relay);
    const sub = instance.challenge$.subscribe((/** @type {string | null} */ challenge) => {
      if (!challenge) return;
      // `challenge$` is a BehaviorSubject, so re-subscribing on navigation
      // REPLAYS the challenge this connection already answered. Acting on that
      // is not merely redundant: the relay refuses a second AUTH and
      // applesauce reads the refusal as "not authenticated", which blocks
      // every later read on this relay. Ask the connection, not the replay.
      if (instance.authenticated) {
        authRequired = false;
        return;
      }
      // The relay wants credentials. Without a signer we can say so instead of
      // spinning forever on a request that will never answer.
      authRequired = true;
      if (!user?.signer) {
        loading = false;
        return;
      }
      authenticateOnce(instance, user.signer).then((response) => {
        if (!response.ok) {
          authRefused = response.message ?? 'refused';
          loading = false;
          return;
        }
        authRequired = false;
        retrySeq++;
      });
    });
    return () => sub.unsubscribe();
  });

  // Effect A0 — races this relay's NIP-11 key (armada's C6 shape, shared
  // with channel-metadata.svelte.js via relay-key-race.js). This effect's
  // only dependency is `getRelay()`, so it reruns exactly when the relay
  // identity changes — the one case where clearing `authors`/`ready` first
  // is correct, unlike useRelayInformation's clear-on-every-rerun (which
  // regressed an already-resolved pin on retrySeq/getRemembered() changes).
  // Effects A and B below read `authors`/`ready` rather than calling
  // relayMetadataAuthors directly, so neither can fire a pinnable request
  // before this decides the relay has one — or genuinely does not.
  $effect(() => {
    const relay = getRelay();
    authors = [];
    ready = false;
    if (!relay) return;
    return raceRelayKey(relay, {
      onAuthors: (resolved) => {
        authors = resolved;
      },
      onReady: () => {
        ready = true;
      }
    });
  });

  // Effect A — the relay's own listing, and my membership events.
  $effect(() => {
    retrySeq;
    const relay = getRelay();
    const me = getActiveUser()?.pubkey;
    // Clear first: another relay's channels must never linger under this
    // one's name while the new request is still in flight.
    collected = {};
    byId = {};
    memberships = [];
    authRequired = false;
    if (!relay) {
      loading = false;
      return;
    }
    loading = true;

    /** @type {any[]} */
    const collectedMembers = [];
    /** @type {any[]} */
    const subs = [];

    // Only ask for the open listing when the relay's own key is known — an
    // unscoped `{kinds:[GROUP_METADATA]}` read on a keyless relay is exactly
    // how a forged channel that never existed gets believed as this host's
    // own (measured: LANE-02's `GESCHMUGGELT`). Effect B below still finds
    // every id the user's own records or memberships name, scoped by `#d`
    // either way — that tier is unaffected by whether a key exists.
    if (authors.length) {
      subs.push(
        ask(relay, { kinds: [GROUP_METADATA], authors }, (event) => takeMetadata(event, authors))
      );
    }

    if (me) {
      subs.push(
        ask(relay, { kinds: [PUT_USER], '#p': [me] }, (event) => {
          collectedMembers.push(event);
          memberships = [...collectedMembers];
        })
      );
    }

    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  // Effect B — metadata for the ids only my own records name. Reads
  // `memberships`, writes only `byId`, so it cannot re-trigger itself.
  // Gated on `ready`: a relay Effect A0 has not yet decided about (key
  // resolved, or genuinely none, or the race window expired) must not be
  // asked for kind:39000 unpinned in that gap — that gap is exactly how a
  // forged event got collected and rendered before the pin ever applied
  // (measured, DOOR3_COMMUNITY_METADATA_TRUST.md and the directory-path
  // arms in the same thread).
  $effect(() => {
    const relay = getRelay();
    const indirect = relayChannelIds({
      remembered: getRemembered() ?? [],
      memberships,
      authors
    }).ids;
    if (!relay || !ready || indirect.length === 0) return;
    const sub = ask(
      relay,
      authors.length
        ? { kinds: [GROUP_METADATA], '#d': indirect, authors }
        : { kinds: [GROUP_METADATA], '#d': indirect },
      (event) => takeMetadata(event, authors)
    );
    return () => sub.unsubscribe();
  });

  return () => {
    const raw = relayChannelIds({
      listed: Object.values(byId),
      remembered: getRemembered() ?? [],
      memberships,
      authors
    });

    // A kind:9000 roster names an id; that is a REQUEST for a channel, not
    // one. Effect B already asks for kind:39000 metadata on every membership
    // id (pinned, when a key is known). An id only counts as a channel once
    // its own metadata has actually arrived AND passed the same trust check
    // `listed` gets — mapping the roster straight into the rail (what
    // relayChannelIds does, on purpose, so Effect B still knows what to
    // fetch) would let an arbitrary signer inject an id into a user's own
    // rail by forging a put-user event naming them. No relay
    // misconfiguration required, unlike the `listed` fail-open case: the
    // roster REQ itself is never pinnable (see the note above Effect A).
    const trustedMembership = (/** @type {string} */ id) => {
      const event = byId[id];
      return Boolean(event) && isTrustedSigner(event, authors);
    };
    // Plain array, not Set, on purpose — same reason as the accumulators in
    // channel-metadata.svelte.js: this is a hook-local scratch value, not
    // reactive state.
    const droppedMemberships = raw.bySource.memberships.filter((id) => !trustedMembership(id));
    const ids = droppedMemberships.length
      ? raw.ids.filter((id) => !droppedMemberships.includes(id))
      : raw.ids;
    const bySource = droppedMemberships.length
      ? {
          ...raw.bySource,
          memberships: raw.bySource.memberships.filter((id) => !droppedMemberships.includes(id))
        }
      : raw.bySource;

    return {
      // Only ids we actually hold metadata for can be rendered: a card with no
      // name says less than no card at all.
      metadata: ids.map((id) => byId[id]).filter(Boolean),
      ids,
      bySource,
      authRequired,
      authRefused,
      loading
    };
  };
}
