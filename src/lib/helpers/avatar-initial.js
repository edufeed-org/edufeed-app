/**
 * The letter an initials avatar shows: the first letter or digit of the
 * name, upper-cased — punctuation and symbols ("[QA] Gast B") are skipped
 * (QA round 2 K-new-3). `fallback` only when the name has none.
 *
 * @param {string | null | undefined} name
 * @param {string} fallback
 * @returns {string}
 */
export function avatarInitial(name, fallback) {
  const match = String(name ?? '').match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : fallback;
}
