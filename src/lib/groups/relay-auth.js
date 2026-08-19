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

/**
 * NIP-29's other refusal: authenticated, but not a member of the (private)
 * group — khatru closes the REQ with `restricted: not a member`. Distinct
 * from auth-required: authenticating again cannot fix it, joining can.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRestrictedError(err) {
  const message = String(/** @type {any} */ (err)?.message ?? err ?? '');
  return message.includes('restricted');
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
 * Wait (bounded) for the relay's AUTH challenge. The CLOSED `auth-required`
 * error routinely arrives BEFORE the AUTH frame does, so "no challenge right
 * now" usually means "not yet", not "never" — giving up immediately left the
 * chat permanently blank until some other flow happened to authenticate
 * (laoc, 2026-08-19). `challenge$` is a BehaviorSubject on applesauce's
 * Relay; a fake without it resolves null at once.
 * @param {any} relay
 * @param {number} timeoutMs
 * @returns {Promise<string | null>}
 */
function waitForChallenge(relay, timeoutMs) {
  if (relay?.challenge) return Promise.resolve(relay.challenge);
  const challenge$ = relay?.challenge$;
  if (!challenge$?.subscribe) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    /** @type {{unsubscribe: () => void} | undefined} */
    let sub;
    const timer = setTimeout(() => finish(null), timeoutMs);
    /** @param {string | null} value */
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // BehaviorSubject replays synchronously — `sub` may not be assigned
      // yet, so defer the unsubscribe past the assignment below.
      queueMicrotask(() => sub?.unsubscribe());
      resolve(value);
    }
    sub = challenge$.subscribe((/** @type {string | null} */ value) => {
      if (value) finish(value);
    });
    if (done) sub?.unsubscribe();
  });
}

/**
 * Authenticate with a relay at most once per challenge.
 *
 * Never throws and never resolves ambiguously: callers get `ok:false` for a
 * refusal, a thrown signer error and a missing challenge alike, so none of
 * them can read a refusal as success. When the challenge hasn't arrived yet
 * it is awaited (bounded) rather than treated as missing.
 *
 * @param {any} relay an applesauce Relay
 * @param {any} signer
 * @param {{challengeTimeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export function authenticateOnce(relay, signer, { challengeTimeoutMs = 5000 } = {}) {
  // Already authenticated: the challenge in hand is one we (or another
  // component) have answered. Asking again is what breaks the connection.
  if (relay?.authenticated) return Promise.resolve({ ok: true });
  if (!signer) return Promise.resolve({ ok: false, message: 'no signer' });

  return waitForChallenge(relay, challengeTimeoutMs).then((challenge) => {
    // applesauce's authenticate() THROWS synchronously without a challenge,
    // so this stays a hard guard even after the wait.
    if (!challenge) return { ok: false, message: 'no challenge' };
    // The wait may have crossed another component's successful handshake.
    if (relay?.authenticated) return { ok: true };

    const key = `${relay.url} ${challenge}`;
    const existing = attempts.get(key);
    // Share the in-flight promise rather than starting a second handshake:
    // two components mounting on the same route would otherwise race.
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
  });
}
