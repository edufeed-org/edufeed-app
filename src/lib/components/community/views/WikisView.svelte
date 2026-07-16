<!--
  WikisView Component
  Displays wiki articles (kind 30818 / NIP-54) shared with a community
-->

<script>
  import { page } from '$app/stores';
  import { useWikiCommunityLoader } from '$lib/loaders/wiki.js';
  import { CommunityWikiModel } from '$lib/models/community-content.js';
  import WikiCard from '$lib/components/wiki/WikiCard.svelte';
  import SharedByLine from '$lib/components/shared/SharedByLine.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import { RepostIcon, WikipediaIcon } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();

  const communityNpub = $derived($page.data.npub);
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
  searchable
  searchPlaceholder={m.community_wikis_search_placeholder()}
>
  {#snippet emptyIcon()}
    <WikipediaIcon class_="h-10 w-10" />
  {/snippet}

  {#snippet headerAction()}
    {#if manager.active}
      <button
        class="btn gap-1 btn-ghost btn-sm"
        onclick={() =>
          modalStore.openModal('shareByNaddr', { communityPubkey, allowedKinds: [30818] })}
      >
        <RepostIcon class_="h-4 w-4" />
        {m.community_add_existing()}
      </button>
    {/if}
  {/snippet}

  {#snippet content(items, authorProfiles)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each items as wiki (wiki.id)}
        <div>
          {#if wiki._sharedBy}
            <SharedByLine sharers={wiki._allSharers || [wiki._sharedBy]} {authorProfiles} />
          {/if}
          <WikiCard
            {wiki}
            authorProfile={authorProfiles.get(wiki.pubkey) || null}
            {communityNpub}
          />
        </div>
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
