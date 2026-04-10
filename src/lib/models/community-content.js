/**
 * Generic Community Content Model Factory
 *
 * Creates models that combine direct community content (h-tagged events) with
 * content referenced by targeted publications (kind 30222) and NIP-18 reposts (kind 6/16).
 *
 * This model ONLY reads from EventStore — it does NOT fetch data.
 * The loader must populate EventStore with the relevant events.
 */
import { combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { TimelineModel } from 'applesauce-core/models';
import { getTagValue } from 'applesauce-core/helpers';
import { formatAMBResource } from '$lib/helpers/educational/index.js';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
import { parseRoomEvent } from '$lib/helpers/meet.js';

/**
 * Create a community content model for specific event kinds.
 *
 * @param {number[]} contentKinds - Event kinds for this content type
 * @param {Object} [options]
 * @param {(event: any) => any} [options.transform] - Optional transform per event
 * @returns {(communityPubkey: string) => (eventStore: any) => import('rxjs').Observable<any[]>}
 */
export function createCommunityContentModel(contentKinds, options = {}) {
  const kTagStrings = contentKinds.map(String);
  const { transform } = options;

  return function (communityPubkey) {
    return (eventStore) => {
      // Stream 1: Direct community content (h-tag)
      const direct$ = eventStore.model(TimelineModel, {
        kinds: contentKinds,
        '#h': [communityPubkey],
        limit: 100
      });

      // Stream 2: Legacy targeted publications (kind 30222)
      const shares$ = eventStore.model(TimelineModel, {
        kinds: [30222],
        '#p': [communityPubkey],
        '#k': kTagStrings,
        limit: 100
      });

      // Stream 3: NIP-18 reposts (kind 6/16 with h-tag targeting this community)
      const reposts$ = eventStore.model(TimelineModel, {
        kinds: [6, 16],
        '#h': [communityPubkey],
        limit: 100
      });

      // Stream 4: All events of this kind (for resolving references)
      const all$ = eventStore.model(TimelineModel, {
        kinds: contentKinds,
        limit: 500
      });

      return combineLatest(/** @type {any[]} */ ([direct$, shares$, reposts$, all$])).pipe(
        map((/** @type {any[]} */ [directEvents, shareEvents, repostEvents, allEvents]) => {
          // Build lookup map by ID and address
          const lookup = new Map();
          for (const event of allEvents || []) {
            lookup.set(event.id, event);
            const dTag = getTagValue(event, 'd');
            if (dTag) {
              lookup.set(`${event.kind}:${event.pubkey}:${dTag}`, event);
            }
          }

          const resultMap = new Map();
          const fmt = transform || ((e) => e);

          /** Append a sharer pubkey to an item's _allSharers (deduplicating)
           * @param {any} item @param {string} pubkey */
          function addSharer(item, pubkey) {
            if (!item._allSharers) item._allSharers = [];
            if (!item._allSharers.includes(pubkey)) item._allSharers.push(pubkey);
          }

          // Add direct events first (highest priority)
          for (const event of directEvents) {
            resultMap.set(event.id, fmt(event));
          }

          // Resolve legacy targeted publication references
          for (const share of shareEvents || []) {
            const eTag = getTagValue(share, 'e');
            const aTag = getTagValue(share, 'a');
            const resolved = (eTag && lookup.get(eTag)) || (aTag && lookup.get(aTag));
            if (!resolved) continue;
            const existing = resultMap.get(resolved.id);
            if (existing) {
              addSharer(existing, share.pubkey);
            } else {
              const item = {
                ...fmt(resolved),
                _sharedBy: share.pubkey,
                _allSharers: [share.pubkey]
              };
              resultMap.set(resolved.id, item);
            }
          }

          // Resolve NIP-18 repost references (lowest priority)
          for (const repost of repostEvents || []) {
            const eTag = getTagValue(repost, 'e');
            const aTag = getTagValue(repost, 'a');
            const resolved = (eTag && lookup.get(eTag)) || (aTag && lookup.get(aTag));
            if (!resolved) continue;
            const existing = resultMap.get(resolved.id);
            if (existing) {
              addSharer(existing, repost.pubkey);
            } else {
              const item = {
                ...fmt(resolved),
                _sharedBy: repost.pubkey,
                _allSharers: [repost.pubkey]
              };
              resultMap.set(resolved.id, item);
            }
          }

          return Array.from(resultMap.values());
        })
      );
    };
  };
}

/** Community board model for kind 30301 kanban boards */
export const CommunityBoardModel = createCommunityContentModel([30301]);

/** Community AMB resource model for kind 30142 educational content */
export const CommunityAMBResourceModel = createCommunityContentModel([30142], {
  transform: formatAMBResource
});

/** Community calendar event model for kinds 31922/31923 */
export const CommunityCalendarEventModel = createCommunityContentModel([31922, 31923], {
  transform: getCalendarEventMetadata
});

/** Community article model for kind 30023 long-form content */
export const CommunityArticleModel = createCommunityContentModel([30023]);

/** Community thread model for kind 11 forum threads */
export const CommunityThreadModel = createCommunityContentModel([11]);

/** Community wiki model for kind 30818 wiki articles (NIP-54) */
export const CommunityWikiModel = createCommunityContentModel([30818]);

/** Community social bookmark model for kinds 39701/9802/1111 */
export const CommunitySocialBookmarkModel = createCommunityContentModel([39701, 9802, 1111]);

/** Community room model for kind 30312/30313 meet rooms */
export const CommunityRoomModel = createCommunityContentModel([30312, 30313], {
  transform: parseRoomEvent
});

/** Community activity model — all content kinds for the home feed */
export const CommunityActivityModel = createCommunityContentModel([
  30142, 30301, 30023, 30818, 31922, 31923, 11
]);
