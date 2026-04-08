<!--
  DetailHeader Component
  Unified compact toolbar for all detail page types.
  Renders back button, title/subtitle, author strip, and context menu.
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { getHasHistory } from '$lib/helpers/navigationHistory.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import EventContextMenu from './EventContextMenu.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} title - Main title text
   * @property {string} [subtitle] - Optional subtitle
   * @property {import('nostr-tools').NostrEvent} event - For context menu
   * @property {string} authorPubkey - For avatar + name in author strip
   * @property {string} [date] - Formatted date string
   * @property {string} [dateLabel] - Prefix before date (e.g. "Published")
   * @property {string} [stats] - e.g. "2 bookmarks, 1 highlight"
   * @property {boolean} [showAuthorStrip] - Show author strip (default true)
   * @property {(() => void) | undefined} [onEdit] - Passed to EventContextMenu
   * @property {(() => void | Promise<void>) | undefined} [onDelete] - Passed to EventContextMenu
   * @property {string} [deleteTitle] - For DeleteConfirmModal title
   * @property {string} [deleteItemName] - For DeleteConfirmModal item name
   * @property {import('svelte').Snippet} [actions] - Optional type-specific controls
   * @property {import('svelte').Snippet} [titleContent] - Override default title rendering
   */

  /** @type {Props} */
  let {
    title,
    subtitle = undefined,
    event,
    authorPubkey,
    date = undefined,
    dateLabel = undefined,
    stats = undefined,
    showAuthorStrip = true,
    onEdit = undefined,
    onDelete = undefined,
    deleteTitle = '',
    deleteItemName = '',
    actions = undefined,
    titleContent = undefined
  } = $props();

  // Load author profile for the author strip (skip if no pubkey or strip hidden)
  const getAuthorProfile = useUserProfile(() =>
    showAuthorStrip && authorPubkey ? authorPubkey : undefined
  );
  const authorProfile = $derived(getAuthorProfile());
  const authorName = $derived(
    authorPubkey ? getDisplayName(authorProfile ?? undefined, authorPubkey.slice(0, 8) + '...') : ''
  );
</script>

<div class="mb-4">
  <!-- Top row: back + title + actions + context menu -->
  <div class="flex items-center gap-2">
    <button
      onclick={() => {
        if (getHasHistory()) history.back();
      }}
      class="btn btn-circle flex-shrink-0 btn-ghost btn-sm"
      aria-label={m.common_back()}
    >
      <ChevronLeftIcon class_="w-5 h-5" />
    </button>

    <div class="min-w-0 flex-1">
      {#if titleContent}
        {@render titleContent()}
      {:else}
        <h1 class="truncate text-xl font-bold">{title}</h1>
        {#if subtitle}
          <p class="truncate text-xs opacity-50">{subtitle}</p>
        {/if}
      {/if}
    </div>

    {#if actions}
      {@render actions()}
    {/if}

    <EventContextMenu {event} {onEdit} {onDelete} {deleteTitle} {deleteItemName} />
  </div>

  <!-- Author strip -->
  {#if showAuthorStrip}
    <div class="mt-2 flex items-center gap-2 border-b border-base-300 pb-2 pl-10">
      <ProfileAvatar pubkey={authorPubkey} size="xs" linkToProfile />
      <span class="text-xs">
        <a href={resolve(`/p/${authorPubkey}`)} class="font-medium hover:underline">
          {authorName}
        </a>
        {#if date}
          <span class="opacity-50">
            {#if dateLabel}
              &middot; {dateLabel} {date}
            {:else}
              &middot; {date}
            {/if}
          </span>
        {/if}
        {#if stats}
          <span class="opacity-50">&middot; {stats}</span>
        {/if}
      </span>
    </div>
  {/if}
</div>
