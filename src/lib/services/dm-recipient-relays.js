/**
 * Prefetch a recipient's NIP-17 DM relays before sending a wrapped message.
 *
 * The applesauce SendWrappedMessage action resolves each participant's relays
 * via `castUser(pubkey).directMessageRelays$.$first()` / `inboxes$.$first()`,
 * which read the EventStore only and never hit the network. So unless the
 * recipient's kind 10050 (or kind 10002 fallback) is already in the store, the
 * action can't route the gift wrap to the relays NIP-17 requires. This loads
 * those lists into the store first.
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/** Per-list load deadline. */
const DEFAULT_LOAD_TIMEOUT_MS = 4000;

/**
 * Load a replaceable event into the EventStore via the address loader, resolving
 * when the loader completes or the timeout elapses (whichever comes first).
 * @param {number} kind
 * @param {string} pubkey
 * @param {string[]} relays
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function loadIntoStore(kind, pubkey, relays, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import('rxjs').Subscription | undefined} */
    let sub;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    sub = addressLoader({ kind, pubkey, relays }).subscribe({
      complete: finish,
      error: finish
    });
  });
}

/**
 * Ensure each recipient's kind 10050 (and kind 10002 fallback) relay list is in
 * the EventStore. No-op for lists already present. Awaits all outstanding loads
 * (each bounded by its own timeout).
 *
 * @param {string[]} pubkeys
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {{ getReplaceable: (kind: number, pubkey: string) => unknown }} [opts.store]
 * @param {(kind: number, pubkey: string, relays: string[], timeoutMs: number) => Promise<void>} [opts.load]
 * @param {() => string[]} [opts.getLookupRelays]
 * @param {() => string[]} [opts.getFallbackRelays]
 * @returns {Promise<void>}
 */
export async function ensureRecipientDmRelays(pubkeys, opts = {}) {
  const {
    timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
    store = eventStore,
    load = loadIntoStore,
    getLookupRelays = getRelayListLookupRelays,
    getFallbackRelays = () => runtimeConfig.fallbackRelays || []
  } = opts;

  const relays = [...new Set([...(getLookupRelays() || []), ...(getFallbackRelays() || [])])];
  if (relays.length === 0) return;

  /** @type {Promise<void>[]} */
  const tasks = [];
  for (const pubkey of pubkeys) {
    if (!store.getReplaceable(10050, pubkey)) tasks.push(load(10050, pubkey, relays, timeoutMs));
    if (!store.getReplaceable(10002, pubkey)) tasks.push(load(10002, pubkey, relays, timeoutMs));
  }
  if (tasks.length > 0) await Promise.allSettled(tasks);
}
