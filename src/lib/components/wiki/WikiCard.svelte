<!--
  WikiCard Component
  Displays wiki article preview in card format for community grid views
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import EventDebugPanel from '../shared/EventDebugPanel.svelte';
  import { encodeEventToNaddr, profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {Object} Props
   * @property {any} wiki - Wiki event (kind 30818)
   * @property {any} [authorProfile] - Author's profile
   * @property {boolean} [compact=false] - Compact display mode
   * @property {string} [communityNpub] - Community npub for route construction
   */

  /** @type {Props} */
  let { wiki, authorProfile = null, compact = false, communityNpub = undefined } = $props();

  const title = $derived.by(() => {
    const titleTag = wiki.tags?.find((/** @type {any} */ t) => t[0] === 'title');
    const dTag = wiki.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return titleTag?.[1] || dTag?.[1] || 'Untitled Wiki';
  });

  const topic = $derived.by(() => {
    const dTag = wiki.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return dTag?.[1] || '';
  });

  const summary = $derived.by(() => {
    const summaryTag = wiki.tags?.find((/** @type {any} */ t) => t[0] === 'summary');
    if (summaryTag?.[1]) return summaryTag[1];

    if (wiki.content) {
      const plainText = wiki.content.replace(/[#*`[\]]/g, '').trim();
      return plainText.length > 200 ? plainText.slice(0, 200) + '...' : plainText;
    }
    return '';
  });

  const publishedAt = $derived(new Date(wiki.created_at * 1000));

  const hashtags = $derived.by(() => {
    return (
      wiki.tags
        ?.filter((/** @type {any} */ t) => t[0] === 't')
        .map((/** @type {any} */ t) => t[1]) || []
    );
  });

  const authorName = $derived(getDisplayName(authorProfile, wiki.pubkey.slice(0, 8) + '...'));
  const wikiNaddr = $derived.by(() => {
    const naddr = encodeEventToNaddr(wiki);
    return naddr || null;
  });

  /**
   * Build the resolved route for this wiki.
   * @returns {string | null}
   */
  function getWikiHref() {
    if (!wikiNaddr) return null;
    if (communityNpub) return resolve(`/c/${communityNpub}/wiki/${wikiNaddr}`);
    return resolve(`/${wikiNaddr}`);
  }

  /**
   * @param {MouseEvent} e
   */
  function handleClick(e) {
    const href = getWikiHref();
    if (href && e.target instanceof HTMLElement && !e.target.closest('button, a')) {
      goto(href);
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    const href = getWikiHref();
    if ((e.key === 'Enter' || e.key === ' ') && href) {
      e.preventDefault();
      goto(href);
    }
  }
</script>

<div
  class="wiki-card focus:ring-opacity-50 cursor-pointer rounded-lg border border-base-300 bg-base-100 shadow-sm transition-shadow hover:border-primary hover:shadow-md focus:ring-2 focus:ring-primary focus:outline-none {compact
    ? 'p-3'
    : 'p-4'}"
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <!-- Author Header -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="mb-3 flex items-center gap-3" onclick={(e) => e.stopPropagation()}>
    <ProfileAvatar pubkey={wiki.pubkey} profile={authorProfile} size="md" linkToProfile />
    <div class="min-w-0 flex-1">
      <a
        href={resolve(profileLink(wiki.pubkey))}
        class="truncate font-medium text-base-content hover:underline">{authorName}</a
      >
      <div class="text-sm text-base-content/60">
        {formatCalendarDate(publishedAt, 'short')}
      </div>
    </div>
  </div>

  <!-- Wiki Content -->
  <div class="space-y-2">
    <!-- Title -->
    <h2 class="line-clamp-2 text-xl font-bold text-base-content {compact ? 'text-lg' : ''}">
      {title}
    </h2>

    <!-- Topic Badge -->
    {#if topic && !compact}
      <div>
        <span class="badge badge-sm badge-secondary">{topic}</span>
      </div>
    {/if}

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

    <!-- Read More -->
    {#if getWikiHref()}
      <div class="pt-2">
        <a href={getWikiHref()} class="btn btn-sm btn-primary" onclick={(e) => e.stopPropagation()}>
          {m.wiki_card_read()}
        </a>
      </div>
    {/if}

    <!-- Reactions -->
    {#if !compact}
      <div class="pt-2">
        <ReactionBar event={wiki} />
      </div>
    {/if}

    <!-- Debug Panel -->
    {#if !compact}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div onclick={(e) => e.stopPropagation()}>
        <EventDebugPanel event={wiki} />
      </div>
    {/if}
  </div>
</div>

<style>
  .wiki-card {
    display: flex;
    flex-direction: column;
  }
</style>
