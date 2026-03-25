<!--
  ArticleView Component
  Full article display for detail pages with optional highlight support
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getProfilePicture, getDisplayName } from 'applesauce-core/helpers';
  import { getArticleTitle, getArticleImage } from 'applesauce-common/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import { loadEventHighlights } from '$lib/loaders/event-highlights.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { EditIcon, TrashIcon } from '$lib/components/icons';
  import EventContextMenu from '../shared/EventContextMenu.svelte';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';
  import HighlightOverlay from '../shared/HighlightOverlay.svelte';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import CommunityShare from '../shared/CommunityShare.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Article event (kind 30023)
   * @property {string} [communityPubkey] - Community context for highlights
   * @property {string | null} [targetHighlightId] - Auto-scroll to this highlight
   */

  /** @type {Props} */
  let { event, communityPubkey = undefined, targetHighlightId = null } = $props();

  // Get active user (reactive to login/logout)
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // Load author profile - pass getter for reactive tracking if event prop changes
  const getAuthorProfile = useUserProfile(() => event.pubkey);
  const authorProfile = $derived(getAuthorProfile());

  // Extract article metadata
  const title = $derived(getArticleTitle(event) || 'Untitled Article');
  const image = $derived(getArticleImage(event));

  const dTag = $derived.by(() => {
    const tag = event.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return tag?.[1] || '';
  });

  // Get summary
  const summary = $derived.by(() => {
    const summaryTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'summary');
    return summaryTag?.[1] || '';
  });

  // Get published date
  const publishedAt = $derived.by(() => {
    const publishedTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'published_at');
    if (publishedTag?.[1]) {
      return new Date(parseInt(publishedTag[1]) * 1000);
    }
    return new Date(event.created_at * 1000);
  });

  // Get hashtags
  const hashtags = $derived.by(() => {
    return (
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 't')
        .map((/** @type {any} */ t) => t[1]) || []
    );
  });

  // Get author info
  const authorName = $derived(
    getDisplayName(authorProfile ?? undefined, event.pubkey.slice(0, 8) + '...')
  );
  const authorAvatar = $derived(
    getProfilePicture(authorProfile ?? undefined) || `https://robohash.org/${event.pubkey}`
  );

  // Share UI state
  let showShareUI = $state(false);

  // Delete state
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  // Render markdown to HTML
  const htmlContent = $derived(renderMarkdown(event.content));

  // Address pointer for this article
  const addressPointer = $derived.by(() => ({
    kind: /** @type {number} */ (30023),
    pubkey: event.pubkey,
    identifier: dTag
  }));

  // Load highlights for this article
  let highlights = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (!event.pubkey || !dTag) return;

    const aTagValue = `${30023}:${event.pubkey}:${dTag}`;

    /** @type {import('nostr-tools').Filter} */
    const filter = { kinds: [9802], '#a': [aTagValue] };
    if (communityPubkey) {
      filter['#h'] = [communityPubkey];
    }

    const { loader, cleanup } = loadEventHighlights(
      { kind: 30023, pubkey: event.pubkey, identifier: dTag },
      communityPubkey
    );
    loader();

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      highlights = events || [];
    });

    return () => {
      cleanup();
      modelSub.unsubscribe();
    };
  });

  // Load highlight author profiles
  const getHighlightProfiles = useProfileMap(() => highlights.map((h) => h.pubkey));
  const highlightProfiles = $derived(getHighlightProfiles());

  /**
   * Handle article deletion
   */
  async function handleDelete() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);
      if (result.success) {
        showToast(m.article_view_delete_success(), 'success');
        showDeleteConfirmation = false;
        history.back();
      } else {
        showToast(result.error || m.article_view_delete_failed(), 'error');
      }
    } catch (error) {
      console.error('Failed to delete article:', error);
      showToast(m.article_view_delete_failed(), 'error');
    } finally {
      isDeleting = false;
    }
  }

  function handleEdit() {
    const naddr = encodeEventToNaddr(event);
    if (naddr) {
      goto(resolve(`/create/article?edit=${naddr}`));
    }
  }
