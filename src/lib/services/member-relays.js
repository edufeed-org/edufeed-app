/**
 * Relays every member of the deployment also writes to (`MEMBER_RELAYS`,
 * e.g. relay.edufeed.org for edufeed.org members).
 *
 * The outbox model alone puts a member's events wherever their kind 10002
 * points — for people who came from other clients that is often nowhere the
 * deployment reads, and their profile, badges and posts vanish for everyone
 * else (2026-11-05: an accepted badge kept on nostr.mom only). Members are
 * the deployment's own people, so their events also land on its own relays.
 *
 * Membership counts only through the NIP-05 directory of NIP05_HANDLE_DOMAIN
 * (the full `/.well-known/nostr.json`, see helpers/member-directory.js) —
 * anyone can type "@edufeed.org" into their profile. The directory is read
 * once per DIRECTORY_TTL_MS and never blocks a publish for long: a slow or
 * broken directory just means no extra relays this time.
 */
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { parseDirectoryMembers } from '$lib/helpers/member-directory.js';

const DIRECTORY_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

/** @type {{ domain: string, at: number, members: Set<string> } | null} */
let cached = null;
/** @type {Promise<Set<string> | null> | null} */
let inflight = null;

/**
 * @param {string} domain
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Set<string> | null>} null when the directory could not be read
 */
async function loadMembers(domain, fetchImpl) {
  if (cached && cached.domain === domain && Date.now() - cached.at < DIRECTORY_TTL_MS) {
    return cached.members;
  }
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetchImpl(`https://${domain}/.well-known/nostr.json`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) return null;
        const members = new Set(parseDirectoryMembers(await res.json()));
        cached = { domain, at: Date.now(), members };
        return members;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/**
 * The deployment's member relays when `pubkey` is a member, otherwise [].
 * @param {string} pubkey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function getMemberRelays(pubkey, fetchImpl = fetch) {
  const relays = runtimeConfig.membership?.relays ?? [];
  const domain = runtimeConfig.membership?.handleDomain ?? '';
  if (!relays.length || !domain || !pubkey) return [];
  const members = await loadMembers(domain, fetchImpl);
  return members?.has(pubkey.toLowerCase()) ? [...relays] : [];
}
