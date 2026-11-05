/**
 * NIP-58 badge actions.
 *
 * Contract follows the applesauce `Action` type:
 *   `(params) => async ({ user, publish, sign }) => Promise<void>`
 */
import { lastValueFrom, merge } from 'rxjs';
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
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

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
  const relays = getAllLookupRelays();
  if (!relays.length) return;
  // Kind 10008 is a plain replaceable event with NO d tag — an identifier
  // would poison the batched relay filter with #d for every other replaceable
  // kind loaded in the same second (see badge-awards.svelte.js).
  const load = lastValueFrom(
    merge(
      addressLoader({ kind: PROFILE_BADGES_KIND, pubkey, relays }),
      addressLoader({
        kind: LEGACY_PROFILE_BADGES_KIND,
        pubkey,
        identifier: LEGACY_PROFILE_BADGES_IDENTIFIER,
        relays
      })
    ),
    { defaultValue: undefined }
  );
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
