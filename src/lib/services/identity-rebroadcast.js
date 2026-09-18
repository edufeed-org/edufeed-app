/**
 * Once-per-session rebroadcast of the logged-in account's identity events.
 *
 * Widening the publish path (see `getIdentityBroadcastRelays`) only helps the
 * NEXT save. Accounts whose kind 0 is already stranded — because some client
 * narrowed their kind 10002 to a single relay, which then pinned every
 * subsequent profile publish to that relay — stay invisible to the rest of the
 * network until they happen to edit their profile again. This heals them
 * silently at login.
 *
 * Nothing new is signed: the events are re-sent exactly as stored, so this
 * costs no signer round-trip and works for read-only (npub / bunker-less)
 * logins too. Relays keep the newest version of a replaceable event, so
 * re-sending a copy they already have is a no-op for them.
 *
 * Amethyst does the same on a narrower trigger — `republishEventsTo(...)`
 * pushes the account's metadata to the new outbox whenever its relay list
 * changes.
 */
import { filter, take, timer } from 'rxjs';

/**
 * Kinds we re-send, newest-first in usefulness: the profile itself, and the
 * relay list that tells other clients where to find everything else.
 * @type {number[]}
 */
export const IDENTITY_REBROADCAST_KINDS = [0, 10002];

/** Pubkeys already rebroadcast in this session. @type {Set<string>} */
const done = new Set();

/** Test seam — forget which pubkeys were already rebroadcast. */
export function resetIdentityRebroadcastState() {
  done.clear();
}

/**
 * @typedef {Object} RebroadcastDeps
 * @property {any} [store] - EventStore (defaults to the app singleton)
 * @property {string[]} [relays] - Target relays (defaults to the identity broadcast set)
 * @property {(event: any, relays: string[], opts?: any) => Promise<any>} [publish]
 * @property {number[]} [kinds]
 */

/**
 * Re-publish the identity events we already hold for `pubkey`. Idempotent per
 * session; resolves with the kinds actually sent.
 *
 * @param {string} pubkey
 * @param {RebroadcastDeps} [deps]
 * @returns {Promise<{ kinds: number[], relays: string[], skipped?: 'already-done' | 'no-target' }>}
 */
export async function rebroadcastIdentityEvents(pubkey, deps = {}) {
  if (!pubkey) return { kinds: [], relays: [], skipped: 'no-target' };
  if (done.has(pubkey)) return { kinds: [], relays: [], skipped: 'already-done' };

  const store =
    deps.store ?? (await import('$lib/stores/nostr-infrastructure.svelte.js')).eventStore;
  const relays =
    deps.relays ?? (await import('$lib/helpers/relay-helper.js')).getIdentityBroadcastRelays();
  const publish =
    deps.publish ?? (await import('$lib/services/publish-service.js')).publishToRelays;
  const kinds = deps.kinds ?? IDENTITY_REBROADCAST_KINDS;

  if (!relays.length) return { kinds: [], relays: [], skipped: 'no-target' };

  // Claim the pubkey before the first await so two concurrent callers (login
  // effect + a late-arriving kind 0) cannot both fan out.
  done.add(pubkey);

  /** @type {number[]} */
  const sent = [];
  for (const kind of kinds) {
    /** @type {any} */
    let event;
    try {
      event = store.getReplaceable(kind, pubkey);
    } catch {
      event = undefined;
    }
    if (!event) continue;
    try {
      await publish(event, relays, { label: '[identity]' });
      sent.push(kind);
    } catch (err) {
      // Best effort: a dead indexer must never surface as a login error.
      console.warn(`[identity] rebroadcast of kind ${kind} failed:`, err);
    }
  }
  return { kinds: sent, relays };
}

/**
 * Rebroadcast as soon as the account's kind 0 is in the EventStore (it is
 * loaded asynchronously after login, so calling immediately would usually find
 * nothing to send).
 *
 * @param {string} pubkey
 * @param {RebroadcastDeps & { timeoutMs?: number }} [deps] - `timeoutMs` (default
 *   20000) rebroadcasts with whatever the store holds if no kind 0 shows up;
 *   0 disables that timer and waits for the profile indefinitely.
 * @returns {() => void} teardown — stops a rebroadcast that has not fired yet
 */
export function scheduleIdentityRebroadcast(pubkey, deps = {}) {
  if (!pubkey || done.has(pubkey)) return () => {};

  const { timeoutMs = 20_000, ...rest } = deps;
  /** @type {import('rxjs').Subscription[]} */
  const subs = [];
  let fired = false;

  const run = () => {
    if (fired) return;
    fired = true;
    subs.forEach((s) => s.unsubscribe());
    rebroadcastIdentityEvents(pubkey, rest).catch((err) =>
      console.warn('[identity] rebroadcast failed:', err)
    );
  };

  (async () => {
    const store =
      rest.store ?? (await import('$lib/stores/nostr-infrastructure.svelte.js')).eventStore;
    if (fired) return;
    subs.push(
      store
        .replaceable(0, pubkey)
        .pipe(
          filter(/** @param {any} e */ (e) => !!e),
          take(1)
        )
        .subscribe(run)
    );
    if (timeoutMs > 0 && !fired) subs.push(timer(timeoutMs).subscribe(run));
  })();

  return () => {
    fired = true;
    subs.forEach((s) => s.unsubscribe());
  };
}
