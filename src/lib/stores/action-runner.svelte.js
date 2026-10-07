/**
 * App-wide ActionRunner singletons.
 *
 * - `actionRunner` — awaits relay publish before resolving.
 * - `actionRunnerOptimistic` — fires publish in the background and resolves
 *    as soon as the event is signed and inserted into EventStore. Use this for
 *    interactive operations where blocking the UI on relay round-trips would
 *    feel slow (e.g. follow/unfollow, bookmark, reaction, DM send). The event
 *    is added to the local EventStore by ActionRunner itself, so subscribers
 *    see the new state immediately.
 *
 * applesauce v6: ActionRunner takes the signer directly (the legacy
 * EventFactory context that auto-applied the NIP-89 client tag was removed).
 * Every user-signed action event funnels through signer.signEvent, so the
 * client tag is restored by wrapping the account signer: setClient() runs on
 * each draft before signing when the user has opted in. setClient
 * self-guards on DM kinds (4 legacy DM, 13 seal, 14 rumor, 1059 gift wrap),
 * so sealed/private events are never client-attributed.
 *
 * Usage:
 *   import { actionRunner } from '$lib/stores/action-runner.svelte.js';
 *   import { AddEventToCalendar } from 'applesauce-actions/actions';
 *   await actionRunner.run(AddEventToCalendar, calendarEvent, eventToAdd);
 */

import { ActionRunner } from 'applesauce-actions';
import { setClient } from 'applesauce-core/operations';
import { eventStore } from './nostr-infrastructure.svelte';
import { manager } from './accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { publishGiftWrap, GIFT_WRAP_KIND } from '$lib/services/gift-wrap-publish.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * Account signer wrapped with NIP-89 client tagging. Delegates key access
 * and encryption to manager.signer (a proxy for the active account).
 * @type {import('applesauce-core/factories').EventSigner}
 */
const clientTagSigner = {
  getPublicKey: () => manager.signer.getPublicKey(),
  signEvent: async (draft) => {
    const tagged =
      appSettings.includeClientTag && runtimeConfig.clientName
        ? await setClient(runtimeConfig.clientName)(draft)
        : draft;
    return manager.signer.signEvent(tagged);
  },
  get nip04() {
    return manager.signer.nip04;
  },
  get nip44() {
    return manager.signer.nip44;
  }
};

/**
 * Publish wrapper adapting our publishEvent to applesauce's PublishMethod signature.
 * Kind 1059 gift wraps bypass the generic outbox model and go only to the
 * recipient's DM relays (see gift-wrap-publish.js / NIP-17).
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string[]} [relays]
 */
const publish = async (event, relays) => {
  if (event.kind === GIFT_WRAP_KIND) {
    const result = await publishGiftWrap(event, relays);
    if (!result.success) throw new Error('Failed to publish gift wrap to any relay');
    return;
  }
  const result = await publishEvent(event, [], { additionalRelays: relays || [] });
  if (!result.success) throw new Error('Failed to publish event to any relay');
};

/**
 * Fire-and-forget variant: returns immediately so ActionRunner can complete and
 * the EventStore can be updated optimistically. Publish failures are logged but
 * do not propagate to the caller — relays may have rejected the event without
 * the user knowing, but the local view stays responsive.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string[]} [relays]
 */
const publishOptimistic = async (event, relays) => {
  if (event.kind === GIFT_WRAP_KIND) {
    publishGiftWrap(event, relays).catch((err) =>
      console.error('Background gift-wrap publish failed', err)
    );
    return;
  }
  publishEvent(event, [], { additionalRelays: relays || [] }).catch((err) => {
    console.error('Background publish failed', err);
  });
};

/**
 * ActionRunner that follows the active account.
 *
 * applesauce's ActionRunner resolves `self` (the pubkey) and `user`
 * (castUser(self)) once, on the first run, and caches them for the lifetime
 * of the runner — there is no invalidation when the signer starts answering
 * for a different key. Our runners are session singletons over
 * `manager.signer` (a proxy for whichever account is active), so after an
 * account switch every action READ the previous account's lists while
 * SIGNING as the new one: joining a single community as account B
 * republished account A's whole communities follow set under B's key
 * (2026-10-07). The AccountManager docs promise the switch "automatically
 * uses the new account"; this makes that true by dropping the cached context
 * whenever the signer's pubkey no longer matches it.
 */
class AccountAwareActionRunner extends ActionRunner {
  async getContext() {
    const self = await this.signer.getPublicKey();
    // `_context` is TS-private upstream; there is no public invalidation API.
    const runner = /** @type {{ _context?: { self: string } }} */ (/** @type {unknown} */ (this));
    if (runner._context && runner._context.self !== self) runner._context = undefined;
    return super.getContext();
  }
}

export const actionRunner = new AccountAwareActionRunner(eventStore, clientTagSigner, publish);
export const actionRunnerOptimistic = new AccountAwareActionRunner(
  eventStore,
  clientTagSigner,
  publishOptimistic
);
