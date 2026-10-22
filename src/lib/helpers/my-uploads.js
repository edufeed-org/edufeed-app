/**
 * "Meine Uploads" helpers — pure functions over the kind-1063 license
 * attestations a user signed. A kind 1063 is a regular (non-replaceable)
 * event, so several attestations can exist for one blob hash; the newest
 * `created_at` wins (tie-break: ascending id), the same resolution rule
 * `useLicenseStatus` applies when rendering a badge.
 */
import { uniqueBlossomServers } from '$lib/helpers/blossom-server-key.js';

/**
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {string | null}
 */
export function getLicenseHash(event) {
  return event?.tags?.find((t) => t[0] === 'x')?.[1] ?? null;
}

/**
 * Collapse a user's kind-1063 events to one entry per blob hash — the newest
 * attestation — ordered newest first. Events without an `x` tag are skipped:
 * nothing can be looked up (or deleted) without the hash.
 * @template {{ id: string, created_at: number, tags?: string[][] }} T
 * @param {T[] | null | undefined} events
 * @returns {T[]}
 */
export function latestPerHash(events) {
  /** @type {Map<string, T>} */
  const byHash = new Map();
  for (const event of events || []) {
    const hash = getLicenseHash(event);
    if (!hash) continue;
    const current = byHash.get(hash);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      byHash.set(hash, event);
    }
  }
  return [...byHash.values()].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The Blossom servers a blob must be deleted from: the origin of every `url`
 * tag whose path carries the blob hash (BUD-01 addresses blobs as
 * `<server>/<sha256>[.ext]`). When no url names the hash — an attestation
 * for a foreign image URL — the caller's fallback list (the user's own
 * servers) is used instead, so a stray copy there still goes away; a 404
 * from a server that never had it is harmless.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @param {string[]} fallbackServers
 * @returns {string[]}
 */
export function blossomServersForLicense(event, fallbackServers) {
  const hash = getLicenseHash(event);
  /** @type {string[]} */
  const origins = [];
  if (hash) {
    for (const tag of event?.tags || []) {
      if (tag[0] !== 'url' || !tag[1]) continue;
      try {
        const parsed = new URL(tag[1]);
        if (parsed.pathname.toLowerCase().includes(hash.toLowerCase())) {
          origins.push(parsed.origin.toLowerCase());
        }
      } catch {
        /* not a URL */
      }
    }
  }
  const servers = origins.length > 0 ? origins : fallbackServers || [];
  return uniqueBlossomServers(servers).map((s) => s.replace(/\/+$/, ''));
}
