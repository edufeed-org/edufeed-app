<!--
  WikiView Component
  Full wiki article display for detail pages (kind 30818 / NIP-54) with optional highlight support
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { renderWikiContent } from '$lib/helpers/wikiContent.js';
  import { loadEventHighlights } from '$lib/loaders/event-highlights.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { resolve } from '$app/paths';
  import { TrashIcon } from '$lib/components/icons';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import EventContextMenu from '../shared/EventContextMenu.svelte';
  import HighlightOverlay from '../shared/HighlightOverlay.svelte';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import CommunityShare from '../shared/CommunityShare.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Wiki event (kind 30818)
   * @property {string} [communityPubkey] - Community context for highlights
   * @property {string | null} [targetHighlightId] - Auto-scroll to this highlight
   */

  /** @type {Props} */
  let { event, communityPubkey = undefined, targetHighlightId = null } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const getAuthorProfile = useUserProfile(() => event.pubkey);
  const authorProfile = $derived(getAuthorProfile());

  // Extract wiki metadata
  const title = $derived.by(() => {
    const titleTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'title');
    const dTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return titleTag?.[1] || dTag?.[1] || 'Untitled Wiki';
  });

  const dTag = $derived.by(() => {
    const tag = event.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return tag?.[1] || '';
  });

  const summary = $derived.by(() => {
    const summaryTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'summary');
    return summaryTag?.[1] || '';
  });

  const topic = $derived.by(() => {
    const tag = event.tags?.find((/** @type {any} */ t) => t[0] === 'd');
    return tag?.[1] || '';
  });

  const publishedAt = $derived(new Date(event.created_at * 1000));

  const hashtags = $derived.by(() => {
    return (
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 't')
        .map((/** @type {any} */ t) => t[1]) || []
    );
  });

  const authorName = $derived(
    getDisplayName(authorProfile ?? undefined, event.pubkey.slice(0, 8) + '...')
  );
  let showShareUI = $state(false);
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  // Render wiki content (Djot default, AsciiDoc detected)
  let htmlContent = $state('');
  $effect(() => {
    const content = event.content;
    renderWikiContent(content).then((html) => {
      htmlContent = html;
    });
  });

  // Address pointer for this wiki
  const addressPointer = $derived.by(() => ({
    kind: /** @type {number} */ (30818),
    pubkey: event.pubkey,
    identifier: dTag
  }));

  // Load highlights
  let highlights = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (!event.pubkey || !dTag) return;

    const aTagValue = `${30818}:${event.pubkey}:${dTag}`;

    /** @type {import('nostr-tools').Filter} */
    const filter = { kinds: [9802], '#a': [aTagValue] };
    if (communityPubkey) {
      filter['#h'] = [communityPubkey];
    }

    const { loader, cleanup } = loadEventHighlights(
      { kind: 30818, pubkey: event.pubkey, identifier: dTag },
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

  async function handleDelete() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);
      if (result.success) {
        showToast(m.wiki_view_delete_success(), 'success');
        showDeleteConfirmation = false;
        history.back();
      } else {
        showToast(result.error || m.wiki_view_delete_failed(), 'error');
      }
    } catch (error) {
      console.error('Failed to delete wiki:', error);
      showToast(m.wiki_view_delete_failed(), 'error');
    } finally {
      isDeleting = false;
    }
  }
</script>

<article class="wiki-view mx-auto max-w-4xl">
  <!-- Wiki Header -->
  <header class="mb-8">
    <h1 class="mb-4 text-4xl font-bold text-base-content md:text-5xl">
      {title}
    </h1>

    {#if summary}
      <p class="mb-6 text-xl text-base-content/70">
        {summary}
      </p>
    {/if}

    {#if topic}
      <div class="mb-4">
        <span class="badge badge-lg badge-secondary">{topic}</span>
      </div>
    {/if}

    <!-- Author Info & Metadata -->
    <div class="flex flex-col gap-4 border-y border-base-300 py-4 md:flex-row md:items-center">
      <div class="flex flex-1 items-center gap-3">
        <ProfileAvatar pubkey={event.pubkey} size="lg" linkToProfile />
        <div>
          <a
            href={resolve(`/p/${event.pubkey}`)}
            class="font-semibold text-base-content hover:underline">{authorName}</a
          >
          <div class="text-sm text-base-content/60">
            {m.wiki_view_published({ date: formatCalendarDate(publishedAt, 'short') })}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        {#if isAuthor}
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
          shareButtonText={m.wiki_view_share_with_communities()}
        />
      </div>
    {/if}
  </header>

  <!-- Wiki Content with Highlights -->
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
      <EventTags tags={hashtags} size="md" targetRoute="/discover" />
    </div>
  {/if}

  <!-- Reactions -->
  <div class="mb-8 border-y border-base-300 py-4">
    <ReactionBar {event} />
  </div>

  <!-- Comments -->
  <div class="mt-8">
    <h2 class="mb-4 text-2xl font-bold text-base-content">{m.wiki_view_comments()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </div>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.wiki_view_delete_confirm_title()}
  itemName={title}
  {isDeleting}
  onconfirm={handleDelete}
  oncancel={() => (showDeleteConfirmation = false)}
/>
