/**
 * NIP-17 DM actions that carry NIP-30 custom emoji tags.
 *
 * applesauce's `SendWrappedMessage` / `ReplyToWrappedMessage` build the
 * kind-14 rumor from plain text; their only option object goes to the gift
 * wrap step, so there is no way to hand them the custom emojis the composer
 * inserted. The content renderer resolves `:shortcode:` solely from an
 * `emoji` tag on the event (applesauce-content's emoji transformer calls
 * `getEmojiTag`), so an untagged shortcode renders as literal text.
 *
 * These variants build the same rumor with the same factories and add one
 * `["emoji", shortcode, url]` tag per picked emoji that is still present in
 * the text — the semantics `community/views/Chat.svelte` uses for kind 9 —
 * then delegate wrapping + publishing to applesauce's
 * `GiftWrapMessageToParticipants`, exactly as the stock actions do.
 *
 * Contract follows the applesauce `Action` type:
 *   `(params) => async ({ signer, run }) => Promise<void>`
 */
import { GiftWrapMessageToParticipants } from 'applesauce-actions/actions';
import { WrappedMessageFactory } from 'applesauce-common/factories';
import { addNameValueTag } from 'applesauce-core/operations/tag/common';

/**
 * @typedef {{ shortcode: string, url: string }} CustomEmoji
 * @typedef {{ emojis?: CustomEmoji[] } & Record<string, any>} DmSendOptions
 *   `emojis` — custom emojis the composer inserted; every other key is passed
 *   on as the gift-wrap options (e.g. `expiration`).
 */

/**
 * Add an `emoji` tag to the factory for every picked emoji whose
 * `:shortcode:` is still in the text. `addNameValueTag` dedupes on
 * (name, value), so a shortcode used twice yields one tag.
 * @param {WrappedMessageFactory} factory
 * @param {string} message
 * @param {CustomEmoji[]} emojis
 */
function tagCustomEmojis(factory, message, emojis) {
  for (const emoji of emojis) {
    if (!emoji?.shortcode || !emoji?.url) continue;
    if (!message.includes(`:${emoji.shortcode}:`)) continue;
    factory = factory.modifyPublicTags(addNameValueTag(['emoji', emoji.shortcode, emoji.url]));
  }
  return factory;
}

/**
 * Stamp the sender pubkey onto the draft. `stamp` strips `id`; the gift-wrap
 * operation computes it (`rumor.id = getEventHash(rumor)`) before sealing,
 * which is why applesauce's own actions hand this id-less draft to
 * `GiftWrapMessageToParticipants` as a `Rumor` too.
 * @param {WrappedMessageFactory} factory
 * @param {import('applesauce-core/factories').EventSigner} signer
 * @returns {Promise<import('applesauce-common/helpers/gift-wrap').Rumor>}
 */
async function stampRumor(factory, signer) {
  return /** @type {import('applesauce-common/helpers/gift-wrap').Rumor} */ (
    await factory.as(signer).stamp()
  );
}

/**
 * Sends a NIP-17 wrapped message to a conversation, tagging custom emojis.
 * @param {string | string[]} participants - conversation participant pubkeys
 * @param {string} message
 * @param {DmSendOptions} [options]
 * @returns {import('applesauce-actions').Action}
 */
export function SendWrappedMessage(participants, message, options) {
  const { emojis = [], ...wrapOpts } = options ?? {};
  return async ({ signer, run }) => {
    if (!signer) throw new Error('Missing signer');
    const factory = tagCustomEmojis(
      WrappedMessageFactory.create(participants, message),
      message,
      emojis
    );
    const rumor = await stampRumor(factory, signer);
    await run(GiftWrapMessageToParticipants, rumor, wrapOpts);
  };
}

/**
 * Sends a NIP-17 reply to a wrapped message, tagging custom emojis.
 * @param {import('applesauce-common/helpers/gift-wrap').Rumor} parent - the parent rumor
 * @param {string} message
 * @param {DmSendOptions} [options]
 * @returns {import('applesauce-actions').Action}
 */
export function ReplyToWrappedMessage(parent, message, options) {
  const { emojis = [], ...wrapOpts } = options ?? {};
  return async ({ signer, run }) => {
    if (!signer) throw new Error('Missing signer');
    // Same recipient resolution as applesauce's ReplyToWrappedMessage.
    const recipient =
      parent.tags.find((/** @type {string[]} */ t) => t[0] === 'p')?.[1] ?? parent.pubkey;
    const factory = tagCustomEmojis(
      WrappedMessageFactory.reply(parent, recipient, message),
      message,
      emojis
    );
    const rumor = await stampRumor(factory, signer);
    await run(GiftWrapMessageToParticipants, rumor, wrapOpts);
  };
}
