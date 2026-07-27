<!--
  SocialBookmarkDetailView — Unified detail page for an event-ref social bookmark.

  A kind-39701 bookmark that targets an addressable Nostr event (in practice a
  kind-30023 article) renders the article natively, wrapped in social context:
  a context strip + savers/highlights rails (the bookmark layer, grouped by
  coordinate) alongside a shared reaction bar + discussion that anchor to the
  article's own naddr coordinate (the canonical thread). The bookmark layer
  stays distinct from the article's own social thread.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { getArticleTitle, getArticleImage } from 'applesauce-common/helpers';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { createCachedTimelineLoader } from '$lib/loaders/base.js';
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { reactionsStore } from '$lib/stores/reactions.svelte.js';
  import { deleteReaction, aggregateReactions } from '$lib/helpers/reactions.js';
  import { createBookmarkEvent } from '$lib/helpers/bookmark.js';
  import {
    isBookmarked,
    isInBookmarkSet,
    isBookmarkPending,
    bookmark as addToList,
    unbookmark as removeFromList,
    createBookmarkSetAndBookmark,
    getBookmarkSets,
    getBookmarkSetTitle,
    getBookmarkSetIdentifier
  } from '$lib/stores/personal-bookmarks.svelte.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { getAllLookupRelays, getArticleRelays } from '$lib/helpers/relay-helper.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { useReplaceableEvent } from '$lib/stores/replaceable-event.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { tick } from 'svelte';
  import HighlightOverlay from '$lib/components/shared/HighlightOverlay.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import ReactionPicker from '$lib/components/reactions/ReactionPicker.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ShareMenu from '$lib/components/bookmarks/ShareMenu.svelte';
  import {
    HeartIcon,
    BookmarkIcon,
    LightningIcon,
    CalendarIcon,
    ClockIcon,
    ChevronLeftIcon,
    InfoCircleIcon,
    EditIcon,
    LinkIcon,
    CheckIcon,
    PlusIcon,
    ChatTextIcon,
    CloseIcon
  } from '$lib/components/icons';

  /**
   * @type {{
   *   pointer: import('nostr-tools/nip19').AddressPointer,
   *   aTagValue: string,
   *   communityPubkey?: string,
   *   targetHighlightId?: string | null
   * }}
   */
  let { pointer, aTagValue, communityPubkey = undefined, targetHighlightId = null } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // --- Article (the referenced kind-30023 event) ---
  const articleRelays = $derived([...new Set([...getArticleRelays(), ...getAllLookupRelays()])]);
  const getArticle = useReplaceableEvent(() => ({
    kind: pointer.kind,
    pubkey: pointer.pubkey,
    identifier: pointer.identifier,
    relays: articleRelays
  }));
  const articleState = $derived(getArticle());
  const article = $derived(articleState.event);

  const title = $derived(
    article ? getArticleTitle(article) || pointer.identifier : pointer.identifier
  );
  const image = $derived(article ? getArticleImage(article) : undefined);
  const summary = $derived.by(() => {
    const tag = article?.tags?.find((/** @type {string[]} */ t) => t[0] === 'summary');
    return tag?.[1] || '';
  });
  const htmlContent = $derived(
    article ? renderMarkdown(article.content, { headingAnchors: true }) : ''
  );
  const articleDate = $derived(article?.created_at ? formatRelativeTime(article.created_at) : '');
  const readMinutes = $derived.by(() => {
    if (!article?.content) return 0;
    const words = article.content.trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
  });
  const naddr = $derived(
    nip19.naddrEncode({
      kind: pointer.kind,
      pubkey: pointer.pubkey,
      identifier: pointer.identifier,
      relays: []
    })
  );
  const naddrShort = $derived(`${naddr.slice(0, 14)}…`);

  // --- Bookmark layer: savers (39701) + highlights (9802) for this coordinate ---
  let bookmarks = $state.raw(/** @type {any[]} */ ([]));
  let highlights = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (!aTagValue) return;

    bookmarks = [];
    highlights = [];

    const relays = [...new Set([...getArticleRelays(), ...getAllLookupRelays()])];
    /** @type {import('nostr-tools').Filter} */
    const filter = { kinds: [39701, 9802], '#a': [aTagValue] };

    const loader = createCachedTimelineLoader(relays, filter, { limit: 200 });
    const loaderSub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      const items = events || [];
      bookmarks = items.filter((e) => e.kind === 39701);
      highlights = items.filter((e) => e.kind === 9802);
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // --- Profiles for savers + highlighters + article author ---
  const allPubkeys = $derived.by(() => {
    /** @type {string[]} */
    const all = [...bookmarks.map((e) => e.pubkey), ...highlights.map((e) => e.pubkey)];
    if (article?.pubkey) all.push(article.pubkey);
    return all.filter((p, i) => all.indexOf(p) === i);
  });
  const getProfiles = useProfileMap(() => allPubkeys);
  const profiles = $derived(getProfiles());

  // Savers sorted newest first; the most recent one (preferring one with a note)
  // is featured in the context strip.
  const savers = $derived([...bookmarks].sort((a, b) => b.created_at - a.created_at));
  const featuredSaver = $derived(savers.find((b) => b.content?.trim()) || savers[0]);

  function saverName(/** @type {any} */ event) {
    const profile = profiles.get(event.pubkey);
    return profile ? getDisplayName(profile) : event.pubkey.slice(0, 8);
  }

  function pubkeyName(/** @type {string} */ pubkey) {
    const profile = profiles.get(pubkey);
    return profile ? getDisplayName(profile) : pubkey.slice(0, 8);
  }

  const authorName = $derived(article?.pubkey ? pubkeyName(article.pubkey) : '');

  let saversExpanded = $state(false);
  const shownSavers = $derived(saversExpanded ? savers : savers.slice(0, 3));

  // --- Highlights grouped by quote (so multiple highlighters of the same span
  // collapse into one row, like the design's `who[]`). ---
  const highlightGroups = $derived.by(() => {
    /** @type {Map<string, { id: string, quote: string, pubkeys: string[] }>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient grouping map, not reactive state
    const groups = new Map();
    for (const h of highlights) {
      const quote = (h.content || '').trim();
      if (!quote) continue;
      const existing = groups.get(quote);
      if (existing) {
        if (!existing.pubkeys.includes(h.pubkey)) existing.pubkeys.push(h.pubkey);
      } else {
        groups.set(quote, { id: h.id, quote, pubkeys: [h.pubkey] });
      }
    }
    return Array.from(groups.values());
  });

  // --- Per-saver bookmark discussions ---
  // Each saver's kind-39701 is its own addressable event with coordinate
  // `39701:<saverPubkey>:<dTag>`. NIP-22 comments that anchor to a specific
  // bookmark (rather than the article) carry that coordinate in #A (and the
  // bookmark event id in #E). We surface a comment indicator per saver row and
  // open a thread scoped to that bookmark.
  /** @param {any} saver */
  function saverCoordinate(saver) {
    const dTag = saver.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    return `39701:${saver.pubkey}:${dTag}`;
  }

  let bookmarkComments = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (savers.length === 0) {
      bookmarkComments = [];
      return;
    }
    const coords = savers.map(saverCoordinate);
    const ids = savers.map((s) => s.id);
    const relays = [...new Set([...getArticleRelays(), ...getAllLookupRelays()])];
    /** @type {import('nostr-tools').Filter[]} */
    const filters = [
      { kinds: [1111], '#A': coords },
      { kinds: [1111], '#E': ids }
    ];

    const loader = createCachedTimelineLoader(relays, filters, { limit: 200 });
    const loaderSub = loader().subscribe();
    const modelSub = eventStore.model(TimelineModel, filters).subscribe((events) => {
      bookmarkComments = events || [];
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // saver.id -> count of comments rooted on that saver's bookmark
  const saverCommentCounts = $derived.by(() => {
    /** @type {Map<string, string>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient lookup map
    const coordToSaver = new Map();
    /** @type {Map<string, string>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient lookup map
    const idToSaver = new Map();
    for (const saver of savers) {
      coordToSaver.set(saverCoordinate(saver), saver.id);
      idToSaver.set(saver.id, saver.id);
    }
    /** @type {Map<string, number>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient count map
    const counts = new Map();
    for (const c of bookmarkComments) {
      const a = c.tags?.find((/** @type {string[]} */ t) => t[0] === 'A')?.[1];
      const e = c.tags?.find((/** @type {string[]} */ t) => t[0] === 'E')?.[1];
      const saverId = (a && coordToSaver.get(a)) || (e && idToSaver.get(e));
      if (saverId) counts.set(saverId, (counts.get(saverId) || 0) + 1);
    }
    return counts;
  });

  // The saver bookmark whose comment thread is currently open in the modal.
  /** @type {any} */
  let activeCommentSaver = $state(null);

  /** @param {any} saver */
  function openSaverComments(saver) {
    activeCommentSaver = saver;
  }
  function closeSaverComments() {
    activeCommentSaver = null;
  }

  // --- Reactions on the article coordinate (shared canonical thread) ---
  let reactions = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (!article?.id) return;

    reactions = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map dedups reactions; SvelteMap in a subscription callback risks effect_update_depth_exceeded
    const seen = new Map();
    /** @type {import('rxjs').Subscription | undefined} */
    let loaderSub;

    const modelSub = eventStore.reactions(article).subscribe((events) => {
      let changed = false;
      for (const r of events || []) {
        if (!seen.has(r.id)) {
          seen.set(r.id, r);
          changed = true;
        }
      }
      if (changed) reactions = Array.from(seen.values());
    });

    const removeSub = eventStore.remove$.subscribe((removed) => {
      if (removed.kind === 7 && seen.has(removed.id)) {
        seen.delete(removed.id);
        reactions = Array.from(seen.values());
      }
    });

    const loaderTimer = setTimeout(() => {
      loaderSub = reactionsLoader(article).subscribe({
        error: (err) => console.error('SocialBookmarkDetailView: reactions load error', err)
      });
    }, 200);

    return () => {
      clearTimeout(loaderTimer);
      loaderSub?.unsubscribe();
      modelSub.unsubscribe();
      removeSub.unsubscribe();
    };
  });

  const likeCount = $derived(reactions.length);
  const myReaction = $derived.by(() => {
    if (!activeUser) return null;
    const agg = aggregateReactions(reactions, activeUser.pubkey);
    for (const summary of agg.values()) {
      if (summary.userReacted) return summary.userReactionEvent;
    }
    return null;
  });
  const liked = $derived(!!myReaction);
  const reactorPubkeys = $derived.by(() => {
    const all = reactions.map((r) => r.pubkey);
    return all.filter((p, i) => all.indexOf(p) === i);
  });

  // Heart opens the emoji picker so users can react with any emoji. If the user
  // already reacted, the heart removes their reaction instead.
  let showReactionPicker = $state(false);

  function toggleLike() {
    if (!activeUser) {
      showToast(m.bookmark_detail_login_required(), 'error');
      return;
    }
    if (liked && myReaction) {
      deleteReaction(myReaction, { relays: runtimeConfig.fallbackRelays || [] }).catch((err) => {
        console.error('Failed to remove reaction:', err);
        showToast(m.reactions_remove_error(), 'error');
      });
    } else {
      showReactionPicker = true;
    }
  }

  /** @param {string | { shortcode: string, url: string }} emoji */
  function handleReactionPick(emoji) {
    if (article) reactionsStore.react(article, emoji);
    showReactionPicker = false;
  }

  // --- Bookmark (Merken) toggle: create/delete the active user's own kind-39701 ---
  const myBookmark = $derived(
    activeUser ? bookmarks.find((b) => b.pubkey === activeUser.pubkey) : undefined
  );
  const saved = $derived(!!myBookmark);
  let saveBusy = $state(false);

  async function toggleSave() {
    if (!activeUser) {
      showToast(m.bookmark_detail_login_required(), 'error');
      return;
    }
    if (saveBusy) return;
    saveBusy = true;
    try {
      if (myBookmark) {
        const result = await deleteEvent(myBookmark, activeUser);
        if (!result.success) showToast(result.error || m.bookmark_detail_save_error(), 'error');
      } else {
        const signed = await createBookmarkEvent({
          url: '',
          title,
          description: '',
          communityPubkeys: communityPubkey ? [communityPubkey] : [],
          naddrData: {
            kind: pointer.kind,
            pubkey: pointer.pubkey,
            identifier: pointer.identifier
          },
          account: activeUser
        });
        publishEventOptimistic(signed);
      }
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
      showToast(m.bookmark_detail_save_error(), 'error');
    } finally {
      saveBusy = false;
    }
  }

  // Three-dot menu delete: scoped to the active user's own bookmark of this article.
  async function handleDeleteBookmark() {
    if (!myBookmark || !activeUser) return;
    const result = await deleteEvent(myBookmark, activeUser);
    if (!result.success) {
      showToast(result.error || m.event_delete_error(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
    showToast(m.event_delete_success(), 'success');
  }

  // Standalone "copy link" button (separate from the ShareMenu dropdown).
  async function copyLink() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast(m.bookmark_detail_share_copied(), 'success');
    } catch {
      // clipboard unavailable — ignore
    }
  }

  // --- Merken dropdown: public social bookmark (39701) + personal NIP-51 lists ---
  let saveMenuOpen = $state(false);
  let showNewSetInput = $state(false);
  let newSetName = $state('');
  /** @type {HTMLInputElement | undefined} */
  let newSetInputEl = $state();
  /** @type {HTMLDetailsElement | undefined} */
  let saveMenuEl = $state();

  // Close the dropdown when clicking outside it (<details> doesn't do this natively).
  $effect(() => {
    if (!saveMenuOpen) return;
    /** @param {MouseEvent} e */
    const onPointerDown = (e) => {
      if (saveMenuEl && !saveMenuEl.contains(/** @type {Node} */ (e.target))) {
        saveMenuOpen = false;
        showNewSetInput = false;
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  const listSets = $derived(
    getBookmarkSets().toSorted((/** @type {any} */ a, /** @type {any} */ b) =>
      getBookmarkSetTitle(a).localeCompare(getBookmarkSetTitle(b))
    )
  );
  const inDefaultList = $derived(article ? isBookmarked(article) : false);
  const savedAnywhere = $derived(
    saved || inDefaultList || (article ? listSets.some((s) => isInBookmarkSet(article, s)) : false)
  );

  /**
   * @param {string} [identifier]
   * @param {string} [setName]
   */
  function toggleListBookmark(identifier, setName) {
    if (!activeUser) {
      showToast(m.bookmark_detail_login_required(), 'error');
      return;
    }
    if (!article) return;
    const isIn =
      identifier === undefined
        ? isBookmarked(article)
        : listSets.some(
            (s) => getBookmarkSetIdentifier(s) === identifier && isInBookmarkSet(article, s)
          );
    const action = isIn ? removeFromList(article, identifier) : addToList(article, identifier);
    action.catch((err) => {
      console.error('SocialBookmarkDetailView: list bookmark failed', err);
      showToast(m.bookmark_toast_error(), 'error');
    });
    if (isIn) {
      showToast(
        setName ? m.bookmark_dropdown_removed_from_set({ setName }) : m.bookmark_toast_removed(),
        'info'
      );
    } else {
      showToast(
        setName ? m.bookmark_dropdown_added_to_set({ setName }) : m.bookmark_toast_saved(),
        'success'
      );
    }
  }

  async function showNewSet() {
    showNewSetInput = true;
    await tick();
    newSetInputEl?.focus();
  }

  async function createAndBookmark() {
    const name = newSetName.trim();
    if (!name || !article) return;
    try {
      await createBookmarkSetAndBookmark(article, name);
      showToast(m.bookmark_dropdown_set_created({ setName: name }), 'success');
    } catch (err) {
      console.error('SocialBookmarkDetailView: create set failed', err);
      showToast(m.bookmark_toast_error(), 'error');
    }
    saveMenuOpen = false;
    showNewSetInput = false;
    newSetName = '';
  }

  /** @param {KeyboardEvent} e */
  function handleNewSetKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      createAndBookmark();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      showNewSetInput = false;
      newSetName = '';
    }
  }

  // --- Table of contents from rendered headings ---
  const toc = $derived.by(() => {
    if (!htmlContent || typeof document === 'undefined') return [];
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    return Array.from(doc.querySelectorAll('h2[id], h3[id]')).map((el) => ({
      id: el.id,
      label: el.textContent?.trim() || '',
      level: el.tagName === 'H3' ? 3 : 2
    }));
  });

  /** @param {string} id */
  function scrollToHeading(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --- Reading progress + active section (scroll-driven) ---
  let progress = $state(0);
  let activeSection = $state('');
  /** @type {HTMLElement | undefined} */
  let articleEl = $state();

  $effect(() => {
    if (typeof window === 'undefined') return;
    // re-run when toc populates so the section ids exist
    void toc;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (articleEl) {
          const r = articleEl.getBoundingClientRect();
          const total = r.height - window.innerHeight;
          progress = total > 0 ? Math.min(100, Math.max(0, (-r.top / total) * 100)) : 0;
        }
        let cur = toc[0]?.id || '';
        for (const s of toc) {
          const el = document.getElementById(s.id);
          if (el && el.getBoundingClientRect().top < 140) cur = s.id;
        }
        activeSection = cur;
      });
    };
    // Capture phase so scrolls from the inner overflow container (the app's
    // <main>, not the window) also drive progress + active-section tracking.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    onScroll();
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  });

  // --- Jump to an inline highlight mark from the Markierungen panel ---
  /** @param {string} highlightId */
  function jumpToHighlight(highlightId) {
    const mark = /** @type {HTMLElement | null} */ (
      document.querySelector(`mark[data-highlight-ids*="${highlightId}"]`)
    );
    if (!mark) return;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.classList.add('bm-highlight-flash');
    setTimeout(() => mark.classList.remove('bm-highlight-flash'), 1300);
  }
</script>

<div class="mx-auto w-full max-w-6xl">
  {#if articleState.loading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if !article}
    <div class="p-4">
      <div class="py-12 text-center text-base-content/60">
        <p>{m.bookmark_detail_article_unavailable()}</p>
      </div>
    </div>
  {:else}
    <!-- Context strip -->
    {#if featuredSaver}
      <div class="border-b border-base-300 bg-base-200/40">
        <div class="flex items-start gap-4 px-4 py-4">
          <span
            class="flex h-11 w-11 flex-shrink-0 place-items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <BookmarkIcon class_="h-5 w-5" filled />
          </span>
          <div class="min-w-0 flex-1">
            <span
              class="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
            >
              <BookmarkIcon class_="h-3 w-3" />
              {m.bookmark_detail_eyebrow()}
            </span>
            <p class="mt-1 text-sm text-base-content">
              <a
                href={resolve(profileLink(featuredSaver.pubkey))}
                class="font-bold hover:underline"
              >
                {saverName(featuredSaver)}
              </a>
              {#if savers.length > 1}
                {m
                  .bookmark_detail_lead_network({ name: '', count: savers.length - 1 })
                  .replace(/^\s+/, '')}
              {:else}
                {m.bookmark_detail_lead_solo({ name: '' }).replace(/^\s+/, '')}
              {/if}
            </p>
            {#if featuredSaver.content?.trim()}
              <p class="mt-1.5 font-serif text-base text-base-content/70 italic">
                &ldquo;{featuredSaver.content.trim()}&rdquo;
              </p>
            {/if}
          </div>
          <div class="hidden flex-shrink-0 items-center sm:flex">
            {#each savers.slice(0, 4) as saver, i (saver.id)}
              <div class={i > 0 ? '-ml-2' : ''}>
                <ProfileAvatar
                  pubkey={saver.pubkey}
                  profile={profiles.get(saver.pubkey)}
                  size="sm"
                  linkToProfile
                  fallbackType="robohash"
                  class="ring-2 ring-base-100"
                />
              </div>
            {/each}
            {#if savers.length > 4}
              <span
                class="-ml-2 flex h-8 w-8 place-items-center justify-center rounded-full bg-base-300 text-xs font-semibold text-base-content/60 ring-2 ring-base-100"
              >
                +{savers.length - 4}
              </span>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <div class="flex flex-col gap-8 p-4 lg:flex-row">
      <!-- Left rail: TOC + progress + action rail -->
      <aside class="hidden lg:block lg:w-48 lg:flex-shrink-0">
        <div class="lg:sticky lg:top-20">
          {#if toc.length > 0}
            <h2 class="mb-3 text-xs font-bold tracking-[0.13em] text-base-content/50 uppercase">
              {m.bookmark_detail_contents()}
            </h2>
            <ul class="flex flex-col">
              {#each toc as item (item.id)}
                <li>
                  <button
                    type="button"
                    onclick={() => scrollToHeading(item.id)}
                    class="block w-full truncate border-l-2 py-1.5 text-left text-sm transition-colors hover:text-base-content {activeSection ===
                    item.id
                      ? 'border-primary font-semibold text-base-content'
                      : 'border-base-300 text-base-content/60'}"
                    class:pl-3={item.level === 2}
                    class:pl-6={item.level === 3}
                  >
                    {item.label}
                  </button>
                </li>
              {/each}
            </ul>
            <div class="mt-5 h-1 overflow-hidden rounded-full bg-base-300">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-100"
                style:width="{progress}%"
              ></div>
            </div>
          {/if}

          <div class="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onclick={toggleLike}
              class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors {liked
                ? 'border-transparent bg-primary text-primary-content'
                : 'border-base-300 text-base-content/70 hover:text-base-content'}"
            >
              <HeartIcon class="h-4 w-4" filled={liked} />
              {likeCount}
            </button>
            <details
              bind:this={saveMenuEl}
              class="dropdown dropdown-end w-full"
              bind:open={saveMenuOpen}
            >
              <summary
                class="inline-flex w-full cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors {savedAnywhere
                  ? 'border-transparent bg-primary text-primary-content'
                  : 'border-base-300 text-base-content/70 hover:text-base-content'}"
              >
                <BookmarkIcon class_="h-4 w-4" filled={savedAnywhere} />
                {savedAnywhere ? m.bookmark_detail_saved() : m.bookmark_detail_save()}
              </summary>
              <ul
                class="dropdown-content menu z-20 mt-1 w-60 rounded-box bg-base-100 p-2 shadow-lg"
              >
                <!-- Public social bookmark (kind 39701) — feeds the "Gemerkt von" layer -->
                <li>
                  <button
                    type="button"
                    class="flex items-start gap-2"
                    onclick={() => toggleSave()}
                    disabled={saveBusy}
                  >
                    {#if saveBusy}
                      <span class="loading mt-0.5 loading-xs loading-spinner"></span>
                    {:else}
                      <BookmarkIcon class_="h-4 w-4 mt-0.5" filled={saved} />
                    {/if}
                    <span class="flex flex-1 flex-col text-left">
                      <span>{m.bookmark_detail_save_public()}</span>
                      <span class="text-[11px] font-normal text-base-content/50">
                        {m.bookmark_detail_save_public_hint()}
                      </span>
                    </span>
                    {#if saved}
                      <CheckIcon class_="h-4 w-4 mt-0.5 text-primary" />
                    {/if}
                  </button>
                </li>

                <div class="divider my-0"></div>
                <li class="menu-title px-2 py-1">
                  <span class="text-[11px] tracking-wide uppercase">
                    {m.bookmark_detail_lists_section()}
                  </span>
                  <span class="text-[11px] font-normal text-base-content/50 normal-case">
                    {m.bookmark_detail_lists_section_hint()}
                  </span>
                </li>

                <!-- Default personal list (kind 10003) -->
                <li>
                  <button type="button" onclick={() => toggleListBookmark(undefined)}>
                    {#if article && isBookmarkPending(article)}
                      <span class="loading loading-xs loading-spinner"></span>
                    {:else}
                      <BookmarkIcon class_="h-4 w-4" filled={inDefaultList} />
                    {/if}
                    {m.bookmark_dropdown_default_list()}
                  </button>
                </li>

                <!-- Named bookmark sets (kind 30003) -->
                {#each listSets as set (set.id)}
                  {@const identifier = getBookmarkSetIdentifier(set)}
                  {@const setTitle = getBookmarkSetTitle(set)}
                  {@const inSet = article ? isInBookmarkSet(article, set) : false}
                  <li>
                    <button type="button" onclick={() => toggleListBookmark(identifier, setTitle)}>
                      {#if article && isBookmarkPending(article, identifier)}
                        <span class="loading loading-xs loading-spinner"></span>
                      {:else}
                        <BookmarkIcon class_="h-4 w-4" filled={inSet} />
                      {/if}
                      {setTitle}
                    </button>
                  </li>
                {/each}

                <div class="divider my-0"></div>

                {#if showNewSetInput}
                  <li class="p-2">
                    <div class="flex gap-1">
                      <input
                        bind:this={newSetInputEl}
                        type="text"
                        class="input-bordered input input-sm min-w-0 flex-1"
                        placeholder={m.bookmark_dropdown_new_set_placeholder()}
                        bind:value={newSetName}
                        onkeydown={handleNewSetKeydown}
                      />
                      <button
                        class="btn btn-sm btn-primary"
                        onclick={createAndBookmark}
                        disabled={!newSetName.trim()}
                      >
                        <PlusIcon class_="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                {:else}
                  <li>
                    <button type="button" onclick={showNewSet}>
                      <PlusIcon class_="h-4 w-4" />
                      {m.bookmark_dropdown_new_set()}
                    </button>
                  </li>
                {/if}
              </ul>
            </details>
            <ShareMenu {title} />
          </div>
        </div>
      </aside>

      <!-- Center: article body with inline highlights -->
      <div class="min-w-0 flex-1">
        <article bind:this={articleEl}>
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              onclick={() => history.back()}
              class="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content"
            >
              <ChevronLeftIcon class_="h-4 w-4" />
              {m.social_bookmarks_bookmarks()}
            </button>
            <EventContextMenu
              event={article}
              onDelete={myBookmark ? handleDeleteBookmark : undefined}
              deleteTitle={m.social_bookmarks_delete_confirm_title()}
              deleteItemName={title}
            />
          </div>

          <h1
            class="mt-3 font-serif text-3xl leading-tight font-bold text-base-content sm:text-4xl"
          >
            {title}
          </h1>
          {#if summary}
            <p class="mt-4 font-serif text-lg leading-relaxed text-base-content/70">{summary}</p>
          {/if}

          <!-- Byline -->
          <div
            class="mt-6 flex items-center gap-3 border-y border-base-300 py-4 text-sm text-base-content/60"
          >
            <ProfileAvatar
              pubkey={article.pubkey}
              profile={profiles.get(article.pubkey)}
              size="md"
              fallbackType="robohash"
              linkToProfile
            />
            <div class="min-w-0">
              <a
                href={resolve(profileLink(article.pubkey))}
                class="block font-semibold text-base-content hover:underline"
              >
                {authorName}
              </a>
              <div class="mt-0.5 flex flex-wrap gap-3">
                {#if articleDate}
                  <span class="inline-flex items-center gap-1">
                    <CalendarIcon class_="h-3.5 w-3.5" />
                    {articleDate}
                  </span>
                {/if}
                {#if readMinutes > 0}
                  <span class="inline-flex items-center gap-1">
                    <ClockIcon class_="h-3.5 w-3.5" />
                    {m.bookmark_detail_read_time({ count: readMinutes })}
                  </span>
                {/if}
              </div>
            </div>
            <div class="flex-1"></div>
            <a
              href="/{naddr}"
              title={m.bookmark_detail_native_source()}
              class="hidden items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/60 px-2.5 py-1.5 font-mono text-xs text-base-content/60 hover:text-base-content sm:inline-flex"
            >
              <LightningIcon class_="h-3.5 w-3.5" />
              {naddrShort}
            </a>
          </div>

          {#if image}
            <div class="mt-6 aspect-[16/8] w-full overflow-hidden rounded-xl">
              <ImageWithFallback
                src={image}
                alt={title}
                fallbackType="article"
                size="hero"
                class="h-full w-full object-cover"
              />
            </div>
          {/if}

          <HighlightOverlay
            {htmlContent}
            {highlights}
            {profiles}
            source={{ kind: pointer.kind, pubkey: pointer.pubkey, identifier: pointer.identifier }}
            {activeUser}
            {communityPubkey}
            {targetHighlightId}
            class="prose prose-lg mt-8 max-w-none prose-a:text-primary prose-blockquote:border-primary/50 prose-pre:rounded-lg prose-pre:bg-base-200 prose-img:rounded-lg"
          />
        </article>

        <!-- Shared social: anchored to the article coordinate (canonical thread) -->
        <div class="mt-10">
          <!-- Anchor note -->
          <div
            class="flex items-start gap-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-base-content/70"
          >
            <span class="mt-0.5 flex-shrink-0 text-info">
              <InfoCircleIcon class_="h-4 w-4" />
            </span>
            <div>{m.bookmark_detail_anchor_note()}</div>
          </div>

          <!-- Reaction bar -->
          <div class="mt-6 flex items-center gap-3 border-y border-base-300 py-4">
            <button
              type="button"
              onclick={toggleLike}
              class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors {liked
                ? 'border-transparent bg-primary text-primary-content'
                : 'border-base-300 text-base-content/70 hover:text-base-content'}"
            >
              <HeartIcon class="h-4 w-4" filled={liked} />
              {likeCount}
            </button>
            {#if reactorPubkeys.length > 0}
              <div class="flex min-w-0 items-center gap-2">
                <div class="flex">
                  {#each reactorPubkeys.slice(0, 3) as pk, i (pk)}
                    <div class={i > 0 ? '-ml-2' : ''}>
                      <ProfileAvatar
                        pubkey={pk}
                        profile={profiles.get(pk)}
                        size="xs"
                        linkToProfile
                        fallbackType="robohash"
                        class="ring-2 ring-base-100"
                      />
                    </div>
                  {/each}
                </div>
                <span class="truncate text-sm text-base-content/60">
                  <a href={resolve(profileLink(reactorPubkeys[0]))} class="hover:underline"
                    >{pubkeyName(reactorPubkeys[0])}</a
                  >{reactorPubkeys.length > 1 ? ` & ${reactorPubkeys.length - 1}` : ''}
                </span>
              </div>
            {/if}
            <div class="flex-1"></div>
            <button
              type="button"
              onclick={copyLink}
              aria-label={m.bookmark_detail_copy_link()}
              title={m.bookmark_detail_copy_link()}
              class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
            >
              <LinkIcon class_="h-4 w-4" />
            </button>
          </div>

          <!-- Discussion -->
          <div class="mt-8">
            <h2 class="mb-4 text-2xl font-bold text-base-content">
              {m.bookmark_detail_discussion()}
            </h2>
            <CommentList rootEvent={article} {activeUser} {communityPubkey} />
          </div>
        </div>
      </div>

      <!-- Right rail: savers + highlights -->
      {#if savers.length > 0 || highlightGroups.length > 0}
        <aside class="lg:w-72 lg:flex-shrink-0">
          <div class="flex flex-col gap-4 lg:sticky lg:top-20">
            <!-- Gemerkt von -->
            {#if savers.length > 0}
              <div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
                <div
                  class="flex items-center gap-2 px-4 pt-4 pb-3 text-[11px] font-bold tracking-[0.1em] text-base-content/50 uppercase"
                >
                  <BookmarkIcon class_="h-3 w-3" />
                  {m.bookmark_detail_saved_by()}
                  <span
                    class="ml-auto rounded-full bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content"
                  >
                    {savers.length}
                  </span>
                </div>
                {#if savers.length > 1}
                  <div class="flex px-4 pb-3">
                    {#each savers.slice(0, 5) as saver, i (saver.id)}
                      <div class={i > 0 ? '-ml-1.5' : ''}>
                        <ProfileAvatar
                          pubkey={saver.pubkey}
                          profile={profiles.get(saver.pubkey)}
                          size="xs"
                          linkToProfile
                          fallbackType="robohash"
                          class="ring-2 ring-base-100"
                        />
                      </div>
                    {/each}
                    {#if savers.length > 5}
                      <span
                        class="-ml-1.5 flex h-7 w-7 place-items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/60 ring-2 ring-base-100"
                      >
                        +{savers.length - 5}
                      </span>
                    {/if}
                  </div>
                {/if}
                <ul class="border-t border-base-300">
                  {#each shownSavers as saver (saver.id)}
                    {@const commentCount = saverCommentCounts.get(saver.id) || 0}
                    <li class="flex gap-3 border-b border-base-300 px-4 py-3 last:border-b-0">
                      <ProfileAvatar
                        pubkey={saver.pubkey}
                        profile={profiles.get(saver.pubkey)}
                        size="xs"
                        fallbackType="robohash"
                        linkToProfile
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <a
                            href={resolve(profileLink(saver.pubkey))}
                            class="truncate text-sm font-semibold text-base-content hover:underline"
                          >
                            {saverName(saver)}
                          </a>
                          {#if saver.pubkey === article.pubkey}
                            <span
                              class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-primary uppercase"
                            >
                              {m.bookmark_detail_opener_tag()}
                            </span>
                          {/if}
                        </div>
                        <div class="mt-0.5 text-xs text-base-content/50">
                          {formatRelativeTime(saver.created_at)}
                        </div>
                        {#if saver.content?.trim()}
                          <p class="mt-1.5 font-serif text-sm text-base-content/80 italic">
                            &ldquo;{saver.content.trim()}&rdquo;
                          </p>
                        {/if}
                      </div>
                      <button
                        type="button"
                        onclick={() => openSaverComments(saver)}
                        aria-label={m.bookmark_detail_saver_comments_aria({
                          name: saverName(saver)
                        })}
                        title={m.bookmark_detail_saver_comments_aria({ name: saverName(saver) })}
                        class="inline-flex flex-shrink-0 items-center gap-1 self-start rounded-full border px-2 py-1 text-xs font-semibold transition-colors hover:border-primary hover:text-primary {commentCount >
                        0
                          ? 'border-base-300 text-base-content/60'
                          : 'border-transparent text-base-content/40'}"
                      >
                        <ChatTextIcon class_="h-3.5 w-3.5" />
                        {#if commentCount > 0}
                          {commentCount}
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if savers.length > 3}
                  <div class="px-4 py-3 text-center">
                    <button
                      type="button"
                      onclick={() => (saversExpanded = !saversExpanded)}
                      class="rounded-lg border border-base-300 px-3 py-1.5 text-sm font-medium hover:bg-base-200"
                    >
                      {saversExpanded
                        ? m.bookmark_detail_show_less()
                        : m.bookmark_detail_show_all({ count: savers.length })}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Markierungen -->
            {#if highlightGroups.length > 0}
              <div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
                <div
                  class="flex items-center gap-2 px-4 pt-4 pb-3 text-[11px] font-bold tracking-[0.1em] text-base-content/50 uppercase"
                >
                  <EditIcon class="h-3 w-3" />
                  {m.bookmark_detail_highlights_panel()}
                  <span
                    class="ml-auto rounded-full bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content"
                  >
                    {highlightGroups.length}
                  </span>
                </div>
                <ul class="border-t border-base-300">
                  {#each highlightGroups as group (group.id)}
                    <li class="border-b border-base-300 last:border-b-0">
                      <button
                        type="button"
                        onclick={() => jumpToHighlight(group.id)}
                        class="block w-full px-4 py-3 text-left transition-colors hover:bg-base-200"
                      >
                        <span
                          class="block border-l-2 border-warning pl-2.5 font-serif text-sm text-base-content/80 italic"
                        >
                          &ldquo;{group.quote}&rdquo;
                        </span>
                        <div class="mt-2 flex items-center gap-2 text-xs text-base-content/50">
                          <div class="flex">
                            {#each group.pubkeys.slice(0, 3) as pk, i (pk)}
                              <div class={i > 0 ? '-ml-1.5' : ''}>
                                <ProfileAvatar
                                  pubkey={pk}
                                  profile={profiles.get(pk)}
                                  size="2xs"
                                  fallbackType="robohash"
                                  class="ring-2 ring-base-100"
                                />
                              </div>
                            {/each}
                          </div>
                          <span class="truncate">
                            {group.pubkeys.map((pk) => pubkeyName(pk)).join(', ')}
                          </span>
                        </div>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </aside>
      {/if}
    </div>
  {/if}

  {#if showReactionPicker && article}
    <ReactionPicker
      event={article}
      onClose={() => (showReactionPicker = false)}
      onPick={handleReactionPick}
    />
  {/if}

  {#if activeCommentSaver}
    <div class="modal-open modal" role="dialog" aria-modal="true">
      <div class="modal-box max-w-2xl">
        <div class="mb-4 flex items-start gap-3">
          <ProfileAvatar
            pubkey={activeCommentSaver.pubkey}
            profile={profiles.get(activeCommentSaver.pubkey)}
            size="sm"
            fallbackType="robohash"
            linkToProfile
          />
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-lg font-bold text-base-content">
              {m.bookmark_detail_saver_comments_title({ name: saverName(activeCommentSaver) })}
            </h3>
            <p class="text-xs text-base-content/60">
              {m.bookmark_detail_saver_comments_subtitle()}
            </p>
          </div>
          <button
            type="button"
            onclick={closeSaverComments}
            aria-label={m.bookmark_detail_close()}
            class="btn btn-circle btn-ghost btn-sm"
          >
            <CloseIcon class_="h-4 w-4" />
          </button>
        </div>

        {#if activeCommentSaver.content?.trim()}
          <p
            class="mb-4 border-l-2 border-primary/50 pl-3 font-serif text-sm text-base-content/80 italic"
          >
            &ldquo;{activeCommentSaver.content.trim()}&rdquo;
          </p>
        {/if}

        <CommentList
          rootEvent={activeCommentSaver}
          {activeUser}
          {communityPubkey}
          extraRelays={articleRelays}
        />
      </div>
      <button
        type="button"
        class="modal-backdrop"
        aria-label={m.bookmark_detail_close()}
        onclick={closeSaverComments}
      ></button>
    </div>
  {/if}
</div>

<style>
  :global(mark.bm-highlight-flash) {
    animation: bm-hl-flash 1.3s ease;
  }
  @keyframes bm-hl-flash {
    0%,
    100% {
      background-color: oklch(0.9 0.1 95 / 0.4);
    }
    30%,
    60% {
      background-color: oklch(0.85 0.13 95 / 0.7);
      box-shadow: 0 0 0 3px oklch(0.72 0.15 78 / 0.6);
    }
  }
</style>
