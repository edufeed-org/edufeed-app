<!--
  ArticleCard Component
  Displays article preview in card format for feed views
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { getArticleTitle, getArticleImage } from 'applesauce-common/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import EventDebugPanel from '../shared/EventDebugPanel.svelte';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {Object} Props
   * @property {any} article - Article event (kind 30023)
   * @property {any} [authorProfile] - Author's profile
   * @property {boolean} [compact=false] - Compact display mode
   * @property {'card'|'list'} [variant='card'] - Display variant
   * @property {string} [communityNpub] - Community npub for route construction
   */

  /** @type {Props} */
  let {
    article,
    authorProfile = null,
    compact = false,
    variant = 'card',
    communityNpub = undefined
  } = $props();

  const isList = $derived(variant === 'list');

  // Extract article metadata using applesauce helpers
  const title = $derived(getArticleTitle(article) || 'Untitled Article');
  const image = $derived(getArticleImage(article));

  // Get summary from tags or truncate content
  const summary = $derived.by(() => {
    const summaryTag = article.tags?.find((/** @type {any} */ t) => t[0] === 'summary');
    if (summaryTag?.[1]) return summaryTag[1];

    // Fallback to truncated content
    if (article.content) {
      const plainText = article.content.replace(/[#*`[\]]/g, '').trim();
      return plainText.length > 200 ? plainText.slice(0, 200) + '...' : plainText;
    }
    return '';
  });

  // Get published date
  const publishedAt = $derived.by(() => {
    const publishedTag = article.tags?.find((/** @type {any} */ t) => t[0] === 'published_at');
    if (publishedTag?.[1]) {
      return new Date(parseInt(publishedTag[1]) * 1000);
    }
    return new Date(article.created_at * 1000);
  });

  // Get hashtags
  const hashtags = $derived.by(() => {
    return (
      article.tags
        ?.filter((/** @type {any} */ t) => t[0] === 't')
        .map((/** @type {any} */ t) => t[1]) || []
    );
  });

  // Get author info
  const authorName = $derived(getDisplayName(authorProfile, article.pubkey.slice(0, 8) + '...'));
  const authorAvatar = $derived(
    getProfilePicture(authorProfile) || `https://robohash.org/${article.pubkey}`
  );

  // Generate naddr for the article (includes relay hints for discoverability)
  const articleNaddr = $derived.by(() => {
    const naddr = encodeEventToNaddr(article);
    return naddr || null;
  });

  /**
   * Build the resolved route for this article.
   * @returns {string | null}
   */
  function getArticleHref() {
    if (!articleNaddr) return null;
    if (communityNpub) return resolve(`/c/${communityNpub}/article/${articleNaddr}`);
    return resolve(`/${articleNaddr}`);
  }

  /**
   * Handle card click
   * @param {MouseEvent} e
   */
  function handleClick(e) {
    const href = getArticleHref();
    if (href && e.target instanceof HTMLElement && !e.target.closest('button, a')) {
      goto(href);
    }
  }

  /**
   * Handle keyboard navigation
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    const href = getArticleHref();
    if ((e.key === 'Enter' || e.key === ' ') && href) {
      e.preventDefault();
      goto(href);
    }
  }
</script>

{#if isList}
  <!-- List variant: horizontal row -->
  <div
    class="article-card-list focus:ring-opacity-50 flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 transition-shadow hover:border-primary hover:shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleKeydown}
  >
    <div
      class="list-thumbnail h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-base-200 sm:h-20 sm:w-20"
    >
      {#if image}
        <ImageWithFallback
          src={image}
          alt={title}
          fallbackType="article"
          size="thumbnail"
          class="h-full w-full object-cover"
        />
      {:else}
        <div class="flex h-full w-full items-center justify-center text-2xl text-base-content/30">
          📄
        </div>
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate font-semibold text-base-content">{title}</div>
      <div class="truncate text-sm text-base-content/60">
        {authorName} · {formatCalendarDate(publishedAt, 'short')}
      </div>
      {#if summary}
        <div class="hidden text-sm text-base-content/50 sm:line-clamp-2 sm:block">{summary}</div>
      {/if}
      {#if hashtags.length > 0}
        <div class="mt-1 flex flex-wrap gap-1">
          {#each hashtags.slice(0, 4) as tag (tag)}
            <span class="badge badge-outline badge-xs">#{tag}</span>
          {/each}
          {#if hashtags.length > 4}
            <span class="badge badge-ghost badge-xs">+{hashtags.length - 4}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- Card variant: vertical layout -->
  <div
    class="article-card focus:ring-opacity-50 cursor-pointer rounded-lg border border-base-300 bg-base-100 shadow-sm transition-shadow hover:border-primary hover:shadow-md focus:ring-2 focus:ring-primary focus:outline-none {compact
      ? 'p-3'
      : 'p-4'}"
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleKeydown}
  >
    <!-- Author Header -->
    <div class="mb-3 flex items-center gap-3">
      <div class="avatar">
        <div class="h-10 w-10 rounded-full">
          <img src={authorAvatar} alt={authorName} loading="lazy" decoding="async" />
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium text-base-content">{authorName}</div>
        <div class="text-sm text-base-content/60">
          {formatCalendarDate(publishedAt, 'short')}
        </div>
      </div>
    </div>

    <!-- Article Image -->
    {#if image && !compact}
      <div class="mb-3">
        <div class="aspect-[2/1] w-full overflow-hidden rounded-lg">
          <ImageWithFallback
            src={image}
            alt={title}
            fallbackType="article"
            size="card"
            class="h-full w-full object-cover"
          />
        </div>
      </div>
    {/if}

    <!-- Article Content -->
    <div class="space-y-2">
      <!-- Title -->
      <h2 class="line-clamp-2 text-xl font-bold text-base-content {compact ? 'text-lg' : ''}">
        {title}
      </h2>

      <!-- Summary -->
      {#if summary && !compact}
        <p class="line-clamp-3 text-sm text-base-content/70">
          {summary}
        </p>
      {/if}

      <!-- Tags -->
      {#if hashtags.length > 0 && !compact}
        <div class="flex flex-wrap gap-1">
          <EventTags tags={hashtags} size="sm" targetRoute="/discover" />
        </div>
      {/if}

      <!-- Read More Button -->
      {#if getArticleHref()}
        <div class="pt-2">
          <a
            href={getArticleHref()}
            class="btn btn-sm btn-primary"
            onclick={(e) => e.stopPropagation()}
          >
            {m.article_card_read_article()}
          </a>
        </div>
      {/if}

      <!-- Reactions -->
      {#if !compact}
        <div class="pt-2">
          <ReactionBar event={article} />
        </div>
      {/if}

      <!-- Debug Panel -->
      {#if !compact}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div onclick={(e) => e.stopPropagation()}>
          <EventDebugPanel event={article} />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .article-card {
    display: flex;
    flex-direction: column;
  }
</style>
