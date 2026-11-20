// Termi answer feedback on the wire: one NIP-17 gift wrap (kind 14 rumor → seal → 1059)
// from the browser to the deployment's support pubkey. No copy to the sender, no server.
import { GiftWrapFactory, WrappedMessageFactory } from 'applesauce-common/factories';
import { PrivateKeySigner } from 'applesauce-signers';
import { publishGiftWrap } from '$lib/services/gift-wrap-publish.js';

/** The DM relay drops the wrap after this (NIP-40). */
export const FEEDBACK_EXPIRY_SECONDS = 90 * 24 * 60 * 60;

/**
 * @param {{ body: string, recipient: string, relays: string[],
 *   signer?: import('applesauce-core/factories').EventSigner | null }} args
 *   `signer` = the user's, for a message sent by name; absent = a one-time key nobody keeps.
 *   `relays` = the deployment's DM relays, never a fallback.
 * @param {{ publish?: typeof publishGiftWrap, now?: () => number }} [deps]
 * @returns {Promise<void>} throws when sealing fails or no relay accepted the wrap
 */
export async function sendTermiFeedback(
  { body, recipient, relays, signer },
  { publish = publishGiftWrap, now = () => Math.floor(Date.now() / 1000) } = {}
) {
  // publishGiftWrap looks up the recipient's read relays for an empty list: not for feedback
  if (!relays?.length) throw new Error('No feedback relay');
  const sender = signer ?? new PrivateKeySigner();
  // The factory p-tags every pubkey behind a nostr: link in the text; the receiver is the support account alone.
  const rumor = await WrappedMessageFactory.create(recipient, body)
    .modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== 'p'), ['p', recipient]])
    .as(sender)
    .stamp();
  const wrap = await GiftWrapFactory.create(sender, recipient, /** @type {any} */ (rumor), {
    expiration: now() + FEEDBACK_EXPIRY_SECONDS
  });
  const { success } = await publish(wrap, relays);
  if (!success) throw new Error('No relay accepted the feedback');
}
