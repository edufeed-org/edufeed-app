<!--
  KanbanBoardView Component
  Full page preview for kanban boards (kind 30301)
  Shows board metadata, column/card preview, and links to external editor
-->

<script>
  import { getDisplayName, getTagValue } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';

  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import { KanbanIcon, TrashIcon, ExternalLinkIcon } from '$lib/components/icons';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';
  import EventContextMenu from '../shared/EventContextMenu.svelte';
  import { encodeEventToNaddr, profileLink } from '$lib/helpers/nostrUtils.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getKanbanRelays } from '$lib/helpers/relay-helper.js';
  import { TimelineModel } from 'applesauce-core/models';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {Object} Props
   * @property {any} event - Raw Nostr event (kind 30301)
   */

  /** @type {Props} */
  let { event } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const isOwner = $derived(activeUser?.pubkey === event.pubkey);

  // Board metadata
  const title = $derived(
    getTagValue(event, 'title') || getTagValue(event, 'name') || 'Untitled Board'
  );
  const description = $derived(getTagValue(event, 'description') || '');
  const dTag = $derived(event.tags?.find((/** @type {any} */ t) => t[0] === 'd')?.[1] || '');

  // Extract columns from 'col' tags
  const columns = $derived.by(() => {
    return (
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'col')
        .map((/** @type {any} */ t) => ({ id: t[1], name: t[2] || t[1] })) || []
    );
  });

  const publishedAt = $derived(new Date(event.created_at * 1000));

  // Author profile
  // svelte-ignore state_referenced_locally
  const getAuthorProfile = useUserProfile(event.pubkey);
  const authorProfile = $derived(getAuthorProfile());
  const authorName = $derived(getDisplayName(authorProfile, event.pubkey.slice(0, 8) + '...'));

  // Generate naddr for the board
  const boardNaddr = $derived(encodeEventToNaddr(event) || null);

  // External editor URL
  const editorUrl = $derived(
    boardNaddr ? `https://kanban.edufeed.org/cardsboard/${boardNaddr}` : null
  );

  // Delete state
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  // Cards loading
  /** @type {any[]} */
  let cards = $state.raw([]);
  let cardsLoading = $state(true);

  // Load kind 30302 cards
  $effect(() => {
    const boardAddress = `30301:${event.pubkey}:${dTag}`;
    cardsLoading = true;

    const cardLoader = createTimelineLoader(
      timedPool,
      getKanbanRelays(),
      { kinds: [30302], '#a': [boardAddress] },
      { eventStore, limit: 100 }
    );

    const loaderSub = cardLoader().subscribe({
      complete: () => {
        cardsLoading = false;
      }
    });

    // Fallback timeout: timedPool uses 2s, allow extra margin
    const fallbackTimer = setTimeout(() => {
      if (cardsLoading) cardsLoading = false;
    }, 4000);

    const modelSub = eventStore
      .model(TimelineModel, { kinds: [30302], '#a': [boardAddress] })
      .subscribe((data) => {
        if (data) {
          cards = data;
        }
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      clearTimeout(fallbackTimer);
    };
  });

  // Group cards by column (using 's' tag for status/column)
  const cardsByColumn = $derived.by(() => {
    /** @type {Record<string, any[]>} */
    const grouped = {};

    // Initialize columns
    for (const col of columns) {
      grouped[col.id] = [];
    }

    for (const card of cards) {
      const colId = card.tags?.find((/** @type {any} */ t) => t[0] === 's')?.[1] || '';
      if (!grouped[colId]) {
        grouped[colId] = [];
      }
      grouped[colId].push(card);
    }

    // Sort cards within each column by rank tag
    for (const colCards of Object.values(grouped)) {
      colCards.sort((a, b) => {
        const rankA = parseInt(
          a.tags?.find((/** @type {any} */ t) => t[0] === 'rank')?.[1] || '0',
          10
        );
        const rankB = parseInt(
          b.tags?.find((/** @type {any} */ t) => t[0] === 'rank')?.[1] || '0',
          10
        );
        return rankA - rankB;
      });
    }

    return grouped;
  });

  const MAX_CARDS_PER_COLUMN = 5;

  /**
   * Handle board deletion
   */
  async function handleDelete() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);
      if (result.success) {
        showToast('Board deleted successfully', 'success');
        showDeleteConfirmation = false;
        goto(/** @type {string} */ (resolve('/discover?type=boards')));
      } else {
        showToast(result.error || 'Failed to delete board', 'error');
      }
    } catch (error) {
      console.error('Failed to delete board:', error);
      showToast('An error occurred while deleting the board', 'error');
    } finally {
      isDeleting = false;
    }
  }
</script>

<svelte:head>
  <title>{title} - {runtimeConfig.appName}</title>
  <meta name="description" content={description || `Kanban board on ${runtimeConfig.appName}`} />
</svelte:head>

