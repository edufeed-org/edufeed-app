<!--
  ThreadDetailView Component
  Full detail view for kind 1 (text notes) and kind 11 (forum threads)
  Header matches Chateau layout: back arrow + author avatar + name + date
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { resolve } from '$app/paths';
  import { TrashIcon } from '$lib/components/icons';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import NostrContentRenderer from '../shared/NostrContentRenderer.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import NoteCard from '../notes/NoteCard.svelte';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import CommunityShare from '../shared/CommunityShare.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Thread event (kind 1 or 11)
   * @property {any} [parentEvent] - Parent event for kind 1 replies
   * @property {() => void} [onBack] - Callback to navigate back
   * @property {string|null} [initialFocusCommentId] - Comment ID to auto-focus (deep-linking)
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {Props} */
  let {
    event,
    parentEvent = null,
    onBack,
    initialFocusCommentId = null,
    communityPubkey = undefined
  } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const getAuthorProfile = useUserProfile(() => event.pubkey);
  const authorProfile = $derived(getAuthorProfile());

  // Extract thread metadata
  const title = $derived(
    event.tags?.find((/** @type {any} */ t) => t[0] === 'title')?.[1] || m.thread_detail_untitled()
  );

  const hashtags = $derived(
    event.tags
      ?.filter((/** @type {any} */ t) => t[0] === 't')
      .map((/** @type {any} */ t) => t[1]) || []
  );

  const authorName = $derived(
    getDisplayName(authorProfile ?? undefined, event.pubkey.slice(0, 8) + '...')
  );
  const relativeDate = $derived(formatRelativeTime(event.created_at));

  let showShareUI = $state(false);
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  async function handleDelete() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);
      if (result.success) {
        showToast(m.thread_detail_delete_success(), 'success');
        showDeleteConfirmation = false;
        onBack?.();
      } else {
        showToast(result.error || m.thread_detail_delete_failed(), 'error');
      }
    } catch (error) {
      console.error('Failed to delete thread:', error);
      showToast(m.thread_detail_delete_failed(), 'error');
    } finally {
      isDeleting = false;
    }
  }
</script>

<article class="thread-detail mx-auto max-w-4xl">
  <!-- Parent context for kind 1 replies -->
  {#if parentEvent}
    <div class="mb-2 text-xs text-base-content/50">{m.thread_detail_replying_to()}</div>
    <div class="pointer-events-none mb-4 opacity-60">
      <NoteCard note={parentEvent} />
    </div>
  {/if}

  <!-- Header: author avatar + name + date + actions -->
  <div class="mb-6 flex items-center gap-3">
    <ProfileAvatar pubkey={event.pubkey} size="md" linkToProfile class="flex-shrink-0" />
    <div class="min-w-0 flex-1">
      <a
        href={resolve(`/p/${event.pubkey}`)}
        class="font-semibold text-base-content hover:underline"
      >
        {authorName}
      </a>
      <div class="text-xs text-base-content/50">{relativeDate}</div>
    </div>

    <!-- Actions -->
    <div class="flex shrink-0 gap-2">
      {#if isAuthor}
        <button
          class="btn btn-outline btn-sm btn-error"
          onclick={() => (showDeleteConfirmation = true)}
          aria-label={m.common_delete()}
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      {/if}
      {#if activeUser}
        <button class="btn btn-ghost btn-sm" onclick={() => (showShareUI = !showShareUI)}>
          {showShareUI ? m.common_close() : m.common_share()}
        </button>
      {/if}
    </div>
  </div>

  <!-- Share UI -->
  {#if showShareUI && activeUser}
    <div class="mb-6 rounded-lg bg-base-200 p-4">
      <CommunityShare
        {event}
        {activeUser}
        shareButtonText={m.thread_detail_share_with_communities()}
      />
    </div>
  {/if}

  <!-- Title (kind 11 only) -->
  {#if event.kind === 11}
    <h1 class="mb-4 text-2xl font-bold text-base-content md:text-3xl">
      {title}
    </h1>
  {/if}

  <!-- Content -->
  <div class="mb-6">
    {#if event.kind === 11}
      <MarkdownRenderer
        content={event.content}
        class="prose prose-lg max-w-none prose-a:text-primary prose-blockquote:border-primary/50"
      />
    {:else}
      <NostrContentRenderer {event} />
    {/if}
  </div>

  <!-- Reactions -->
  <div class="mb-6">
    <ReactionBar {event} />
  </div>

  <!-- Tags -->
  {#if hashtags.length > 0}
    <div class="mb-6 flex flex-wrap gap-2">
      <EventTags tags={hashtags} size="md" targetRoute="/discover" />
    </div>
  {/if}

  <!-- Comments (flat replies) -->
  <div class="mt-6">
    <CommentList
      rootEvent={event}
      {activeUser}
      collapsedReplies={true}
      {initialFocusCommentId}
      {communityPubkey}
    />
  </div>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.thread_detail_delete_confirm_title()}
  itemName={title}
  {isDeleting}
  onconfirm={handleDelete}
  oncancel={() => (showDeleteConfirmation = false)}
/>
