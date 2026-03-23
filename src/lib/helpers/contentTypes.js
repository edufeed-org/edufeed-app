/**
 * Content type configuration for community features
 * Maps event kinds to UI metadata and implementation status
 */
import { parseCommunityContentTypes } from './communityRelays.js';

/**
 * @typedef {Object} ContentTypeConfig
 * @property {number} kind - Nostr event kind number
 * @property {string} name - Display name
 * @property {string} icon - SVG icon path
 * @property {boolean} supported - Whether we have a component implementation
 * @property {string|null} component - Component name/path (if supported)
 * @property {string} description - Description for tooltips
 */

/** @type {Record<number, ContentTypeConfig>} */
export const CONTENT_TYPE_CONFIG = {
  9: {
    kind: 9,
    name: 'Chat',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    supported: true,
    component: 'Chat',
    description: 'Real-time community chat'
  },
  30142: {
    kind: 30142,
    name: 'Learning',
    icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222',
    supported: true,
    component: 'LearningView',
    description: 'Educational resources (AMB/OER)'
  },
  31922: {
    kind: 31922,
    name: 'Date-based Calendar Events',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    supported: true,
    component: 'CalendarView',
    description: 'All-day and multi-day calendar events (NIP-52)'
  },
  31923: {
    kind: 31923,
    name: 'Calendar',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    supported: true,
    component: 'CalendarView',
    description: 'Community events and calendar'
  },
  31924: {
    kind: 31924,
    name: 'Calendar Collection',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    supported: true,
    component: 'CalendarView',
    description: 'Calendar collections (NIP-52)'
  },
  31925: {
    kind: 31925,
    name: 'Calendar RSVP',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    supported: true,
    component: 'CalendarView',
    description: 'Calendar event RSVPs (NIP-52)'
  },
  30301: {
    kind: 30301,
    name: 'Boards',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    supported: true,
    component: 'BoardsView',
    description: 'Kanban boards for project management'
  },
  1: {
    kind: 1,
    name: 'Posts',
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    supported: false,
    component: null,
    description: 'Short text posts'
  },
  30023: {
    kind: 30023,
    name: 'Articles',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    supported: true,
    component: 'ArticlesView',
    description: 'Long-form articles'
  },
  30040: {
    kind: 30040,
    name: 'Publications',
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    supported: false,
    component: null,
    description: 'Curated publications (books, journals, courses)'
  },
  30818: {
    kind: 30818,
    name: 'Wikis',
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    supported: true,
    component: 'WikisView',
    description: 'Collaborative wiki articles (NIP-54)'
  },
  39701: {
    kind: 39701,
    name: 'Social Bookmarks',
    icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
    supported: true,
    component: 'SocialBookmarksView',
    description: 'Web bookmarks, highlights, and page notes'
  },
  9802: {
    kind: 9802,
    name: 'Social Bookmarks',
    icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
    supported: true,
    component: 'SocialBookmarksView',
    description: 'Web highlights'
  },
  11: {
    kind: 11,
    name: 'Forum',
    icon: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z',
    supported: true,
    component: 'ForumView',
    description: 'Forum discussions'
  }
};

/**
 * Get content types for a community, including always-available types
 * @param {Object} communikeyEvent - The community's kind:10222 event
 * @returns {Array<{kind: number, name: string, icon: string, supported: boolean, enabled: boolean, description: string, exclusive?: boolean, fee?: Object, roles?: string[]}>}
 */
export function getCommunityAvailableContentTypes(communikeyEvent) {
  // NIP-52 calendar kinds that should enable calendar functionality
  const CALENDAR_KINDS = [31922, 31923, 31924, 31925];

  // Always include Chat as a core feature
  const alwaysAvailable = [9];
  const result = [];
  const processedKinds = new Set();

  // Parse community's defined content types
  const definedContentTypes = parseCommunityContentTypes(communikeyEvent);

  // Check if community has any calendar-related kinds
  let hasCalendarKinds = false;
  for (const contentType of definedContentTypes) {
    if (contentType.kinds.some((kind) => CALENDAR_KINDS.includes(kind))) {
      hasCalendarKinds = true;
      break;
    }
  }

  // Process defined content types from the community
  for (const contentType of definedContentTypes) {
    for (const kind of contentType.kinds) {
      // Skip if already processed (prevent duplicates)
      if (processedKinds.has(kind)) continue;

      // Skip calendar kinds - they'll be represented by a single Calendar tab
      if (CALENDAR_KINDS.includes(kind)) {
        processedKinds.add(kind);
        continue;
      }

      // Mark as processed before adding to result
      processedKinds.add(kind);

      const config = CONTENT_TYPE_CONFIG[kind];
      if (config) {
        result.push({
          kind,
          name: config.name,
          icon: config.icon,
          supported: config.supported,
          enabled: config.supported,
          description: config.description,
          exclusive: contentType.exclusive,
          fee: contentType.fee,
          roles: contentType.roles,
          communityName: contentType.name
        });
      } else {
        // Unknown content type - use generic name to avoid duplicates
        result.push({
          kind,
          name: `Kind ${kind}`,
          icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', // Info icon
          supported: false,
          enabled: false,
          description: `Content type (kind ${kind}) is not yet supported`,
          exclusive: contentType.exclusive,
          fee: contentType.fee,
          roles: contentType.roles,
          communityName: contentType.name
        });
      }
    }
  }

  // Add always-available types if not already present
  for (const kind of alwaysAvailable) {
    if (!processedKinds.has(kind)) {
      processedKinds.add(kind);
      const config = CONTENT_TYPE_CONFIG[kind];
      result.push({
        kind,
        name: config.name,
        icon: config.icon,
        supported: config.supported,
        enabled: config.supported,
        description: config.description
      });
    }
  }

  // Add consolidated calendar tab if any calendar kinds are present
  if (hasCalendarKinds) {
    const config = CONTENT_TYPE_CONFIG[31923];
    result.push({
      kind: 31923,
      name: config.name,
      icon: config.icon,
      supported: config.supported,
      enabled: config.supported,
      description: config.description
    });
  }

  // Sort: enabled first, then by kind number
  return result.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.kind - b.kind;
  });
}

/**
 * Map content kind number to navigation content type string
 * @param {number} kind - The content type kind number
 * @returns {string|null} - The content type string for navigation, or null if not mapped
 */
export function kindToContentType(kind) {
  /** @type {Record<number, string>} */
  const mapping = {
    9: 'chat',
    11: 'forum',
    9802: 'social-bookmarks',
    30023: 'articles',
    30142: 'learning',
    30301: 'boards',
    30818: 'wikis',
    31923: 'calendar',
    31922: 'calendar',
    31924: 'calendar',
    31925: 'calendar',
    39701: 'social-bookmarks'
  };
  return mapping[kind] || null;
}

/**
 * Get the default set of community navigation tabs.
 * Includes structural tabs (home, chat) plus all supported content types, plus activity/settings.
 * @returns {string[]} Tab IDs in display order
 */
export function getDefaultCommunityTabs() {
  const tabs = ['home', 'chat'];

  const seen = new Set(tabs);
  for (const config of Object.values(CONTENT_TYPE_CONFIG)) {
    if (!config.supported) continue;
    const tabId = kindToContentType(config.kind);
    if (tabId && !seen.has(tabId)) {
      seen.add(tabId);
      tabs.push(tabId);
    }
  }

  tabs.push('settings');
  return tabs;
}
