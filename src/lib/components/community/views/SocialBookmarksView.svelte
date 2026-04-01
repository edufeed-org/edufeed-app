<!--
  SocialBookmarksView — Community tab for web bookmarks, highlights, and page notes.
  Thin wrapper around CommunityContentView with client-side URL grouping.
-->

<script>
  import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
  import { CommunitySocialBookmarkModel } from '$lib/models/community-content.js';
  import { filterSocialBookmarks, groupByUrl, groupByEventRef } from '$lib/helpers/urlGrouping.js';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import EventHighlightCard from '$lib/components/bookmarks/EventHighlightCard.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();
</script>

<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={useSocialBookmarksCommunityLoader}
  model={CommunitySocialBookmarkModel}
  loadingText={m.community_social_bookmarks_loading()}
  emptyTitle={m.community_social_bookmarks_empty_title()}
  emptyDescription={m.community_social_bookmarks_empty_description()}
  formatCount={(count) => m.community_social_bookmarks_count({ count })}
  searchable
  searchPlaceholder={m.community_bookmarks_search_placeholder()}
  countTransform={(items) =>
    groupByUrl(filterSocialBookmarks(items)).length + groupByEventRef(items).length}
  emptyIconPath="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
>
  {#snippet content(items, authorProfiles)}
    {@const urlGroups = groupByUrl(filterSocialBookmarks(items))}
    {@const eventRefGroups = groupByEventRef(items)}
    {@const urlMap = new Map(urlGroups.map((g) => [g.url, g]))}
    {@const refMap = new Map(eventRefGroups.map((g) => [g.aTagValue, g]))}
    {@const sortedKeys = [
      ...urlGroups.map((g) => ({ type: 'url', key: g.url, ts: g.latestActivity })),
      ...eventRefGroups.map((g) => ({ type: 'ref', key: g.aTagValue, ts: g.latestActivity }))
    ].toSorted((a, b) => b.ts - a.ts)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each sortedKeys as item (item.key)}
        {#if item.type === 'url'}
          {@const group = urlMap.get(item.key)}
          <UrlCard {group} {authorProfiles} {communityPubkey} />
        {:else}
          {@const group = refMap.get(item.key)}
          <EventHighlightCard {group} {authorProfiles} {communityPubkey} />
        {/if}
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
