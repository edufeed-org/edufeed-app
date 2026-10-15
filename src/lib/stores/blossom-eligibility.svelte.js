// Per-account prediction of the closed Blossom server's upload policy.
//
// blossom.edufeed.org only accepts uploads from eligible accounts (pubkey
// allowlist + NIP-05 handles on configured domains, enforced server-side by
// blossom-server's storage rules). The app asks its own `/api/blossom/eligible`
// once per account and keeps the answer here so plain helpers
// (getActiveBlossomServer) and reactive surfaces (Termi hints, settings card)
// agree on where this account's files should go.
//
// Mirrors nip05-ready-alert.svelte.js: module-level state, started once from
// the root layout, follows `manager.active$`, lazy-imports everything beyond
// the reactive state so the root layout's static graph stays small. Under a
// gate an `'unknown'` answer counts as NOT eligible for routing decisions —
// uploads then go to a public server and never break; the hint machinery
// waits for a definite answer.
import { manager } from '$lib/stores/accounts.svelte';
import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';

/** @typedef {'unknown' | 'eligible' | 'ineligible'} BlossomEligibility */

/** @type {Record<string, BlossomEligibility>} */
let states = $state.raw({});
/** @type {string | null} */
let activePubkey = $state(null);
/** @type {import('rxjs').Subscription | undefined} */
let accountSub;
/** @type {(() => void) | undefined} */
let destroyRoot;
/** Bumped per account emission so a late-resolving host for a previous account is dropped. */
let hostGeneration = 0;
/** Retry delays while a probe keeps failing or answering "undetermined". */
const RETRY_DELAYS_MS = [15_000, 60_000, 300_000];
/** Pending retry timer per pubkey (plain bookkeeping). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, never read by the UI
const retryTimers = new Map();
/** Last seen nip05 list per pubkey (plain: only used to detect a change). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, never read by the UI
const lastProfileNip05s = new Map();

/**
 * @param {string} pubkey
 * @param {BlossomEligibility} value
 */
function setState(pubkey, value) {
  if (states[pubkey] === value) return;
  states = { ...states, [pubkey]: value };
}

/** Resolve once `/api/config` has been merged into runtimeConfig. */
function waitForConfig() {
  return new Promise((resolve) => {
    /** @type {(() => void) | undefined} */
    let unsubscribe;
    let done = false;
    unsubscribe = configReady.subscribe((ready) => {
      if (!ready || done) return;
      done = true;
      resolve(undefined);
      queueMicrotask(() => unsubscribe?.());
    });
    if (done) unsubscribe();
  });
}

function isGated() {
  return !!runtimeConfig.blossom?.gated;
}

/** @param {string} pubkey */
function clearRetry(pubkey) {
  const timer = retryTimers.get(pubkey);
  if (timer !== undefined) clearTimeout(timer);
  retryTimers.delete(pubkey);
}

/**
 * Schedule the next probe while the answer is still unknown (network error,
 * non-OK response, or the server's "undetermined" while a directory is down).
 * Backs off through RETRY_DELAYS_MS and then stops; a later trigger (handle
 * grant, nip05 change, refused upload) starts over.
 * @param {string} pubkey
 * @param {number} attempt
 */
function scheduleRetry(pubkey, attempt) {
  clearRetry(pubkey);
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return;
  retryTimers.set(
    pubkey,
    setTimeout(() => {
      retryTimers.delete(pubkey);
      if (pubkey !== activePubkey) return;
      refreshBlossomEligibility(pubkey, { attempt: attempt + 1 });
    }, delay)
  );
}

/**
 * Ask the server again. Resolves when the state was updated (or left as is on
 * a network error — never throws). While the answer stays unknown the probe
 * is retried with backoff.
 * @param {string | null | undefined} pubkey
 * @param {{ refresh?: boolean, attempt?: number }} [opts] refresh: bypass the server cache (after a handle grant)
 */
