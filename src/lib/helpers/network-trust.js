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

/**
 * Notification kinds anyone can aim at anyone: reply/mention (1), reaction
 * (7), comment (1111), mentions in forum threads, articles and wiki pages.
 * Form responses, badge awards, community chat, group events, RSVPs and poll
 * responses come from strangers by design and are never folded.
 */
export const STRANGER_FOLD_KINDS = new Set([1, 7, 1111, 11, 30023, 30818]);

/**
 * Split inbox events into rows and folded strangers (pure). The inbox reads
 * the user's own NIP-65 read relays ungated, so any account can p-tag them
 * there (airdrop reply spam via relay.ditto.pub, 2026-11-27). An event that
 * came through a guarded relay (MEMBER_RELAYS) passed its write policy
 * (nspam, member gate) and stays a row — a new user writing through the app
 * is nobody's follow yet.
 *
 * @template {{ kind: number, pubkey: string }} T
 * @param {T[]} events
 * @param {(pubkey: string) => boolean} inNetwork
 * @param {(event: T) => boolean} onGuardedRelay
 * @returns {{ known: T[], strangers: T[] }}
 */
export function splitStrangers(events, inNetwork, onGuardedRelay) {
  /** @type {T[]} */
  const known = [];
  /** @type {T[]} */
  const strangers = [];
  for (const e of events) {
    const fold = STRANGER_FOLD_KINDS.has(e.kind) && !inNetwork(e.pubkey) && !onGuardedRelay(e);
    (fold ? strangers : known).push(e);
  }
  return { known, strangers };
}
