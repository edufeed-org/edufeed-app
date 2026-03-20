<!--
  LearningView Component
  Displays educational resources (AMB/kind:30142) shared with a community
-->

<script>
  import { useAMBCommunityLoader } from '$lib/loaders/amb.js';
  import { CommunityAMBResourceModel } from '$lib/models/community-content.js';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();
</script>

<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={useAMBCommunityLoader}
  model={CommunityAMBResourceModel}
  loadingText={m.community_learning_loading()}
  emptyTitle={m.community_learning_empty_title()}
  emptyDescription={m.community_learning_empty_description()}
  formatCount={(count) => m.community_learning_count({ count })}
  emptyIconPath="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"
>
  {#snippet content(items, authorProfiles)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each items as resource (resource.id)}
        <AMBResourceCard
          {resource}
          authorProfile={authorProfiles.get(resource.pubkey) || null}
          compact={false}
        />
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
