// Local replacements for applesauce's WrappedMessages* models.
//
// Theirs filter `kind === kinds.PrivateDirectMessage`, so an encrypted file
// message (15) or a private reaction (7) is unwrapped, stored, and then
// dropped before it can be shown (laoc, 2026-09-18). Their
// getConversationIdentifierFromMessage also THROWS on those kinds, hence the
// local identity maths in helpers/dm-rumors.js.
import { kinds } from 'nostr-tools';
import { map } from 'rxjs';
import { watchEventsUpdates } from 'applesauce-core/observable';
import { getGiftWrapRumor } from 'applesauce-common/helpers/gift-wrap';
import {
  isDmMessageRumor,
  isDmReactionRumor,
  rumorConversationId,
  rumorParticipants,
  reactionTargetId
} from '$lib/helpers/dm-rumors.js';

const KEPT = [kinds.PrivateDirectMessage, kinds.FileMessage, kinds.Reaction];

/**
 * Every unlocked rumor we care about, newest first.
 * @param {string} self
 */
export function DmRumorsModel(self) {
  // `any`: applesauce's own ModelConstructor type calls this with
  // `IEventStore | IAsyncEventStore` (see event-store/interface.d.ts), and
  // pinning to the sync-only IEventStore here breaks callers like
  // dm-service.svelte.js that pass this model through that union type.
  return (/** @type {any} */ store) =>
    store.timeline({ kinds: [kinds.GiftWrap], '#p': [self] }).pipe(
      watchEventsUpdates(store),
      map((/** @type {import('nostr-tools').Event[]} */ wraps) =>
        wraps
          // getGiftWrapRumor returns applesauce's internal `Rumor | undefined` type,
          // not a signed nostr-tools Event — `any` here rather than fighting that
          // shape; the rest of this module treats a rumor as {kind, pubkey, tags,
          // content, created_at} which both types satisfy at runtime.
          .map((/** @type {any} */ wrap) => getGiftWrapRumor(wrap))
          .filter((rumor) => !!rumor && KEPT.includes(rumor.kind))
          .sort((/** @type {any} */ a, /** @type {any} */ b) => b.created_at - a.created_at)
      )
    );
}

/**
 * Conversation list: newest MESSAGE per conversation (a reaction is never a preview).
 * @param {string} self
 */
export function DmConversationsModel(self) {
  // `any`: see the comment on DmRumorsModel's store param above.
  return (/** @type {any} */ store) =>
    store.model(DmRumorsModel, self).pipe(
      map((all) => {
        /** @type {Record<string, any>} */
        const newest = {};
        for (const rumor of all) {
          if (!isDmMessageRumor(rumor)) continue;
          const id = rumorConversationId(rumor);
          if (!newest[id] || newest[id].created_at < rumor.created_at) newest[id] = rumor;
        }
        return Object.entries(newest).map(([id, lastMessage]) => ({
          id,
          participants: rumorParticipants(lastMessage),
          lastMessage
        }));
      })
    );
}

/**
 * One thread: messages oldest-first plus its reactions keyed by target rumor id.
 * @param {string} self
 * @param {string | string[]} participants
 */
export function DmThreadModel(self, participants) {
  const identifier = [
    ...new Set(typeof participants === 'string' ? participants.split(':') : [self, ...participants])
  ]
    .sort()
    .join(':');
  // `any`: see the comment on DmRumorsModel's store param above.
  return (/** @type {any} */ store) =>
    store.model(DmRumorsModel, self).pipe(
      map((all) => {
        const mine = all.filter(
          (/** @type {any} */ rumor) => rumorConversationId(rumor) === identifier
        );
        const messages = mine
          .filter(isDmMessageRumor)
          .sort((/** @type {any} */ a, /** @type {any} */ b) => a.created_at - b.created_at);
        const reactionsByTarget = new Map();
        for (const rumor of mine) {
          if (!isDmReactionRumor(rumor)) continue;
          const target = reactionTargetId(rumor);
          if (!target) continue;
          reactionsByTarget.set(target, [...(reactionsByTarget.get(target) ?? []), rumor]);
        }
        return { messages, reactionsByTarget };
      })
    );
}
