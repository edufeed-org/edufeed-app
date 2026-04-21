/**
 * Route matcher for nevent parameters
 * Ensures the route only matches valid nevent (Nostr Event Reference) patterns
 * Format: nevent1 + bech32 encoded data
 *
 * @param {string} param - The route parameter to validate
 * @returns {boolean} True if the parameter matches nevent pattern
 */
export function match(param) {
  // nevent format: starts with "nevent1" followed by bech32-encoded data
  // Bech32 alphabet: qpzry9x8gf2tvdw0s3jn54khce6mua7l
  const neventPattern = /^nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,}$/;

  return neventPattern.test(param);
}
