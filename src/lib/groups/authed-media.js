// Media from a group host that gates its blobs behind membership.
//
// Measured on edufeed.communities.buzz.xyz: /media/<sha>.<ext> answers 401
// anonymously and 403 "relay membership required" for a valid Blossom
// kind-24242 auth from a non-member — so a member fetches with a signed get
// auth, the same way Armada does. The proxy (/api/image) can never carry
// that signature, so these URLs bypass it entirely.
//
// Object URLs are cached per media URL for the session: one signature and one
// download per blob, shared by every mount (avatars repeat per message row).

const BLOB_SHA = /\/([0-9a-f]{64})(?:\.\w+)?(?:$|[?#])/;

/** @type {Map<string, Promise<string | null>>} */
const cache = new Map();

/** Test seam. */
export function __resetAuthedMediaCache() {
  cache.clear();
}

/**
 * Whether `url` lives on the same host as the group relay — the only URLs a
 * group-scoped auth is allowed to sign for.
 * @param {string | null | undefined} url
 * @param {string | null | undefined} relay
 */
export function isSameMediaHost(url, relay) {
  if (!url || !relay) return false;
  try {
    return new URL(url).hostname === new URL(relay).hostname;
  } catch {
    return false;
  }
}

/**
 * Resolve a membership-gated media URL to an object URL via a Blossom
 * kind-24242 get auth, or null when it cannot be fetched (no signer, refusal,
 * network error). Never throws — an image that stays a placeholder is the
 * correct failure mode.
 * @param {string} url
 * @param {{pubkey: string, signer: {signEvent: (t: any) => Promise<any>}} | null | undefined} user
 * @returns {Promise<string | null>}
 */
export function fetchAuthedMediaUrl(url, user) {
  if (!user?.signer) return Promise.resolve(null);
  const hit = cache.get(url);
  if (hit) return hit;

  const promise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const sha = url.match(BLOB_SHA)?.[1];
    /** @type {string[][]} */
    const tags = [['t', 'get'], ...(sha ? [['x', sha]] : []), ['expiration', String(now + 300)]];
    const signed = await user.signer.signEvent({
      kind: 24242,
      content: 'get',
      created_at: now,
      tags,
      pubkey: user.pubkey
    });
    const response = await fetch(url, {
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(signed))}` }
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  })()
    .catch((error) => {
      console.warn('groups: authed media fetch failed', url, error);
      return null;
    })
    .then((resolved) => {
      // A refusal is not forever: evict so a later mount may retry (the user
      // may have joined in the meantime).
      if (resolved === null) cache.delete(url);
      return resolved;
    });

  cache.set(url, promise);
  return promise;
}

/** Svelte context key: `{ relay: string, getUser: () => any }` set by group
 * surfaces so image components inside them can fetch same-host media authed. */
export const GROUP_MEDIA_AUTH = 'group-media-auth';
