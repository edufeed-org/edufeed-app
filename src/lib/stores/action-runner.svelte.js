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
 * Usage:
 *   import { actionRunner } from '$lib/stores/action-runner.svelte.js';
 *   import { AddEventToCalendar } from 'applesauce-actions/actions';
 *   await actionRunner.run(AddEventToCalendar, calendarEvent, eventToAdd);
 */

import { ActionRunner } from 'applesauce-actions';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from './nostr-infrastructure.svelte';
import { manager } from './accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

export const factory = createAppEventFactory({ signer: manager.signer });

/**
 * Publish wrapper adapting our publishEvent to applesauce's PublishMethod signature.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string[]} [relays]
 */
const publish = async (event, relays) => {
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
  publishEvent(event, [], { additionalRelays: relays || [] }).catch((err) => {
    console.error('Background publish failed', err);
  });
};

// Sync client tag on the long-lived factory when settings change at runtime
// Wrapped in $effect.root() because this runs at module level (outside any component)
$effect.root(() => {
  $effect.pre(() => {
    if (appSettings.includeClientTag && runtimeConfig.clientName) {
      factory.setClient({ name: runtimeConfig.clientName });
    } else {
      factory.clearClient();
    }
  });
});

export const actionRunner = new ActionRunner(eventStore, factory, publish);
export const actionRunnerOptimistic = new ActionRunner(eventStore, factory, publishOptimistic);
