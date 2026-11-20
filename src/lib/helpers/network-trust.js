/**
 * How many of the viewer's follows must follow someone. One is not enough:
 * mass-follow accounts follow spam too — the porn account behind this rule
 * was followed by exactly one of laoc's 579 follows (2026-11-20).
 */
export const MIN_FOLLOWS_FOLLOWING = 3;

/**
 * Who is "in the viewer's network" (pure). A stranger's follow notification
 * is collapsed into a count and a stranger's profile media is blurred: anyone
 * can follow anyone, and "X folgt dir" must not be a one-click path to
 * explicit pictures (laoc, 2026-11-20). Reactive wiring lives in
 * stores/network-trust.svelte.js.
 *
 * @param {string} pubkey
 * @param {{
 *   self: string | undefined,
 *   follows: string[],
 *   trusted: Iterable<string>,
 *   followedByFollows: (pubkey: string) => number
 * }} ctx - trusted = the deployment's curated/WoT authors;
 *   followedByFollows = how many of the follows follow pubkey
 * @returns {boolean}
 */
export function isInNetworkOf(pubkey, { self, follows, trusted, followedByFollows }) {
  if (!pubkey) return false;
  if (pubkey === self || follows.includes(pubkey)) return true;
  for (const pk of trusted) if (pk === pubkey) return true;
  return followedByFollows(pubkey) >= MIN_FOLLOWS_FOLLOWING;
}
