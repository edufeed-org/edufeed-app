/**
 * The deployment's members: pubkeys listed in the NIP-05 directory of
 * NIP05_HANDLE_DOMAIN (`runtimeConfig.membership.handleDomain`). The people
 * search shows them as their own group above everyone else, so the edufeed
 * account with a common name is not buried under a hundred global ones.
 *
 * Membership comes only from the directory file — a profile claiming
 * "@edufeed.org" proves nothing. After loading it, the members' kind 0s are
 * fetched into the EventStore once, so a name search matches them locally
 * however search relays rank them (a new account has no trust score yet).
 *
 * Module state, shared by every search on the page; `ensureMemberDirectory()`
 * is cheap to call from each one (one fetch per DIRECTORY_TTL_MS).
 */
import { configReady, runtimeConfig } from '$lib/stores/config.svelte.js';
import { fetchEvents } from '$lib/loaders/base.js';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
import { parseDirectoryMembers } from '$lib/helpers/member-directory.js';

/** Re-read the directory at most this often (new members show up within it). */
const DIRECTORY_TTL_MS = 10 * 60 * 1000;
/** Above this many members, skip the profile prefetch: relays would see one huge REQ. */
const MAX_PROFILE_PREFETCH = 1000;

/** Replaced wholesale on every load, never mutated. */
let members = $state.raw(/** @type {Set<string>} */ (new Set()));
/** Bumped when the members or their profiles arrive, so searches re-run. */
let version = $state(0);

let loadedAt = 0;
/** @type {Promise<void> | null} */
let inflight = null;

/** @returns {Set<string>} */
export function getMemberPubkeys() {
  return members;
}

export function getMemberDirectoryVersion() {
  return version;
}

/** The handle domain without "@", or '' when the deployment has none. */
export function getMemberDomain() {
  return runtimeConfig.membership?.handleDomain || '';
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

/** @param {string[]} pubkeys */
function prefetchProfiles(pubkeys) {
  if (pubkeys.length === 0 || pubkeys.length > MAX_PROFILE_PREFETCH) return;
  fetchEvents(
    getProfileLookupRelays(),
    { kinds: [0], authors: pubkeys },
    { cache: true }
  ).subscribe({
    complete: () => version++,
    error: () => version++
  });
}

/**
 * Load (or refresh) the directory unless it is fresh or already loading.
 * Failures keep the previous members — a directory outage must not reorder
 * results mid-session.
 * @param {typeof fetch} [fetchImpl]
 */
export function ensureMemberDirectory(fetchImpl = fetch) {
  if (inflight || Date.now() - loadedAt < DIRECTORY_TTL_MS) return inflight ?? Promise.resolve();
  inflight = (async () => {
    try {
      await waitForConfig();
      const domain = getMemberDomain();
      if (!domain) return;
      const res = await fetchImpl(`https://${domain}/.well-known/nostr.json`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return;
      const next = parseDirectoryMembers(await res.json());
      loadedAt = Date.now();
      const added = next.filter((pk) => !members.has(pk));
      // Replaced wholesale ($state.raw), never mutated — no SvelteSet needed.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      members = new Set(next);
      version++;
      prefetchProfiles(added);
    } catch {
      // Network/CORS — keep what we had; the next search mount retries.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test helper — forget everything. */
export function _resetMemberDirectory() {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  members = new Set();
  version = 0;
  loadedAt = 0;
  inflight = null;
}
