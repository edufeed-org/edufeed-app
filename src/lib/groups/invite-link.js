/**
 * Recognise the group invite DM that `buildGroupInviteMessage` writes:
 *
 *   <greeting sentence>
 *   https://<origin>/c/<npub>?join=<code>
 *   nostr:<naddr>?invite=<code>          (optional, for other NIP-29 clients)
 *
 * The join URL is the load-bearing line — the recipient redeems `?join=` in
 * CommunityProfileHero. The thread renders a matching message as an invite
 * card with a real CTA, and dm-trust keeps it out of the requests folder:
 * an invite is by definition from someone the recipient does not follow yet.
 *
 * Pure (nip19 only) so both the node-side classification and the component
 * can share it without dragging in paraglide or the network stack.
 */
import { nip19 } from 'nostr-tools';

// Any origin (dev/prod/localhost) — the CTA keeps the URL as written, so a
// cross-deployment invite still lands on the deployment that minted it.
const JOIN_URL_RE = /https?:\/\/[^\s/]+\/c\/(npub1[a-z0-9]{58})\?(?:[^\s#]*&)?join=([A-Za-z0-9]+)/;
// The naddr line keeps its `?invite=` query: that whole string is what other
// clients accept as an invite URL.
const NADDR_LINE_RE = /nostr:(naddr1[a-z0-9]+\?invite=[A-Za-z0-9]+)/;

/**
 * @typedef {{ communityPubkey: string, code: string, joinUrl: string, naddr: string | null }} GroupInvite
 */

/**
 * @param {string | undefined | null} content - decrypted DM body
 * @returns {GroupInvite | null}
 */
export function parseGroupInvite(content) {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(JOIN_URL_RE);
  if (!match) return null;
  let communityPubkey;
  try {
    const decoded = nip19.decode(match[1]);
    if (decoded.type !== 'npub') return null;
    communityPubkey = /** @type {string} */ (decoded.data);
  } catch {
    return null;
  }
  return {
    communityPubkey,
    code: match[2],
    joinUrl: match[0],
    naddr: content.match(NADDR_LINE_RE)?.[1] ?? null
  };
}
