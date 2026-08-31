/**
 * Mute list store (NIP-51 kind 10000).
 *
 * Loads the active user's mute list on login and exposes the muted pubkeys as
 * a reactive set. DM list, DM requests, and inbox notifications all consult
 * it; muting goes through applesauce's MuteUser action so the list stays in
 * sync across Nostr clients.
 *
 * v1 reads only the public p-tags — NIP-51 encrypted (hidden) entries are
 * written by other clients but deferred here.
 */
import { MuteUser, UnmuteUser, MuteWord, UnmuteWord } from 'applesauce-actions/actions';
import { getPublicMutedThings } from 'applesauce-common/helpers/mute';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getRelayListLookupRelays, getWriteRelays } from '$lib/services/relay-service.svelte.js';

const MUTE_LIST_KIND = 10000;

/** @type {Set<string>} */
let mutedPubkeys = $state.raw(new Set());

/** Muted words, normalized to lowercase. @type {Set<string>} */
let mutedWords = $state.raw(new Set());

/** @type {string | null} */
let activePubkey = null;

/** @type {{ unsubscribe: () => void }[]} */
let subscriptions = [];

/**
 * Guard against the local-miss overwrite race (see the kind-30000 follow-set
 * wipe incident): applesauce's MuteUser waits only 1s for an existing list
 * before creating a fresh one, so a "block" click right after login could
 * replace a remote mute list that simply hadn't been fetched yet. Mutations
 * await this settle window: it resolves as soon as a kind 10000 lands in the
 * store, or after the relay fetch has had a fair chance.
 * @type {Promise<void>}
 */
let initialFetchSettled = Promise.resolve();
const INITIAL_FETCH_SETTLE_MS = 5000;

/** Reactive getter — read inside $derived/$effect for updates. */
export function getMutedPubkeys() {
  return mutedPubkeys;
}

/** Reactive getter for muted words (lowercase). */
export function getMutedWords() {
  return mutedWords;
}

/**
 * @param {string} pubkey
 * @returns {boolean}
 */
export function isMuted(pubkey) {
  return mutedPubkeys.has(pubkey);
}

/**
 * Load the user's kind 10000 and keep the muted set updated.
 * Called on login from accounts.svelte.js.
 * @param {string} pubkey
 */
export function initializeMuteList(pubkey) {
  cleanupMuteList();
  activePubkey = pubkey;

  /** @type {() => void} */
  let settle = () => {};
  initialFetchSettled = new Promise((resolve) => {
    settle = resolve;
  });
  const settleTimer = setTimeout(settle, INITIAL_FETCH_SETTLE_MS);
  subscriptions.push({ unsubscribe: () => clearTimeout(settleTimer) });

  // Fetch the list from the indexers plus the user's own outbox (a mute list
  // may only ever have been published to personal write relays).
  const lookupRelays = getRelayListLookupRelays();
  if (lookupRelays.length > 0) {
    subscriptions.push(
      addressLoader({ kind: MUTE_LIST_KIND, pubkey, relays: lookupRelays }).subscribe()
    );
  }
  getWriteRelays(pubkey).then((writeRelays) => {
    if (activePubkey !== pubkey) return; // session switched while awaiting
    if (writeRelays.length > 0) {
      subscriptions.push(
        addressLoader({ kind: MUTE_LIST_KIND, pubkey, relays: writeRelays }).subscribe()
      );
    }
  });

  // React to the replaceable in the EventStore (covers optimistic writes from
  // the MuteUser action as well as relay fetches).
  subscriptions.push(
    eventStore.replaceable(MUTE_LIST_KIND, pubkey).subscribe((event) => {
      if (event) settle();
      const things = event ? getPublicMutedThings(event) : undefined;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
      mutedPubkeys = things ? things.pubkeys : new Set();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
      mutedWords = new Set([...(things ? things.words : [])].map((w) => w.toLowerCase()));
    })
  );
}

/** Reset on logout. */
export function cleanupMuteList() {
  for (const sub of subscriptions) sub.unsubscribe();
  subscriptions = [];
  activePubkey = null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
  mutedPubkeys = new Set();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
  mutedWords = new Set();
}

/**
 * Add a pubkey to the user's mute list (optimistic local update, outbox
 * publish via ActionRunner). Rejections surface the underlying error.
 * @param {string} pubkey
 */
export async function muteUser(pubkey) {
  await initialFetchSettled;
  const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');
  await actionRunnerOptimistic.run(MuteUser, pubkey);
}

/**
 * Remove a pubkey from the user's mute list.
 * @param {string} pubkey
 */
export async function unmuteUser(pubkey) {
  await initialFetchSettled;
  const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');
  await actionRunnerOptimistic.run(UnmuteUser, pubkey);
}

/**
 * Add a word to the user's mute list (stored lowercase; matched as a
 * case-insensitive substring against notification content).
 * @param {string} word
 */
export async function muteWord(word) {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  await initialFetchSettled;
  const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');
  await actionRunnerOptimistic.run(MuteWord, normalized);
}

/**
 * Remove a word from the user's mute list. Passed through as stored (only
 * trimmed) so entries written with capitals by other clients still match.
 * @param {string} word
 */
export async function unmuteWord(word) {
  const normalized = word.trim();
  if (!normalized) return;
  await initialFetchSettled;
  const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');
  await actionRunnerOptimistic.run(UnmuteWord, normalized);
}
