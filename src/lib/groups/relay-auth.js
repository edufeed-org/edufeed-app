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
