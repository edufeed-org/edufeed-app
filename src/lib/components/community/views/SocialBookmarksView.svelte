<!--
  SocialBookmarksView — Community tab for web bookmarks, highlights, and page notes.
  Thin wrapper around CommunityContentView with client-side URL grouping.
-->

<script>
  import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
  import { CommunitySocialBookmarkModel } from '$lib/models/community-content.js';
  import { filterSocialBookmarks, groupByUrl } from '$lib/helpers/urlGrouping.js';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
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
  countTransform={(items) => groupByUrl(filterSocialBookmarks(items)).length}
  emptyIconPath="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
>
  {#snippet content(items, authorProfiles)}
    {@const filtered = filterSocialBookmarks(items)}
    {@const urlGroups = groupByUrl(filtered)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each urlGroups as group (group.url)}
        <UrlCard {group} {authorProfiles} {communityPubkey} />
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
