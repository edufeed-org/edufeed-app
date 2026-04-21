/**
 * Community activity loader — loads all content kinds for the home feed.
 * Uses the shared createCommunityContentLoader factory.
 */
import { createCommunityContentLoader } from './community-content-loader.js';
import {
  getEducationalRelays,
  getCalendarRelays,
  getArticleRelays,
  getCommunikeyRelays,
  getKanbanRelays
} from '$lib/helpers/relay-helper.js';

function getAllContentRelays() {
  return [
    ...new Set([
      ...getEducationalRelays(),
      ...getCalendarRelays(),
      ...getArticleRelays(),
      ...getCommunikeyRelays(),
      ...getKanbanRelays()
    ])
  ];
}

export const useCommunityActivityLoader = createCommunityContentLoader(
  [30142, 30301, 30023, 30818, 31922, 31923, 11],
  getAllContentRelays
);
