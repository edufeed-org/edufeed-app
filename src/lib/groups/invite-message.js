// Plain-text NIP-17 DM body for an npub invite (Task A6): one greeting
// sentence, the app join URL, and — when a naddr identifier is supplied — a
// `nostr:` line on its own line so cross-client NIP-29 clients can act on it
// too (the invite code lives inside `naddr`'s own `?invite=` query, per
// NIP-29's invite-URL convention — composing that string is the caller's
// job: relay-self.js + nip19.naddrEncode). Stays a pure formatter so it's
// trivially unit-testable without any network or signing.
import * as m from '$lib/paraglide/messages';

/**
 * @param {{communityName: string, joinUrl: string, naddr?: string | null}} args
 * @returns {string}
 */
export function buildGroupInviteMessage({ communityName, joinUrl, naddr }) {
  const lines = [m.group_invite_dm_body({ name: communityName }), joinUrl];
  if (naddr) lines.push(`nostr:${naddr}`);
  return lines.join('\n');
}
