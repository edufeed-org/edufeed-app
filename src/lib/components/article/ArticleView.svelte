<!--
  ArticleView Component
  Full article display for detail pages with optional highlight support
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getArticleTitle, getArticleImage } from 'applesauce-common/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import { loadEventHighlights } from '$lib/loaders/event-highlights.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import DetailHeader from '../shared/DetailHeader.svelte';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';
  import ImageLicenseOverlay from '../shared/ImageLicenseOverlay.svelte';
  import { useLicenseStatus } from '$lib/stores/image-license.svelte.js';
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import HighlightOverlay from '../shared/HighlightOverlay.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';

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

  // Extract article metadata
  const title = $derived(getArticleTitle(event) || 'Untitled Article');
  const image = $derived(getArticleImage(event));

  const imageHash = $derived.by(() => {
    const xTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'x')?.[1];
    if (xTag) return xTag;
    return image ? (getSha256FromURL(image) ?? null) : null;
  });

  const getCoverStatus = useLicenseStatus(() => imageHash);
  const coverStatus = $derived(getCoverStatus());

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

  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  // Render markdown to HTML
  const htmlContent = $derived(renderMarkdown(event.content, { headingAnchors: true }));

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

    const result = await deleteEvent(event, activeUser);
    if (result.success) {
      showToast(m.article_view_delete_success(), 'success');
      history.back();
    } else {
      showToast(result.error || m.article_view_delete_failed(), 'error');
      throw new Error(result.error || 'Delete failed');
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
  <DetailHeader
    {title}
    subtitle={summary}
    {event}
    authorPubkey={event.pubkey}
    date={formatCalendarDate(publishedAt, 'short')}
    onEdit={isAuthor ? handleEdit : undefined}
    onDelete={isAuthor ? handleDelete : undefined}
    deleteTitle={m.article_view_delete_confirm_title()}
    deleteItemName={title}
  >
    {#snippet metadata()}
      {#if hashtags.length > 0}
        <EventTags tags={hashtags} size="xs" maxDisplay={3} targetRoute="/discover" />
      {/if}
    {/snippet}
  </DetailHeader>

  <!-- Featured Image -->
  {#if image}
    <div class="mb-8">
      <div class="relative aspect-[16/9] w-full overflow-hidden rounded-lg">
        <ImageWithFallback
          src={image}
          alt={title}
          fallbackType="article"
          size="hero"
          class="h-full w-full object-cover"
        />
        <ImageLicenseOverlay
          licenseEvent={coverStatus.event}
          status={coverStatus.status}
          variant="pill"
          position="absolute right-2 bottom-2 bg-base-100/80 backdrop-blur"
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
