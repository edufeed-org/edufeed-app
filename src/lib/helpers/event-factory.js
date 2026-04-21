/**
 * App-wide EventFactory wrapper.
 * Adds a NIP-89 client tag to every event when the user has opted in.
 */

import { EventFactory } from 'applesauce-core/event-factory';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';

/**
 * Create an EventFactory with client tag support.
 * If the user has includeClientTag enabled and a clientName is configured,
 * the factory will automatically add a ["client", "name"] tag to every event.
 *
 * @param {ConstructorParameters<typeof EventFactory>[0]} [options]
 * @returns {EventFactory}
 */
export function createAppEventFactory(options) {
  const factory = new EventFactory(options);
  if (appSettings.includeClientTag && runtimeConfig.clientName) {
    factory.setClient({ name: runtimeConfig.clientName });
  }
  return factory;
}