export async function refreshBlossomEligibility(pubkey, { refresh = false, attempt = 0 } = {}) {
  if (!pubkey) return;
  if (!isGated()) {
    setState(pubkey, 'eligible');
    return;
  }
  if (attempt === 0) clearRetry(pubkey);
  let settled = false;
  try {
    const query = `pubkey=${encodeURIComponent(pubkey)}${refresh ? '&refresh=1' : ''}`;
    const res = await fetch(`/api/blossom/eligible?${query}`);
    if (res.ok) {
      const body = await res.json();
      // `eligible: null` = undetermined (a directory is down server-side).
      if (typeof body?.eligible === 'boolean') {
        setState(pubkey, body.eligible ? 'eligible' : 'ineligible');
        settled = true;
      }
    }
  } catch {
    /* stays 'unknown' — routing treats that as not eligible */
  }
  if (!settled) scheduleRetry(pubkey, attempt);
}

/**
 * Host the re-check triggers for one account: a NIP-05 handle grant flipping
 * to 'granted' (server cache bypass) and the own kind 0's nip05 list changing.
 * @param {string} pubkey
 * @param {number} generation
 */
async function hostFor(pubkey, generation) {
  await waitForConfig();
  if (generation !== hostGeneration) return;
  if (!isGated()) {
    setState(pubkey, 'eligible');
    return;
  }
  refreshBlossomEligibility(pubkey);

  const [{ eventStore }, { getHandleGrant, initNip05ReadyAlert }, { getProfileNip05s }] =
    await Promise.all([
      import('$lib/stores/nostr-infrastructure.svelte'),
      import('$lib/stores/nip05-ready-alert.svelte.js'),
      import('$lib/helpers/nip05-verify.js')
    ]);
  if (generation !== hostGeneration) return;
  initNip05ReadyAlert();

  destroyRoot?.();
  destroyRoot = $effect.root(() => {
    let lastGrant = getHandleGrant().state;
    $effect(() => {
      const state = getHandleGrant().state;
      if (state === 'granted' && lastGrant !== 'granted') {
        refreshBlossomEligibility(pubkey, { refresh: true });
      }
      lastGrant = state;
    });

    $effect(() => {
      const sub = eventStore.replaceable(0, pubkey).subscribe((event) => {
        if (!event) return;
        const key = getProfileNip05s(event).join('|');
        const prev = lastProfileNip05s.get(pubkey);
        lastProfileNip05s.set(pubkey, key);
        if (prev !== undefined && prev !== key) refreshBlossomEligibility(pubkey);
      });
      return () => sub.unsubscribe();
    });
  });
}

/**
 * Start eligibility tracking. Idempotent; the root layout calls it once in
 * the browser. Follows account switches through `manager.active$`.
 */
export function initBlossomEligibility() {
  if (accountSub) return;
  accountSub = manager.active$.subscribe((account) => {
    hostGeneration += 1;
    destroyRoot?.();
    destroyRoot = undefined;
    activePubkey = account?.pubkey ?? null;
    if (account) hostFor(account.pubkey, hostGeneration);
  });
}

/** Tear the tracking down (tests; the app keeps it for its lifetime). */
export function stopBlossomEligibility() {
  hostGeneration += 1;
  accountSub?.unsubscribe();
  accountSub = undefined;
  destroyRoot?.();
  destroyRoot = undefined;
  states = {};
  activePubkey = null;
  lastProfileNip05s.clear();
  for (const pubkey of [...retryTimers.keys()]) clearRetry(pubkey);
}

/**
 * Reactive answer for an account ('unknown' until the server replied, and
 * always 'eligible' when the deployment has no gate).
 * @param {string | null | undefined} [pubkey] defaults to the active account
 * @returns {BlossomEligibility}
 */
export function getBlossomEligibility(pubkey = activePubkey) {
  if (!isGated()) return 'eligible';
  if (!pubkey) return 'unknown';
  return states[pubkey] ?? 'unknown';
}

/**
 * Routing predicate: may this account upload to the deployment's own servers?
 * Under a gate an unanswered check counts as "no" so uploads never break.
 * @param {string | null | undefined} [pubkey] defaults to the active account
 */
export function isBlossomEligible(pubkey = activePubkey) {
  return getBlossomEligibility(pubkey) === 'eligible';
}
