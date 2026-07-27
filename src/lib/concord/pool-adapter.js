// Cross-build compatibility shim between the app's RelayPool
// (applesauce-relay@6.2.1) and applesauce-concord's pinned pre-release fork
// (applesauce-relay@0.0.0-concord-*, nested under node_modules/.pnpm/). Both
// packages export structurally similar `RelayPool`/`Relay` classes, but the
// fork ADDS per-pubkey NIP-42 auth tracking that 6.2.1 doesn't have:
//
//   - Relay#isAuthenticated(pubkeys: string | string[]): boolean   (missing in 6.2.1)
//   - RelayStatus#authenticatedPubkeys: string[]                  (6.2.1 only has
//                                                                   singular `authenticatedAs`)
//
// `relay.authenticate(signer)` itself is UNCHANGED between builds (same
// signature, same NIP-42 AUTH protocol exchange) — this shim never
// reimplements or skips that; it only adds the client-side bookkeeping the
// concord package reads via `isAuthenticated`.
//
// Why this matters: concord authenticates MULTIPLE synthetic per-stream
// pubkeys (control/guestbook/per-channel/dissolved/rekey keys — see
// relay-auth.js) on the SAME relay connection. 6.2.1's Relay only remembers
// the single most-recently-authenticated pubkey (`authenticatedAs`); if we
// shimmed `isAuthenticated(pk)` naively as `pk === relay.authenticatedAs`,
// authenticating stream key B would make key A appear "unauthenticated"
// again, and `authenticateStreamKeys()`'s retry loop
// (applesauce-concord/dist/client/relay-auth.js:101-152) would re-authenticate
// A, which un-authenticates B, forever — an infinite AUTH ping-pong against
// the relay. This shim instead tracks auth state itself, per (relay url,
// pubkey), keyed by the relay's CURRENT NIP-42 challenge string:
//
//   - On a successful `authenticate(signer)` (`res.ok === true`), record
//     `pubkey -> relay.challenge` (the challenge active at auth time).
//   - `isAuthenticated(pubkeys)` is true only when every requested pubkey's
//     recorded challenge equals the relay's CURRENT `challenge`.
//
// This supports many simultaneously-authenticated pubkeys per connection
// (no single-slot overwrite) and self-invalidates on reconnect: a fresh
// socket gets a fresh challenge string, so old records stop matching until
// re-authenticated — no background subscription needed to detect reconnects.
//
// Degrade path: if the signer has no `getPublicKey()` (the AuthSigner type
// only guarantees `signEvent`), we can't attribute the success to a specific
// pubkey. Rather than leave it permanently "unauthenticated" (which would
// make the retry loop spin forever re-sending real AUTH events for a
// protocol exchange that already succeeded), we stamp a per-relay wildcard
// for the current challenge: every `isAuthenticated()` check against that
// relay+challenge reports true. This only affects OUR client-side filtering
// (whether concord bothers to re-authenticate) — the real AUTH already
// happened on the wire — so it's safe. In practice every signer concord
// passes here (`PrivateKeySigner`, or the user's real account signer) does
// implement `getPublicKey()`, so this path should not be hit.
//
// If/when the app upgrades to a build of applesauce-relay that already has
// `isAuthenticated`, this adapter detects that per-relay (`typeof
// relay.isAuthenticated === 'function'`) and returns the relay UNWRAPPED —
// fully transparent, no shimmed state involved.
import { map } from 'rxjs';

class AuthTracker {
  constructor() {
    /** @type {Map<string, Map<string, string>>} relay url -> (pubkey -> challenge at auth time) */
    this.authenticated = new Map();
    /** @type {Map<string, string>} relay url -> challenge for which we accepted an unattributable auth (degrade path) */
    this.wildcard = new Map();
  }

  /**
   * @param {string} url
   * @param {string | string[]} pubkeys
   * @param {string | null | undefined} currentChallenge
   * @returns {boolean}
   */
  isAuthenticated(url, pubkeys, currentChallenge) {
    if (!currentChallenge) return false; // no challenge yet => nothing to be authenticated against
    if (this.wildcard.get(url) === currentChallenge) return true;
    const perRelay = this.authenticated.get(url);
    if (!perRelay) return false;
    const list = Array.isArray(pubkeys) ? pubkeys : [pubkeys];
    return list.every((pk) => perRelay.get(pk) === currentChallenge);
  }

