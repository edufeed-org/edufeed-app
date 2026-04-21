/**
 * Generic applesauce actions for any NIP-51 list kind.
 *
 * These cover the list kinds that don't have pre-built actions in
 * applesauce-actions (10004 communities, 10005 public chats, 10030
 * emoji list, 30030 emoji sets, 39089 starter packs) plus a unified
 * create/delete helper used by the edit UI for any list kind.
 *
 * Contract follows the applesauce `Action` type:
 *   `(params) => async ({ factory, user, publish, sign }) => Promise<void>`
 *
 * Pre-built applesauce actions should still be preferred when
 * available (e.g. `PinNote`, `FollowUser`, `AddBlockedRelay`) because
 * they encode the correct pointer type per kind.
 */
import { canHaveHiddenTags } from 'applesauce-core/helpers/hidden-tags';
import { modifyPublicTags, modifyHiddenTags } from 'applesauce-core/operations/tags';
import { addNameValueTag, removeNameValueTag } from 'applesauce-core/operations/tag/common';
import * as List from 'applesauce-common/operations/list';

/** Crude but sufficient d-tag generator — 12 random hex chars. */
function randomDTag() {
  const bytes = new Uint8Array(6);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {Object} ModifyListTagsParams
 * @property {number} kind
 * @property {string} [dTag]              - identifier for addressable list kinds
 * @property {string[][]} [add]           - tags to add (e.g. `[['p', pubkey]]`)
 * @property {string[][]} [remove]        - tags to remove
 * @property {boolean} [hidden]           - route through modifyHiddenTags
 */

/**
 * Add / remove tags on a NIP-51 list. Builds a fresh event if the list
 * doesn't exist yet; otherwise modifies the existing one preserving
 * title/description/image/siblings. Publishes to the user's outboxes.
 *
 * @param {ModifyListTagsParams} params
 */
export function ModifyListTags({ kind, dTag, add = [], remove = [], hidden = false }) {
  return async (
    /** @type {import('applesauce-actions').ActionContext} */ { factory, user, publish, sign }
  ) => {
    if (hidden && !canHaveHiddenTags(kind)) {
      throw new Error(`Kind ${kind} does not support hidden tags`);
    }
    const [event, outboxes] = await Promise.all([
      user.replaceable(kind, dTag).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined)
    ]);

    const tagOps = [
      ...add.map((t) => addNameValueTag(/** @type {any} */ (t))),
      ...remove.map((t) => removeNameValueTag(t))
    ];
    const op = hidden ? modifyHiddenTags(...tagOps) : modifyPublicTags(...tagOps);

    const signed = event
      ? await factory.modify(event, op).then(sign)
      : await factory.build({ kind, tags: dTag ? [['d', dTag]] : [] }, op).then(sign);

    await publish(signed, outboxes);
  };
}

/**
 * @typedef {Object} CreateListParams
 * @property {number} kind
 * @property {string} [dTag]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string[][]} [items]         - initial item tags
 * @property {boolean} [hidden]           - put initial items in hidden tags
 */

/**
 * Create a new NIP-51 list event with metadata + initial items.
 * Auto-generates a d-tag for addressable kinds when none is supplied.
 *
 * @param {CreateListParams} params
 */
export function CreateList({ kind, dTag, title, description, image, items = [], hidden = false }) {
  const addressable = kind >= 30000 && kind < 40000;
  const identifier = addressable ? dTag || randomDTag() : undefined;

  return async (
    /** @type {import('applesauce-actions').ActionContext} */ { factory, user, publish, sign }
  ) => {
    if (hidden && !canHaveHiddenTags(kind)) {
      throw new Error(`Kind ${kind} does not support hidden tags`);
    }
    const initialTags = identifier ? [['d', identifier]] : [];

    const tagOps = items.map((t) => addNameValueTag(/** @type {any} */ (t)));
    const itemsOp = tagOps.length
      ? hidden
        ? modifyHiddenTags(...tagOps)
        : modifyPublicTags(...tagOps)
      : undefined;

    const signed = await factory
      .build(
        { kind, tags: initialTags },
        title ? List.setTitle(title) : undefined,
        description ? List.setDescription(description) : undefined,
        image ? List.setImage(image) : undefined,
        itemsOp
      )
      .then(sign);

    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(signed, outboxes);
  };
}

/**
 * Publish a NIP-09 kind-5 deletion for a list event. Ownership is
 * checked against `user.pubkey`.
 *
 * @param {import('nostr-tools').NostrEvent} listEvent
 */
export function DeleteList(listEvent) {
  return async (
    /** @type {import('applesauce-actions').ActionContext} */ { factory, user, publish, sign }
  ) => {
    if (listEvent.pubkey !== user.pubkey) {
      throw new Error('Cannot delete a list owned by another pubkey');
    }
    const draft = await factory.delete([listEvent]);
    const signed = await sign(draft);
    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(signed, outboxes);
  };
}
