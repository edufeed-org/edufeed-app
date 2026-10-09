/**
 * Route matcher for npub / nprofile / note bech32 identifiers used as shorthand
 * at the root path (e.g. `/npub1...`, `/nprofile1...`, `/note1...`), plus
 * NIP-05 addresses (`/maria@edufeed.org`, like njump.me/<address>).
 *
 * Excludes naddr and nevent — those are matched by their own routes
 * (`[naddr=naddr]`, `[nevent=nevent]`), which gate richer render logic.
 *
 * @param {string} param
 * @returns {boolean}
 */
export function match(param) {
  return (
    /^(npub|nprofile|note)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,}$/.test(param) ||
    /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z0-9-]{2,}$/i.test(param)
  );
}
