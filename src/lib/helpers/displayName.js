/**
 * How a profile is named in the UI.
 *
 * NIP-24 splits the two name fields: `display_name` is the free-form name a
 * client should render, `name` is the short handle-style one. Clients that show
 * profiles — Amethyst (`displayName ?: name`), Wisp, the OG tag builder in
 * `src/lib/server/og.js` — resolve `display_name` first; we had it inverted on
 * the profile page, so a profile carrying both showed the handle.
 *
 * The last resort is the short npub, not a placeholder word: a rendered
 * "Anonymous User" is indistinguishable from someone whose name really is
 * that, and users reading it in another client take it for data we published.
 *
 * Dependency-light (only `pubkey.js`) so components under jsdom can import it.
 */
import { shortNpub } from './pubkey.js';

/**
 * @param {{ display_name?: string, name?: string } | null | undefined} profile - parsed kind 0 content
 * @param {string} [pubkey] - hex pubkey, for the short-npub fallback
 * @returns {string}
 */
export function getDisplayName(profile, pubkey) {
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  const name = profile?.name?.trim();
  if (name) return name;
  return shortNpub(pubkey);
}
