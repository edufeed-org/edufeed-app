<!--
  KanbanBoardCard Component
  Displays kanban board (kind 30301) preview in card or list format.
  Links to external kanban editor for full interaction.
-->

<script>
  import { getDisplayName, getTagValue } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import EventDebugPanel from '../shared/EventDebugPanel.svelte';
  import { KanbanIcon } from '$lib/components/icons';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {any} board - Board event (kind 30301)
   * @property {any} [authorProfile] - Author's profile
   * @property {boolean} [compact=false] - Compact display mode
   * @property {'card'|'list'} [variant='card'] - Display variant
   */

  /** @type {Props} */
  let { board, authorProfile = null, compact = false, variant = 'card' } = $props();

  const isList = $derived(variant === 'list');

  const title = $derived(
    getTagValue(board, 'title') || getTagValue(board, 'name') || 'Untitled Board'
  );
  const description = $derived(getTagValue(board, 'description') || '');

  // Extract column names from 'col' tags
  const columns = $derived.by(() => {
    return (
      board.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'col')
        .map((/** @type {any} */ t) => ({ id: t[1], name: t[2] || t[1] })) || []
    );
  });

  const publishedAt = $derived(new Date(board.created_at * 1000));

  const authorName = $derived(getDisplayName(authorProfile, board.pubkey.slice(0, 8) + '...'));

  // Generate naddr for the board
  const boardNaddr = $derived.by(() => {
    return encodeEventToNaddr(board) || null;
  });

  // Truncated description for display
  const truncatedDescription = $derived.by(() => {
    if (!description) return '';
    return description.length > 200 ? description.slice(0, 200) + '...' : description;
  });

  // Max columns to show in preview
  const MAX_PREVIEW_COLUMNS = 5;
  const visibleColumns = $derived(columns.slice(0, MAX_PREVIEW_COLUMNS));
  const extraColumnCount = $derived(Math.max(0, columns.length - MAX_PREVIEW_COLUMNS));

  function navigateToDetail() {
    if (boardNaddr) goto(resolve('/' + boardNaddr));
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigateToDetail();
    }
  }
</script>

{#if isList}
  <!-- List variant: horizontal row -->
  <button
    type="button"
    class="kanban-card-list focus:ring-opacity-50 flex w-full items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left transition-shadow hover:border-primary hover:shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
    onclick={() => boardNaddr && goto(resolve('/' + boardNaddr))}
  >
    <div
      class="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-base-200 sm:h-20 sm:w-20"
    >
      <KanbanIcon class_="w-8 h-8 text-base-content/30" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate font-semibold text-base-content">{title}</div>
      <div class="truncate text-sm text-base-content/60">
        {authorName} · {formatCalendarDate(publishedAt, 'short')}
        {#if columns.length > 0}
          · {m.kanban_board_columns({ count: columns.length })}
        {/if}
      </div>
      {#if truncatedDescription}
        <div class="hidden text-sm text-base-content/50 sm:line-clamp-2 sm:block">
          {truncatedDescription}
        </div>
      {/if}
      {#if columns.length > 0}
        <div class="mt-1 flex flex-wrap gap-1">
          {#each columns.slice(0, 3) as col (col.id)}
            <span class="badge badge-outline badge-xs">{col.name}</span>
          {/each}
          {#if columns.length > 3}
            <span class="badge badge-ghost badge-xs">+{columns.length - 3}</span>
          {/if}
        </div>
      {/if}
    </div>
  </button>
{:else}
  <!-- Card variant: vertical layout -->
  <div
    class="kanban-card focus:ring-opacity-50 cursor-pointer rounded-lg border border-base-300 bg-base-100 shadow-sm transition-shadow hover:border-primary hover:shadow-md focus:ring-2 focus:ring-primary focus:outline-none {compact
      ? 'p-3'
      : 'p-4'}"
    role="button"
    tabindex="0"
    onclick={navigateToDetail}
    onkeydown={handleKeydown}
  >
    <!-- Author Header -->
    <div class="mb-3 flex items-center gap-3">
      <ProfileAvatar
        pubkey={board.pubkey}
        profile={authorProfile}
        size="md"
        fallbackType="robohash"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium text-base-content">{authorName}</div>
        <div class="text-sm text-base-content/60">
          {formatCalendarDate(publishedAt, 'short')}
        </div>
      </div>
    </div>

    <!-- Board Content -->
    <div class="space-y-2">
      <!-- Title -->
      <h2 class="line-clamp-2 text-xl font-bold text-base-content {compact ? 'text-lg' : ''}">
        {title}
      </h2>

      <!-- Description -->
      {#if truncatedDescription && !compact}
        <p class="line-clamp-3 text-sm text-base-content/70">
          {truncatedDescription}
        </p>
      {/if}

      <!-- Column Preview -->
      {#if columns.length > 0 && !compact}
        <div class="flex flex-wrap gap-1.5">
          {#each visibleColumns as col (col.id)}
            <span class="badge badge-outline badge-sm">{col.name}</span>
          {/each}
          {#if extraColumnCount > 0}
            <span class="badge badge-ghost badge-sm">+{extraColumnCount}</span>
          {/if}
        </div>
      {/if}

      <!-- Reactions -->
      {#if !compact}
        <div
          class="pt-2"
          role="presentation"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <ReactionBar event={board} />
        </div>
      {/if}

      <!-- Debug Panel -->
      {#if !compact}
        <div
          role="presentation"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <EventDebugPanel event={board} />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .kanban-card {
    display: flex;
    flex-direction: column;
  }
</style>