</script>

<article class="article-view mx-auto max-w-4xl">
  <!-- Article Header -->
  <header class="mb-8">
    <!-- Title -->
    <h1 class="mb-4 text-4xl font-bold text-base-content md:text-5xl">
      {title}
    </h1>

    <!-- Summary -->
    {#if summary}
      <p class="mb-6 text-xl text-base-content/70">
        {summary}
      </p>
    {/if}

    <!-- Author Info & Metadata -->
    <div class="flex flex-col gap-4 border-y border-base-300 py-4 md:flex-row md:items-center">
      <!-- Author -->
      <div class="flex flex-1 items-center gap-3">
        <div class="avatar">
          <div class="h-12 w-12 rounded-full">
            <img src={authorAvatar} alt={authorName} />
          </div>
        </div>
        <div>
          <div class="font-semibold text-base-content">{authorName}</div>
          <div class="text-sm text-base-content/60">
            {m.article_view_published({ date: formatCalendarDate(publishedAt, 'short') })}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        {#if isAuthor}
          <button class="btn btn-outline btn-sm" onclick={handleEdit}>
            <EditIcon class="h-4 w-4" />
            {m.common_edit()}
          </button>
          <button
            class="btn btn-outline btn-sm btn-error"
            onclick={() => (showDeleteConfirmation = true)}
            aria-label={m.common_delete()}
          >
            <TrashIcon class="h-4 w-4" />
            {m.common_delete()}
          </button>
        {/if}
        {#if activeUser}
          <button class="btn btn-sm btn-secondary" onclick={() => (showShareUI = !showShareUI)}>
            {showShareUI ? m.common_close() : m.common_share()}
          </button>
        {/if}
        <EventContextMenu {event} />
      </div>
    </div>

    <!-- Share UI -->
    {#if showShareUI && activeUser}
      <div class="mt-4 rounded-lg bg-base-200 p-4">
        <CommunityShare
          {event}
          {activeUser}
          shareButtonText={m.article_view_share_with_communities()}
        />
      </div>
    {/if}
  </header>

  <!-- Featured Image -->
  {#if image}
    <div class="mb-8">
      <div class="aspect-[16/9] w-full overflow-hidden rounded-lg">
        <ImageWithFallback
          src={image}
          alt={title}
          fallbackType="article"
          size="hero"
          class="h-full w-full object-cover"
        />
      </div>
    </div>
  {/if}

  <!-- Article Content with Highlights -->
  <div class="mb-8">
    <HighlightOverlay
      {htmlContent}
      {highlights}
      profiles={highlightProfiles}
      source={addressPointer}
      {activeUser}
      {communityPubkey}
      {targetHighlightId}
      class="prose prose-lg max-w-none prose-a:text-primary prose-blockquote:border-primary/50 prose-pre:rounded-lg prose-pre:bg-base-200 prose-img:rounded-lg"
    />
  </div>

  <!-- Tags -->
  {#if hashtags.length > 0}
    <div class="mb-8 flex flex-wrap gap-2">
      <span class="text-sm font-medium text-base-content/70">{m.article_view_topics()}</span>
      <EventTags tags={hashtags} size="md" targetRoute="/discover" />
    </div>
  {/if}

  <!-- Reactions -->
  <div class="mb-8 border-y border-base-300 py-4">
    <ReactionBar {event} />
  </div>

  <!-- Comments -->
  <div class="mt-8">
    <h2 class="mb-4 text-2xl font-bold text-base-content">{m.article_view_comments()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </div>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.article_view_delete_confirm_title()}
  itemName={title}
  {isDeleting}
  onconfirm={handleDelete}
  oncancel={() => (showDeleteConfirmation = false)}
/>
