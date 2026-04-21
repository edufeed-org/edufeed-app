/**
 * Social bookmarks loader for kinds 39701 (bookmark), 9802 (highlight), 1111 (page note).
 */
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/** Hook: Load social bookmarks for a specific community */
export const useSocialBookmarksCommunityLoader = createCommunityContentLoader(
  [39701, 9802, 1111],
  getAllLookupRelays
);
