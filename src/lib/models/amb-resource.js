/**
 * AMB Resource Model
 * Provides reactive access to AMB educational resources (kind 30142, plus 30040 publications on the discover learning tab) from the timeline
 *
 * Uses TimelineModel from applesauce-core which automatically:
 * - Filters out deleted events (NIP-09 deletion events)
 * - Handles deduplication
 * - Re-emits when deletion events are added to EventStore
 * - Provides proper reactive updates
 *
 * Required loaders (must be started before using this model):
 * - AMB resources (kind 30142)
 * - Deletion events for event authors (kind 5)
 *
 * @param {string[]} [authors] - Optional array of author pubkeys to filter by
 * @returns {import('applesauce-core').Model<Array<any>>} Model that emits array of AMB resource events
 */
import { TimelineModel } from 'applesauce-core/models';
import { map } from 'rxjs/operators';
import { formatAMBResource } from '$lib/helpers/educational/index.js';
import { DISCOVER_LEARNING_KINDS } from '$lib/helpers/discover-content-types.js';

/**
 * @param {string[]} [authors]
 */
export function AMBResourceModel(authors = []) {
  return (/** @type {any} */ eventStore) => {
    // Build filter for timeline query
    /** @type {any} */
    const filter = {
      kinds: [...DISCOVER_LEARNING_KINDS],
      limit: 300
    };

    // Add author filter if provided
    if (authors && authors.length > 0) {
      filter.authors = authors;
    }

    // Use TimelineModel which handles deletion filtering automatically
    // TimelineModel will:
    // 1. Filter out events that have deletion events (kind 5) in EventStore
    // 2. Re-emit when new deletion events are added
    // 3. Maintain proper reactivity
    return eventStore.model(TimelineModel, filter).pipe(
      // Transform raw Nostr events to formatted AMB resource objects
      map((events) => events.map((/** @type {any} */ event) => formatAMBResource(event)))
    );
  };
}
