<!--
  WikisView Component
  Displays wiki articles (kind 30818 / NIP-54) shared with a community
-->

<script>
  import { useWikiCommunityLoader } from '$lib/loaders/wiki.js';
  import { CommunityWikiModel } from '$lib/models/community-content.js';
  import WikiCard from '$lib/components/wiki/WikiCard.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();
</script>

<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={useWikiCommunityLoader}
  model={CommunityWikiModel}
  loadingText={m.community_wikis_loading()}
  emptyTitle={m.community_wikis_empty_title()}
  emptyDescription={m.community_wikis_empty_description()}
  formatCount={(count) => m.community_wikis_count({ count })}
  emptyIconPath="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
>
  {#snippet content(items, authorProfiles)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each items as wiki (wiki.id)}
        <WikiCard {wiki} authorProfile={authorProfiles.get(wiki.pubkey) || null} />
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
