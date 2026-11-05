/**
 * NIP-58 badge actions.
 *
 * Contract follows the applesauce `Action` type:
 *   `(params) => async ({ user, publish, sign }) => Promise<void>`
 */
import { lastValueFrom } from 'rxjs';
import { addSlot } from 'applesauce-common/operations/profile-badges';
import {
  PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_IDENTIFIER,
  getProfileBadgeSlots,
  getBadgeAwardPointer,
  getBadgeAwardRecipients,
  isValidBadgeAward
} from 'applesauce-common/helpers';
import { getSeenRelays } from 'applesauce-core/helpers';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { loadProfileBadgeLists as loadLists } from '$lib/loaders/profile-badges.js';

/** Longest we wait for the relays to answer for the current list. */
const LIST_LOAD_TIMEOUT = 5000;

/**
 * Make sure the user's current profile badges list is in the store before a
 * read-modify-write: a kind 10008 is replaceable, so building a fresh one
 * because the old one was simply not loaded yet would silently drop every
 * badge the user accepted before.
 * @param {string} pubkey
 */
async function loadProfileBadgeLists(pubkey) {
  // Lookup relays AND the user's own write relays: on a fresh device the
  // list may only live on the outbox (loaders/profile-badges.js).
  const load = lastValueFrom(loadLists(pubkey), { defaultValue: undefined });
  await Promise.race([
    load.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, LIST_LOAD_TIMEOUT))
  ]);
}

/**
 * Accept a badge award (kind 8): add its definition/award pair to the user's
 * profile badges list and publish the list outbox-model.
 *
 * Always writes the current spec's kind 10008. A deprecated kind 30008
 * `profile_badges` list is folded in — every slot it has that the 10008 lacks
 * is carried over — so the migration never loses a badge another client
 * accepted (the read side, badge-awards.svelte.js, unions both kinds the same
 * way). Accepting the same badge again replaces its slot.
 *
 * @param {import('nostr-tools').NostrEvent} award - the kind 8 event
 */
export function AcceptBadgeAward(award) {
  return async (
    /** @type {import('applesauce-actions').ActionContext} */ { user, publish, sign }
  ) => {
    if (!isValidBadgeAward(award)) throw new Error('Not a badge award');
    const badge = getBadgeAwardPointer(award);
    if (!badge) throw new Error('Badge award without a badge definition');
    if (!getBadgeAwardRecipients(award).some((p) => p.pubkey === user.pubkey)) {
      throw new Error('Badge was not awarded to this user');
    }

    await loadProfileBadgeLists(user.pubkey);
    const [modern, legacy, outboxes] = await Promise.all([
      user.replaceable(PROFILE_BADGES_KIND).$first(1000, undefined),
      user
        .replaceable(LEGACY_PROFILE_BADGES_KIND, LEGACY_PROFILE_BADGES_IDENTIFIER)
        .$first(1000, undefined),
      user.outboxes$.$first(1000, undefined)
    ]);

    const modernAwardIds = new Set(getProfileBadgeSlots(modern).map((slot) => slot.award.id));
    const carryOver = getProfileBadgeSlots(legacy).filter(
      (slot) => !modernAwardIds.has(slot.award.id)
    );
    const seen = getSeenRelays(award);
    const hint = seen ? [...seen][0] : undefined;
    const ops = [
      ...carryOver.map((slot) => addSlot(slot)),
      addSlot({ badge, award: { id: award.id, relays: hint ? [hint] : [] } })
    ];

    const factory = createAppEventFactory();
    const draft = modern
      ? await factory.modify(modern, ...ops)
      : await factory.build({ kind: PROFILE_BADGES_KIND, tags: [] }, ...ops);
    const signed = await sign(draft);
    await publish(signed, outboxes);
  };
}
