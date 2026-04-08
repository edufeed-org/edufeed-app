<!--
  Social Bookmarks Detail Page — Shows all bookmarks, highlights, and page notes for a single URL
-->
<script>
  import { page } from '$app/stores';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
  import { CommunitySocialBookmarkModel } from '$lib/models/community-content.js';
  import { extractUrlFromEvent, normalizeUrl } from '$lib/helpers/urlGrouping.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import BookmarkItem from '$lib/components/bookmarks/BookmarkItem.svelte';
  import HighlightItem from '$lib/components/bookmarks/HighlightItem.svelte';
  import PageNoteItem from '$lib/components/bookmarks/PageNoteItem.svelte';
  import ReaderView from '$lib/components/bookmarks/ReaderView.svelte';
  import { ExternalLinkIcon, ChevronLeftIcon } from '$lib/components/icons';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { getHasHistory } from '$lib/helpers/navigationHistory.js';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();

  /** @type {{ data: any }} */
  let { data } = $props();

  const decodedUrl = $derived(decodeURIComponent(data.encodedUrl));
  const normalizedUrl = $derived(normalizeUrl(decodedUrl));
  const communityPubkey = $derived($page.data.pubkey);

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

  // Collect unique pubkeys for profile loading
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
    if (!communityPubkey || !normalizedUrl) return;

    isLoading = true;
    bookmarks = [];
    highlights = [];
    pageNotes = [];

    // Reuse the same loader as the list view (handles h-tags, reposts, legacy shares)
    const { cleanup } = useSocialBookmarksCommunityLoader(communityPubkey);

    // Subscribe to the same model as the list view (cached if already warm)
    const modelSub = eventStore
      .model(CommunitySocialBookmarkModel, communityPubkey)
      .subscribe((allItems) => {
        // Filter to events matching this URL
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
      modelSub.unsubscribe();
      cleanup();
    };
  });

  // View mode: 'reader' or 'cards'
  let viewMode = $state(/** @type {'reader' | 'cards'} */ ('reader'));
  let readerFailed = $state(false);
  const showReaderToggle = $derived(!isLoading);
  const effectiveView = $derived(readerFailed ? 'cards' : viewMode);

  // Title from bookmarks
  const title = $derived.by(() => {
    for (const b of bookmarks) {
      const titleTag = b.tags?.find((/** @type {string[]} */ t) => t[0] === 'title');
      if (titleTag?.[1]) return titleTag[1];
    }
    return normalizedUrl;
  });

  // Extract target highlight ID from URL fragment (e.g. #highlight-abc123)
  const targetHighlightId = $derived.by(() => {
    const hash = $page.url.hash;
    return hash.startsWith('#highlight-') ? hash.slice('#highlight-'.length) : null;
  });

  // Page note creation
  let noteContent = $state('');
  let isPostingNote = $state(false);

  async function postPageNote() {
    const user = getActiveUser();
    if (!user || !noteContent.trim() || isPostingNote) return;

    isPostingNote = true;
    try {
      const factory = new EventFactory({ signer: user.signer });
      const draft = await factory.build({
        kind: 1111,
        content: noteContent.trim(),
        tags: [
          ['K', 'web'],
          ['I', decodedUrl],
          ['r', decodedUrl],
          ['h', communityPubkey]
        ]
      });
      const signed = await factory.sign(draft);
      eventStore.add(signed);
      publishEventOptimistic(signed);
      noteContent = '';
    } catch (err) {
      console.error('Failed to post page note:', err);
    } finally {
      isPostingNote = false;
    }
  }
</script>

<div class="flex-1 overflow-auto lg:ml-(--sidebar-nav-w)">
  <div class="mx-auto max-w-3xl p-4">
    <!-- Header -->
    <div class="mb-6">
      <div class="flex items-center gap-2">
        <button
          onclick={() => {
            if (getHasHistory()) history.back();
          }}
          class="btn btn-circle btn-ghost btn-sm"
          aria-label={m.common_back()}
        >
          <ChevronLeftIcon class_="w-5 h-5" />
        </button>
        <h1 class="text-xl font-bold">{title}</h1>
      </div>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-sm text-base-content/50">{domain}</span>
        <a
          href={decodedUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="btn gap-1 btn-ghost btn-xs"
        >
          <ExternalLinkIcon class_="w-3.5 h-3.5" />
          Open
        </a>
      </div>

      <!-- View mode toggle -->
      {#if showReaderToggle && !isLoading}
        <div class="mt-3">
          <div class="join">
            <button
              class="btn join-item btn-sm"
              class:btn-active={effectiveView === 'reader'}
              onclick={() => {
                viewMode = 'reader';
                readerFailed = false;
              }}
            >
              {m.reader_view()}
            </button>
            <button
              class="btn join-item btn-sm"
              class:btn-active={effectiveView === 'cards'}
              onclick={() => {
                viewMode = 'cards';
              }}
            >
              {m.reader_cards_view()}
            </button>
          </div>
        </div>
      {/if}
    </div>

    {#if isLoading}
      <div class="flex flex-col items-center justify-center py-16">
        <span class="loading loading-lg loading-spinner text-primary"></span>
      </div>
    {:else if effectiveView === 'reader'}
      <!-- Reader view -->
      <ReaderView
        articleUrl={decodedUrl}
        {highlights}
        {pageNotes}
        {bookmarks}
        {profiles}
        {communityPubkey}
        activeUser={getActiveUser()}
        {targetHighlightId}
        onerror={() => {
          readerFailed = true;
        }}
      />
    {:else}
      <!-- Cards view -->
      <!-- Bookmarks -->
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
                {communityPubkey}
              />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Highlights -->
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
                {communityPubkey}
              />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Page Notes -->
      {#if pageNotes.length > 0}
        <section class="mb-6">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">
            {m.social_bookmarks_page_notes()}
          </h2>
          <div class="flex flex-col gap-3">
            {#each pageNotes as note (note.id)}
              <PageNoteItem
                event={note}
                authorProfile={profiles.get(note.pubkey)}
                expanded={true}
                activeUser={getActiveUser()}
                {communityPubkey}
              />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Add page note -->
      {#if getActiveUser()}
        <section class="mb-6">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">
            {m.social_bookmarks_add_page_note()}
          </h2>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              postPageNote();
            }}
            class="space-y-2"
          >
            <textarea
              bind:value={noteContent}
              placeholder={m.social_bookmarks_page_note_placeholder()}
              class="textarea-bordered textarea w-full"
              rows="3"
              disabled={isPostingNote}
            ></textarea>
            <div class="flex justify-end">
              <button
                type="submit"
                class="btn btn-sm btn-primary"
                disabled={!noteContent.trim() || isPostingNote}
              >
                {#if isPostingNote}
                  <span class="loading loading-xs loading-spinner"></span>
                {/if}
                {m.comments_input_post_button()}
              </button>
            </div>
          </form>
        </section>
      {/if}

      <!-- Empty state if nothing loaded -->
      {#if bookmarks.length === 0 && highlights.length === 0 && pageNotes.length === 0}
        <div class="py-12 text-center text-base-content/50">
          <p>{m.community_social_bookmarks_empty_title()}</p>
        </div>
      {/if}
    {/if}
  </div>
</div>
