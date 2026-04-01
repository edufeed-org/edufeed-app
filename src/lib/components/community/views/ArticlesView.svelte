<!--
  ArticlesView Component
  Displays long-form articles (kind 30023) shared with a community
-->

<script>
  import { page } from '$app/stores';
  import { useArticleCommunityLoader } from '$lib/loaders/articles.js';
  import { CommunityArticleModel } from '$lib/models/community-content.js';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import { RepostIcon } from '$lib/components/icons';
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
  loaderHook={useArticleCommunityLoader}
  model={CommunityArticleModel}
  loadingText={m.community_articles_loading()}
  emptyTitle={m.community_articles_empty_title()}
  emptyDescription={m.community_articles_empty_description()}
  formatCount={(count) => m.community_articles_count({ count })}
  searchable
  searchPlaceholder={m.community_articles_search_placeholder()}
  emptyIconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
>
  {#snippet headerAction()}
    {#if manager.active}
      <button
        class="btn gap-1 btn-ghost btn-sm"
        onclick={() =>
          modalStore.openModal('shareByNaddr', { communityPubkey, allowedKinds: [30023] })}
      >
        <RepostIcon class_="h-4 w-4" />
        Add existing
      </button>
    {/if}
  {/snippet}

  {#snippet content(items, authorProfiles)}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each items as article (article.id)}
        <ArticleCard
          {article}
          authorProfile={authorProfiles.get(article.pubkey) || null}
          compact={false}
          {communityNpub}
        />
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
