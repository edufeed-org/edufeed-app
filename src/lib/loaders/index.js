/**
 * Unified loader exports for convenience.
 * Import from here or from specific files based on your needs.
 *
 * Usage examples:
 * import { calendarTimelineLoader, useCalendarEventLoader } from '$lib/loaders';
 * import { calendarTimelineLoader } from '$lib/loaders/calendar';
 */

// Base loaders (EventStore bootstrap)
export { addressLoader, eventLoader, userDeletionLoader, timedPool } from './base.js';

// Calendar loaders
export {
  calendarTimelineLoader,
  calendarLoader,
  userCalendarLoader,
  createRelayFilteredCalendarLoader,
  communityCalendarTimelineLoader
} from './calendar.js';

// Community loaders
export { communikeyTimelineLoader } from './community.js';

// Profile utilities
export { profileLoader, loadUserProfile, kind1Loader } from './profile.js';

// Article loaders
export { articleTimelineLoader } from './articles.js';
export { ambTimelineLoader } from './amb.js';

// Targeted publications loaders
export {
  allTargetedPublicationsLoader,
  articleTargetedPublicationsLoader,
  communityTargetedPublicationsLoader
} from './targeted-publications.js';

// Calendar event loader composable and URL sync helpers
export {
  useCalendarEventLoader,
  createUrlSyncHandler,
  syncInitialUrlState
} from './calendar-event-loader.svelte';

// Comments loader
export { createCommentLoaderForEvent } from './comments.js';

// Reactions loader
export { reactionsLoader } from './reactions.js';

// RSVP loader
export { calendarEventRsvpLoader } from './rsvp.js';
