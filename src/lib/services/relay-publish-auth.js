/**
 * NIP-42 AUTH on the publish path.
 *
 * A relay that wants to know who is writing — strfry with `auth.enabled`
 * refusing a NIP-70 protected event, a members-only relay refusing any
 * write — answers the EVENT with `OK false "auth-required: …"` and sends an
 * AUTH challenge. Measured against strfry 1.1.0 (relay.edufeed.org's image):
 * no challenge on connect, the AUTH frame arrives right before the refusal,
 * and the same event is accepted once the connection has authenticated.
 *
 * applesauce-relay 6.2.1 does not answer the challenge itself. Its default
 * publish retry re-sends through `waitForAuth`, which blocks until somebody
 * authenticates; nobody did, so the publish hung until its timeout — and the
 * connection's "auth required for EVENT" flag stays set, so every LATER
 * publish on it waited too. This module answers instead:
 *
 *   1. publish with a retry config that retries transport errors only;
 *   2. on `auth-required`, authenticate with the active account
 *      (`authenticateOnce`: one AUTH per challenge, shared app-wide, because
 *      a second AUTH is refused and marks the connection unauthenticated);
 *   3. re-send once.
 *
 * Only relays the user publishes to are ever authenticated, and only when
 * they ask. Anonymous visitors have no signer, so nothing is signed and no
 * prompt appears; reads are untouched. A slow NIP-46 approval only delays the
 * relay that asked — callers publish to each relay independently.
 */
import { throwError, timer } from 'rxjs';
import { authenticateOnce, isAuthRequiredError } from '$lib/groups/relay-auth.js';

/** @typedef {{ ok: boolean, message?: string, from?: string }} PublishResponse */

/** @type {() => any} */
let getSigner = () => null;

/**
 * Register where the AUTH signer comes from — the active account. Called once
 * by the accounts store; kept as an injected getter so the publish service
 * does not import the account manager (and its tests do not have to mock it).
 * @param {() => any} getter
 */
export function setRelayAuthSigner(getter) {
  getSigner = typeof getter === 'function' ? getter : () => null;
}

/**
 * @param {PublishResponse | null | undefined} response
 * @returns {boolean}
 */
export function isAuthRequiredResponse(response) {
  return response?.ok === false && String(response.message ?? '').startsWith('auth-required');
}

/**
 * Retry transport failures (as applesauce's default does: 3 tries, 1s/2s/3s
 * backoff) but never an `auth-required` refusal — retrying that only parks
 * the request in `waitForAuth`. Erroring from `delay` ends rxjs `retry`.
 */
export const AUTH_AWARE_PUBLISH_RETRY = {
  count: 3,
  resetOnSuccess: true,
  /** @param {any} err @param {number} count */
  delay: (err, count) => (isAuthRequiredError(err) ? throwError(() => err) : timer(count * 1000))
};

/**
 * One publish attempt; a thrown auth-required becomes a plain refusal.
 * @param {any} relay
 * @param {any} event
 * @param {number} timeout
 * @returns {Promise<PublishResponse>}
 */
async function publishOnce(relay, event, timeout) {
  try {
    return await relay.publish(event, { timeout, retries: AUTH_AWARE_PUBLISH_RETRY });
  } catch (err) {
    if (isAuthRequiredError(err)) {
      return {
        ok: false,
        message: String(/** @type {any} */ (err)?.message ?? err),
        from: relay.url
      };
    }
    throw err;
  }
}

/**
 * Publish to one relay, answering a NIP-42 challenge if the relay asks for
 * one. Resolves with the relay's verdict (`ok:false` for a refusal, including
 * an AUTH we could not give); throws only on transport errors, like
 * `relay.publish`.
 *
 * @param {any} relay an applesauce Relay
 * @param {any} event signed event
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<PublishResponse>}
 */
export async function publishWithAuth(relay, event, { timeout = 5000 } = {}) {
  const first = await publishOnce(relay, event, timeout);
  if (!isAuthRequiredResponse(first)) return first;

  const signer = getSigner();
  const auth = signer ? await authenticateOnce(relay, signer) : { ok: false, message: 'no signer' };
  if (!auth.ok) {
    // Un-stick the connection: with the flag set and no authentication,
    // applesauce holds every later EVENT on this relay until its timeout,
    // so one declined bunker prompt would stall all ordinary publishing
    // there for the rest of the session.
    try {
      relay.receivedAuthRequiredForEvent?.next?.(false);
    } catch {
      /* not an applesauce 6 relay — nothing to reset */
    }
    console.warn(`[nip42] could not authenticate with ${relay.url}:`, auth.message);
    return first;
  }
  return publishOnce(relay, event, timeout);
}
