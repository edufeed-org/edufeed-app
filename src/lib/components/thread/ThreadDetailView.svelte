<!--
  ThreadDetailView Component
  Full detail view for kind 1 (text notes) and kind 11 (forum threads)
  Uses DetailHeader for unified back button, title, author strip, and context menu.
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
  import { encodePointer } from 'applesauce-core/helpers';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import NostrContentRenderer from '../shared/NostrContentRenderer.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import NoteCard from '../notes/NoteCard.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import DetailHeader from '../shared/DetailHeader.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Thread event (kind 1 or 11)
   * @property {any} [parentEvent] - Parent event for kind 1 replies
   * @property {string|null} [initialFocusCommentId] - Comment ID to auto-focus (deep-linking)
   * @property {string|null} [scrollTo] - Section to scroll to (e.g. 'reactions')
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {Props} */
  let {
    event,
    parentEvent = null,
    initialFocusCommentId = null,
    scrollTo = null,
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

  // Scroll to reactions section when navigating from a reaction notification
  /** @type {HTMLElement | undefined} */
  let reactionsEl;
  $effect(() => {
    if (scrollTo !== 'reactions') return;
    if (!reactionsEl) return;

    requestAnimationFrame(() => {
      reactionsEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reactionsEl?.classList.add('comment-highlight');
      setTimeout(() => reactionsEl?.classList.remove('comment-highlight'), 2000);
    });
  });

  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  async function handleDelete() {
    if (!activeUser || !event) return;

    const result = await deleteEvent(event, activeUser);
    if (result.success) {
      showToast(m.thread_detail_delete_success(), 'success');
      history.back();
    } else {
      showToast(result.error || m.thread_detail_delete_failed(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
  }
</script>

<article class="thread-detail mx-auto max-w-4xl">
  <!-- Parent context for kind 1 replies -->
  {#if parentEvent}
    <div class="mb-2 text-xs text-base-content/50">{m.thread_detail_replying_to()}</div>
    <a
      href={resolve(`/${encodePointer({ id: parentEvent.id, relays: [] })}`)}
      class="mb-4 block opacity-60 transition-opacity hover:opacity-100"
    >
      <NoteCard note={parentEvent} />
    </a>
  {/if}

  <DetailHeader
    title={event.kind === 11 ? title : authorName}
    {event}
    authorPubkey={event.pubkey}
    date={relativeDate}
    showAuthorStrip={event.kind === 11}
    onDelete={isAuthor ? handleDelete : undefined}
    deleteTitle={m.thread_detail_delete_confirm_title()}
    deleteItemName={title}
  >
    {#snippet titleContent()}
      {#if event.kind === 1}
        <div class="flex items-center gap-2">
          <ProfileAvatar pubkey={event.pubkey} size="sm" linkToProfile />
          <div class="min-w-0">
            <a href={resolve(`/p/${event.pubkey}`)} class="text-sm font-semibold hover:underline">
              {authorName}
            </a>
            <div class="text-xs opacity-50">{relativeDate}</div>
          </div>
        </div>
      {:else}
        <h1 class="truncate text-xl font-bold">{title}</h1>
      {/if}
    {/snippet}
  </DetailHeader>

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
  <div class="mb-6" id="reactions" bind:this={reactionsEl}>
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
