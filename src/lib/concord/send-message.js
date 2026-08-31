// Reply-aware channel send (spec §5). The pinned dist's
// community.sendMessage(…, replyTo) writes only the NIP-C7 `q` tag — no `p`
// tag for the parent author, so a reply never lights the recipient's mention
// tier. The factory it uses HAS a .mention() operation; we just can't reach
// it through sendMessage's signature. So replies are built app-side with the
// same ChatMessageFactory (via the lockstep-pinned applesauce-common-concord
// alias) and published through community.sendEvent, which applies the
// identical channel/epoch binding + sealing path (dist/client/community.js).
// Non-replies keep using sendMessage — its content pipeline already turns
// nostr:npub… mentions into p tags (setShortTextContent → tagPubkeyMentions).
//
// Dynamic import: this module is imported by ChannelChat.svelte; a static
// package import would drag the concord dep tree toward SSR chunks, against
// the src/lib/concord convention (see CLAUDE.md).

/**
 * @param {any} community ConcordCommunity
 * @param {string} channelId
 * @param {string} text
 * @param {{id: string, author: string} | null | undefined} replyTo
 * @param {string} myPubkey
 * @returns {Promise<void>}
 */
export async function sendChannelMessage(community, channelId, text, replyTo, myPubkey) {
  if (!replyTo) {
    await community.sendMessage(channelId, text);
    return;
  }
  const { ChatMessageFactory } = await import('applesauce-common-concord/factories');
  let factory = ChatMessageFactory.create(text).replyTo({ id: replyTo.id, author: replyTo.author });
  if (replyTo.author !== myPubkey) factory = factory.mention(replyTo.author);
  await community.sendEvent(channelId, factory);
}
