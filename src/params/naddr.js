/**
 * Route matcher for naddr parameters
 * Ensures the route only matches valid naddr (Nostr Address Reference) patterns
 * Format: naddr1 + base32 encoded data
 *
 * @param {string} param - The route parameter to validate
 * @returns {boolean} True if the parameter matches naddr pattern
 */
export function match(param) {
  // naddr format: starts with "naddr1" followed by base32-encoded data
  // Base32 alphabet: a-z, 0-9 (lowercase only for bech32)
  // Typical length: 100-200 characters
  const naddrPattern = /^naddr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,}$/;

  return naddrPattern.test(param);
}
