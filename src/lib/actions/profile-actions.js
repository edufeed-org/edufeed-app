/**
 * Custom applesauce actions for the user's kind 0 profile.
 *
 * `UpdateProfile` from applesauce-actions merges into the content JSON only.
 * For profiles carrying multiple NIP-05 identifiers we follow the in-the-wild
 * pattern of repeated `["nip05", <address>]` event tags (content nip05 stays
 * the primary address) — that requires a tag-level action.
 */
import { modifyPublicTags } from 'applesauce-core/operations/tags';
import { addNameValueTag } from 'applesauce-core/operations/tag/common';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

/**
 * Append an additional `["nip05", <address>]` tag to the user's kind 0,
 * leaving the content JSON — including any primary `nip05` — untouched.
 * Publishes to the user's outboxes.
 *
 * Callers must ensure the address isn't already present (content or tags);
 * this action appends unconditionally.
 *
 * @param {string} address - full NIP-05 address, e.g. `maria@edufeed.org`
 */
export function AddProfileNip05Tag(address) {
  return async (
    /** @type {import('applesauce-actions').ActionContext} */ { user, publish, sign }
  ) => {
    const [profile, outboxes] = await Promise.all([
      user.profile$.$first(1000, undefined),
      user.outboxes$.$first(1000, undefined)
    ]);
    if (!profile) throw new Error('Unable to find profile metadata');

    const factory = createAppEventFactory();
    const draft = await factory.modify(
      profile.event,
      modifyPublicTags(addNameValueTag(['nip05', address], false))
    );
    const signed = await sign(draft);
    await publish(signed, outboxes);
  };
}
