<!--
  DetailHeader Component
  Unified compact toolbar for all detail page types.
  Toolbar row: back button, author info, metadata, actions, context menu.
  Title/subtitle render below the toolbar border at full width.
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { getHasHistory, getFallbackRoute } from '$lib/helpers/navigationHistory.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import EventContextMenu from './EventContextMenu.svelte';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {Object} Props
   * @property {string} title - Main title text
   * @property {string} [subtitle] - Optional subtitle
   * @property {import('nostr-tools').NostrEvent} event - For context menu
   * @property {string} authorPubkey - For avatar + name in toolbar
   * @property {string} [date] - Formatted date string
   * @property {string} [dateLabel] - Prefix before date (e.g. "Published")
   * @property {string} [stats] - e.g. "2 bookmarks, 1 highlight"
   * @property {(() => void) | undefined} [onEdit] - Passed to EventContextMenu
   * @property {(() => void | Promise<void>) | undefined} [onDelete] - Passed to EventContextMenu
   * @property {string} [deleteTitle] - For DeleteConfirmModal title
   * @property {string} [deleteItemName] - For DeleteConfirmModal item name
   * @property {import('svelte').Snippet} [actions] - Optional type-specific controls
   * @property {import('svelte').Snippet} [titleContent] - Override default title rendering
   * @property {import('svelte').Snippet} [metadata] - Optional metadata in toolbar (e.g. tags)
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
    onEdit = undefined,
    onDelete = undefined,
    deleteTitle = '',
    deleteItemName = '',
    actions = undefined,
    titleContent = undefined,
    metadata = undefined
  } = $props();

  // Load author profile for the toolbar (skip if no pubkey)
  const getAuthorProfile = useUserProfile(() => (authorPubkey ? authorPubkey : undefined));
  const authorProfile = $derived(getAuthorProfile());
  const authorName = $derived(
    authorPubkey ? getDisplayName(authorProfile ?? undefined, authorPubkey.slice(0, 8) + '...') : ''
  );
</script>

<div class="mb-4">
  <!-- Toolbar: wraps to two rows on mobile, single row on sm:+ -->
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-base-300 pb-2 sm:flex-nowrap"
  >
    <button
      onclick={() => {
        if (getHasHistory()) {
          history.back();
        } else {
          goto(getFallbackRoute(event));
        }
      }}
      class="btn order-1 btn-circle flex-shrink-0 btn-ghost btn-sm"
      aria-label={m.common_back()}
    >
      <ChevronLeftIcon class_="w-5 h-5" />
    </button>

    {#if authorPubkey}
      <div class="order-2 flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
        <ProfileAvatar pubkey={authorPubkey} size="xs" linkToProfile />
        <span class="truncate text-xs">
          <a href={resolve(profileLink(authorPubkey))} class="font-medium hover:underline">
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

    <!-- Mobile-only line break: forces metadata + actions onto row 2 -->
    <div class="order-4 basis-full sm:hidden" aria-hidden="true"></div>

    {#if metadata}
      <div class="order-5 sm:order-3">
        {@render metadata()}
      </div>
    {/if}

    <!-- Spacer: pushes actions/menu right on mobile, fills space on desktop -->
    <div class="order-6 ml-auto sm:order-4 sm:ml-0 sm:flex-1"></div>

    {#if actions}
      <div class="order-7 sm:order-5">
        {@render actions()}
      </div>
    {/if}

    <div class="order-3 sm:order-last">
      <EventContextMenu {event} {onEdit} {onDelete} {deleteTitle} {deleteItemName} />
    </div>
  </div>

  <!-- Title + subtitle: full width, no truncation -->
  {#if titleContent}
    <div class="mt-3">
      {@render titleContent()}
    </div>
  {:else if title}
    <div class="mt-3">
      <h1 class="text-xl font-bold">{title}</h1>
      {#if subtitle}
        <p class="mt-1 text-sm opacity-70">{subtitle}</p>
      {/if}
    </div>
  {/if}
</div>