  /**
   * Pubkeys we consider authenticated on `url` for `challenge` — used to
   * populate the `authenticatedPubkeys` field on shimmed status$ entries.
   * @param {string} url
   * @param {string | null | undefined} challenge
   * @returns {string[]}
   */
  authenticatedPubkeysFor(url, challenge) {
    const perRelay = this.authenticated.get(url);
    if (!perRelay || !challenge) return [];
    return [...perRelay.entries()].filter(([, ch]) => ch === challenge).map(([pk]) => pk);
  }

  /**
   * Perform the REAL authenticate() call against `relay`, then record the
   * result for `isAuthenticated()` bookkeeping. Never skips or fakes the
   * protocol exchange — only adds tracking on top of it.
   * @param {any} relay real (unwrapped) relay instance
   * @param {any} signer
   */
  async authenticate(relay, signer) {
    const res = await relay.authenticate(signer);
    if (res?.ok) {
      const challenge = relay.challenge;
      if (challenge) {
        let pubkey;
        try {
          pubkey =
            typeof signer.getPublicKey === 'function' ? await signer.getPublicKey() : undefined;
        } catch {
          pubkey = undefined;
        }
        if (pubkey) {
          let perRelay = this.authenticated.get(relay.url);
          if (!perRelay) {
            perRelay = new Map();
            this.authenticated.set(relay.url, perRelay);
          }
          perRelay.set(pubkey, challenge);
        } else {
          // Degrade path — see module header. Safe: the real AUTH already
          // succeeded; this only stops the retry loop from spinning.
          this.wildcard.set(relay.url, challenge);
        }
      }
    }
    return res;
  }
}

/**
 * Wrap a real Relay instance so `isAuthenticated`/`authenticate` are always
 * present, delegating everything else untouched. Returns the SAME relay
 * object unmodified when it already implements `isAuthenticated` (i.e. the
 * app is already on a concord-compatible applesauce-relay build).
 * @param {any} relay
 * @param {AuthTracker} tracker
 * @param {WeakMap<any, any>} cache
 */
function wrapRelay(relay, tracker, cache) {
  if (typeof relay.isAuthenticated === 'function') return relay;
  const cached = cache.get(relay);
  if (cached) return cached;
  const proxy = new Proxy(relay, {
    get(target, prop) {
      if (prop === 'isAuthenticated') {
        return (/** @type {string | string[]} */ pubkeys) =>
          tracker.isAuthenticated(target.url, pubkeys, target.challenge);
      }
      if (prop === 'authenticate') {
        return (/** @type {any} */ signer) => tracker.authenticate(target, signer);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  cache.set(relay, proxy);
  return proxy;
}

/**
 * Adapt the app's RelayPool instance (applesauce-relay@6.2.1) so it satisfies
 * applesauce-concord's pinned fork's expectations of `pool.relay(url)` and
 * `pool.status$`, without changing anything else. See module header for the
 * full auth-tracking rationale.
 *
 * Transparent by design: everything not explicitly shimmed here (`request`,
 * `publish`, `subscription`, `relays$`, …) delegates straight through to the
 * real pool, and per-relay methods delegate straight through to the real
 * relay. If the underlying pool/relay already provide `isAuthenticated`,
 * nothing is wrapped at all.
 * @param {any} pool a RelayPool instance
 * @returns {any} a pool-shaped object safe to pass as ConcordClient's `pool` option
 */
export function adaptPoolForConcord(pool) {
  const tracker = new AuthTracker();
  /** @type {WeakMap<any, any>} */
  const relayCache = new WeakMap();

  return new Proxy(pool, {
    get(target, prop) {
      if (prop === 'relay') {
        return (/** @type {string} */ url) => wrapRelay(target.relay(url), tracker, relayCache);
      }
      if (prop === 'status$') {
        return target.status$.pipe(
          map((/** @type {Record<string, any>} */ statuses) => {
            /** @type {Record<string, any>} */
            const out = {};
            for (const [url, status] of Object.entries(statuses)) {
              out[url] =
                'authenticatedPubkeys' in status
                  ? status // already provided by a concord-compatible relay build — leave untouched
                  : {
                      ...status,
                      authenticatedPubkeys: tracker.authenticatedPubkeysFor(url, status.challenge)
                    };
            }
            return out;
          })
        );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
