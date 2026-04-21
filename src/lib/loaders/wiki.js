/**
 * Wiki loading utilities for kind 30818 wiki articles (NIP-54).
 */
import { createCommunityContentLoader } from './community-content-loader.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

/** Hook: Load wikis for a specific community */
export const useWikiCommunityLoader = createCommunityContentLoader([30818], getCommunikeyRelays);
