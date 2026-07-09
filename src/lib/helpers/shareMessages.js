/**
 * Feedback messages for community-share apply actions.
 *
 * One Apply click can both CREATE shares and DELETE shares (un-share). The
 * message must say which happened — reporting an un-share as "Successfully
 * shared" reads like the share silently vanished (edufeed-app#4).
 */

/** @param {number} n */
function communities(n) {
  return n === 1 ? 'community' : 'communities';
}

/**
 * @param {{ shared: number, unshared: number, failed: number }} counts
 * @returns {{ success: string, error: string }}
 */
export function buildShareResultMessages({ shared, unshared, failed }) {
  const parts = [];
  if (shared > 0) parts.push(`Shared with ${shared} ${communities(shared)}`);
  if (unshared > 0) parts.push(`removed from ${unshared} ${communities(unshared)}`);

  let success = parts.join(', ');
  if (success) success = success.charAt(0).toUpperCase() + success.slice(1);

  const error = failed > 0 ? `Failed to update sharing for ${failed} ${communities(failed)}` : '';

  return { success, error };
}
