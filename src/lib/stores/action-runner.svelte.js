/**
 * App-wide ActionRunner singleton.
 * Orchestrates applesauce actions with EventStore, EventFactory, and publishing.
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

const factory = createAppEventFactory({ signer: manager.signer });

/**
 * Publish wrapper adapting our publishEvent to applesauce's PublishMethod signature.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string[]} [relays]
 */
const publish = async (event, relays) => {
  const result = await publishEvent(event, [], { additionalRelays: relays || [] });
  if (!result.success) throw new Error('Failed to publish event to any relay');
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
