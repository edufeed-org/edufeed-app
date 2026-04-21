/**
 * Thread loading utilities for kind 11 forum threads.
 * No curated filter — community threads are already scoped by #h tag.
 */
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/** Hook: Load threads for a specific community */
export const useThreadCommunityLoader = createCommunityContentLoader([11], getCommunikeyRelays);
