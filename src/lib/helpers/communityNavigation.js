/**
 * Build a community URL, preserving the current ?view= param if present.
 * @param {string} npub
 * @param {URLSearchParams | null} [currentSearchParams]
 * @returns {string}
 */
export function buildCommunityPath(npub, currentSearchParams) {
  const view = currentSearchParams?.get('view');
  const query = view ? `?view=${view}` : '';
  return `/c/${npub}${query}`;
}