<article class="mx-auto max-w-4xl">
  <!-- HEADER -->
  <header class="mb-6">
    <!-- Title with icon -->
    <div class="mb-4 flex items-center gap-3">
      <KanbanIcon class_="w-8 h-8 text-primary" />
      <h1 class="text-4xl font-bold text-base-content md:text-5xl">
        {title}
      </h1>
    </div>

    <!-- Description -->
    {#if description}
      <MarkdownRenderer
        content={description}
        class="prose prose-lg mb-6 max-w-none text-base-content/80"
      />
    {/if}

    <!-- Metadata bar -->
    <div class="flex flex-col gap-4 border-y border-base-300 py-4 md:flex-row md:items-center">
      <!-- Author info -->
      <div class="flex flex-1 items-center gap-3">
        <ProfileAvatar
          pubkey={event.pubkey}
          profile={authorProfile}
          size="lg"
          linkToProfile
          fallbackType="robohash"
        />
        <div>
          <a
            href={resolve(profileLink(event.pubkey))}
            class="block font-semibold text-base-content hover:underline"
          >
            {authorName}
          </a>
          <div class="text-sm text-base-content/60">
            {formatCalendarDate(publishedAt, 'short')}
            {#if columns.length > 0}
              · {m.kanban_board_columns({ count: columns.length })}
            {/if}
            {#if cards.length > 0}
              · {m.kanban_board_cards_count({ count: cards.length })}
            {/if}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-2">
        {#if isOwner}
          <button
            class="btn btn-outline btn-sm btn-error"
            onclick={() => (showDeleteConfirmation = true)}
            aria-label="Delete board"
          >
            <TrashIcon class="h-4 w-4" />
            {m.common_delete()}
          </button>
        {/if}
        <EventContextMenu {event} />
      </div>
    </div>
  </header>

  <!-- OPEN IN EDITOR CTA -->
  {#if editorUrl}
    <div class="mb-8 rounded-lg border-2 border-primary bg-primary/10 p-6">
      <h2 class="mb-3 text-xl font-bold text-base-content">
        {m.kanban_board_open_editor()}
      </h2>
      <p class="mb-4 text-sm text-base-content/70">
        {m.kanban_board_open_editor_desc()}
      </p>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: kanban editor link -->
      <a href={editorUrl} target="_blank" rel="noopener noreferrer" class="btn btn-lg btn-primary">
        <ExternalLinkIcon class_="mr-2 h-5 w-5" />
        {m.kanban_board_open_editor()}
      </a>
    </div>
  {/if}

  <!-- BOARD PREVIEW -->
  <div class="mb-8">
    {#if cardsLoading}
      <div class="flex items-center gap-2 py-8 text-base-content/60">
        <span class="loading loading-sm loading-spinner"></span>
        {m.kanban_board_loading_cards()}
      </div>
    {:else if columns.length === 0}
      <p class="py-4 text-base-content/60">{m.kanban_board_no_cards()}</p>
    {:else}
      <div class="flex gap-4 overflow-x-auto pb-4">
        {#each columns as col (col.id)}
          {@const colCards = cardsByColumn[col.id] || []}
          <div class="max-w-[280px] min-w-[220px] flex-shrink-0 rounded-lg bg-base-200 p-3">
            <!-- Column header -->
            <div class="mb-3 flex items-center justify-between">
              <h3 class="font-semibold text-base-content">{col.name}</h3>
              {#if colCards.length > 0}
                <span class="badge badge-ghost badge-sm">{colCards.length}</span>
              {/if}
            </div>

            <!-- Card list -->
            <div class="space-y-2">
              {#each colCards.slice(0, MAX_CARDS_PER_COLUMN) as card (card.id)}
                {@const cardTitle =
                  getTagValue(card, 'title') || getTagValue(card, 'name') || 'Untitled'}
                <div class="rounded-md bg-base-100 p-2.5 text-sm text-base-content shadow-sm">
                  {cardTitle}
                </div>
              {/each}
              {#if colCards.length > MAX_CARDS_PER_COLUMN}
                <div class="text-center text-xs text-base-content/50">
                  {m.kanban_board_more_cards({ count: colCards.length - MAX_CARDS_PER_COLUMN })}
                </div>
              {/if}
              {#if colCards.length === 0}
                <div class="py-2 text-center text-xs text-base-content/40">
                  {m.kanban_board_no_cards()}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- REACTIONS -->
  <div class="mb-8 border-y border-base-300 py-4">
    <ReactionBar {event} />
  </div>

  <!-- COMMENTS -->
  <div class="mt-8">
    <h2 class="mb-4 text-2xl font-bold text-base-content">{m.comments_title()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </div>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.common_delete() + '?'}
  itemName={title}
  {isDeleting}
  onconfirm={handleDelete}
  oncancel={() => (showDeleteConfirmation = false)}
/>
