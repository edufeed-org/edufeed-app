<!--
  Standalone Bookmark Detail Page — Shows all bookmarks, highlights, and page notes for a URL
  (Non-community version of c/[pubkey]/bookmarks/[url])
-->
<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { extractUrlFromEvent, normalizeUrl } from '$lib/helpers/urlGrouping.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import BookmarkItem from '$lib/components/bookmarks/BookmarkItem.svelte';
  import HighlightItem from '$lib/components/bookmarks/HighlightItem.svelte';
  import ReaderView from '$lib/components/bookmarks/ReaderView.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import DetailHeader from '$lib/components/shared/DetailHeader.svelte';
  import { BookOpenIcon, ChatTextIcon } from '$lib/components/icons';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();

  /** @type {{ data: any }} */
  let { data } = $props();

  const decodedUrl = $derived(decodeURIComponent(data.encodedUrl));
  const normalizedUrl = $derived(normalizeUrl(decodedUrl));

  const domain = $derived.by(() => {
    try {
      return new URL(decodedUrl).hostname.replace(/^www\./, '');
    } catch {
      return normalizedUrl.split('/')[0];
    }
  });

  let bookmarks = $state.raw(/** @type {any[]} */ ([]));
  let highlights = $state.raw(/** @type {any[]} */ ([]));
  let pageNotes = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);

  const allPubkeys = $derived.by(() => {
    /** @type {string[]} */
    const all = [
      ...bookmarks.map((e) => e.pubkey),
      ...highlights.map((e) => e.pubkey),
      ...pageNotes.map((e) => e.pubkey)
    ];
    return all.filter((p, i) => all.indexOf(p) === i);
  });
  const getProfiles = useProfileMap(() => allPubkeys);
  const profiles = $derived(getProfiles());

  $effect(() => {
    if (!normalizedUrl) return;

    isLoading = true;
    bookmarks = [];
    highlights = [];
    pageNotes = [];

    const relays = getAllLookupRelays();
    const kinds = [39701, 9802, 1111];

    const loader = createTimelineLoader(
      timedPool,
      relays,
      { kinds, '#r': [decodedUrl, normalizedUrl], limit: 100 },
      { eventStore }
    );
    const loaderSub = loader().subscribe();

    const modelSub = eventStore
      .model(TimelineModel, { kinds, '#r': [decodedUrl, normalizedUrl] })
      .subscribe((allItems) => {
        const urlFiltered = (allItems || []).filter((event) => {
          const eventUrl = extractUrlFromEvent(event);
          return eventUrl && normalizeUrl(eventUrl) === normalizedUrl;
        });

        bookmarks = urlFiltered.filter((e) => e.kind === 39701);
        highlights = urlFiltered.filter((e) => e.kind === 9802);
        pageNotes = urlFiltered.filter((e) => e.kind === 1111);
        isLoading = false;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  let viewMode = $state(/** @type {'reader' | 'cards'} */ ('reader'));
  let readerFailed = $state(false);
  const showReaderToggle = $derived(!isLoading);
  const effectiveView = $derived(readerFailed ? 'cards' : viewMode);

  const title = $derived.by(() => {
    for (const b of bookmarks) {
      const titleTag = b.tags?.find((/** @type {string[]} */ t) => t[0] === 'title');
      if (titleTag?.[1]) return titleTag[1];
    }
    return normalizedUrl;
  });

  const representativeEvent = $derived(
    bookmarks[0] ||
      highlights[0] ||
      pageNotes[0] || {
        id: '',
        kind: 39701,
        pubkey: '',
        tags: [],
        created_at: 0,
        content: '',
        sig: ''
      }
  );
</script>

<div class="mx-auto max-w-3xl p-4">
  <DetailHeader {title} subtitle={domain} event={representativeEvent} authorPubkey="">
    {#snippet actions()}
      {#if showReaderToggle && !isLoading}
        <label class="btn swap swap-rotate btn-ghost btn-sm">
          <input
            type="checkbox"
            checked={effectiveView === 'cards'}
            onchange={() => {
              if (effectiveView === 'cards') {
                viewMode = 'reader';
                readerFailed = false;
              } else {
                viewMode = 'cards';
              }
            }}
          />
          <BookOpenIcon class_="swap-off w-4 h-4" />
          <ChatTextIcon class_="swap-on w-4 h-4" />
        </label>
      {/if}
    {/snippet}
  </DetailHeader>

  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if effectiveView === 'reader'}
    <ReaderView
      articleUrl={decodedUrl}
      {highlights}
      {bookmarks}
      {profiles}
      communityPubkey={undefined}
      activeUser={getActiveUser()}
      targetHighlightId={null}
      onerror={() => {
        readerFailed = true;
      }}
    />
  {:else}
    {#if bookmarks.length > 0}
      <section class="mb-6">
        <h2 class="mb-3 text-sm font-semibold text-base-content/70">
          {m.social_bookmarks_bookmarks()}
        </h2>
        <div class="flex flex-col gap-3">
          {#each bookmarks as bookmark (bookmark.id)}
            <BookmarkItem
              event={bookmark}
              authorProfile={profiles.get(bookmark.pubkey)}
              expanded={true}
              activeUser={getActiveUser()}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if highlights.length > 0}
      <section class="mb-6">
        <h2 class="mb-3 text-sm font-semibold text-base-content/70">
          {m.social_bookmarks_highlights()}
        </h2>
        <div class="flex flex-col gap-3">
          {#each highlights as highlight (highlight.id)}
            <HighlightItem
              event={highlight}
              authorProfile={profiles.get(highlight.pubkey)}
              expanded={true}
              activeUser={getActiveUser()}
            />
          {/each}
        </div>
      </section>
    {/if}

    <!-- URL-rooted page-note conversation (NIP-22 with external root) -->
    <section class="mb-6">
      <CommentList rootUrl={decodedUrl} activeUser={getActiveUser()} />
    </section>

    {#if bookmarks.length === 0 && highlights.length === 0 && pageNotes.length === 0}
      <div class="py-12 text-center text-base-content/50">
        <p>{m.community_social_bookmarks_empty_title()}</p>
      </div>
    {/if}
  {/if}
</div>
