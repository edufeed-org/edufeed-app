// Is this subscription error the relay asking us to authenticate?
//
// A NIP-42 relay closes the REQ with `auth-required: …` rather than answering,
// so an unauthenticated listing comes back as a clean, silent zero — which
// looks exactly like "this host has no channels". Every caller that reads a
// gated relay has to tell those two apart, so the string test lives here once
// instead of being re-typed at each call site.
//
// Matching the machine-readable PREFIX, not a whole message: NIP-01 defines
// `auth-required` as the standard prefix of a CLOSED reason and leaves the
// human part free, so a relay is entitled to word the rest however it likes.

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAuthRequiredError(err) {
  const message = String(/** @type {any} */ (err)?.message ?? err ?? '');
  return message.includes('auth-required');
}

// ---------------------------------------------------------------------------
// One AUTH per challenge, per relay.
//
// A redundant AUTH is not harmless. A relay answers a second one on an
// already-authenticated connection with `ok:false` ("auth-required: already
// authenticated"), and applesauce derives `authenticated$` from the LAST auth
// response (relay.js:245) while `waitForAuth` gates every read on it
// (relay.js:450-454). So the refusal marks a perfectly healthy connection
// unauthenticated and every later request on that relay blocks forever —
// measured live: an empty channel list, no metadata, a blank chat.
//
// It is easy to send that second AUTH by accident, because `challenge$` is a
// BehaviorSubject (relay.js:89): it REPLAYS the last challenge to every new
// subscriber, so any effect that re-subscribes on navigation is handed a
// challenge that was already answered.
//
// The attempt record is MODULE-scoped, not per-caller: relay-directory,
// GroupChat and dm-service each authenticate on their own, so a flag held by
// one of them cannot stop the other two. Keyed on the challenge as well as the
// url, so a genuinely new challenge after a reconnect is still answered.

/** @type {Map<string, Promise<{ok: boolean, message?: string}>>} */
const attempts = new Map();

/** Test-only: forget every recorded attempt. */
export function __resetAuthAttempts() {
  attempts.clear();
}

/**
 * Authenticate with a relay at most once per challenge.
 *
 * Never throws and never resolves ambiguously: callers get `ok:false` for a
 * refusal, a thrown signer error and a missing challenge alike, so none of
 * them can read a refusal as success.
 *
 * @param {any} relay an applesauce Relay
 * @param {any} signer
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export function authenticateOnce(relay, signer) {
  // Already authenticated: the challenge in hand is one we (or another
  // component) have answered. Asking again is what breaks the connection.
  if (relay?.authenticated) return Promise.resolve({ ok: true });

  const challenge = relay?.challenge;
  // applesauce THROWS synchronously without one, so this is a guard, not
  // politeness.
  if (!challenge) return Promise.resolve({ ok: false, message: 'no challenge' });
  if (!signer) return Promise.resolve({ ok: false, message: 'no signer' });

  const key = `${relay.url} ${challenge}`;
  const existing = attempts.get(key);
  // Share the in-flight promise rather than starting a second handshake: two
  // components mounting on the same route would otherwise race.
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(() => relay.authenticate(signer))
    .then((/** @type {any} */ response) =>
      response?.ok === false
        ? { ok: false, message: String(response.message ?? 'refused') }
        : { ok: true }
    )
    .catch((/** @type {any} */ err) => ({ ok: false, message: String(err?.message ?? err) }));

  attempts.set(key, pending);
  return pending;
}
