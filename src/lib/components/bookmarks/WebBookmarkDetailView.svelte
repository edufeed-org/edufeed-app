<!--
  WebBookmarkDetailView — Unified detail page for a web-URL social bookmark.

  Mirrors SocialBookmarkDetailView's rich layout, but the "article" is fetched
  from the reader proxy (/api/reader) instead of a Nostr event, and the social
  layer is keyed by URL: savers (kind 39701) + highlights (kind 9802) grouped by
  the page URL, URL-rooted reactions (kind 17, NIP-73) and a URL-rooted NIP-22
  discussion. This is the non-Nostr-native counterpart to the event-ref view.
-->
<script>
  import { browser } from '$app/environment';
  import { tick } from 'svelte';
  import DOMPurify from 'dompurify';
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { createCachedTimelineLoader } from '$lib/loaders/base.js';
  import { createBookmarkEvent } from '$lib/helpers/bookmark.js';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { getAllLookupRelays, getArticleRelays } from '$lib/helpers/relay-helper.js';
  import { normalizeUrl, extractUrlFromEvent } from '$lib/helpers/urlGrouping.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import {
    isUrlBookmarked,
    isUrlInBookmarkSet,
    isUrlBookmarkPending,
    bookmarkUrl as addUrlToList,
    unbookmarkUrl as removeUrlFromList,
    createBookmarkSetAndBookmarkUrl,
    getBookmarkSets,
    getBookmarkSetTitle,
    getBookmarkSetIdentifier
  } from '$lib/stores/personal-bookmarks.svelte.js';
  import HighlightOverlay from '$lib/components/shared/HighlightOverlay.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import UrlReactionBar from '$lib/components/reactions/UrlReactionBar.svelte';
  import ShareMenu from '$lib/components/bookmarks/ShareMenu.svelte';
  import {
    BookmarkIcon,
    LinkIcon,
    ChevronLeftIcon,
    InfoCircleIcon,
    EditIcon,
    ExternalLinkIcon,
    ClockIcon,
    ChatTextIcon,
    CloseIcon,
    CheckIcon,
    PlusIcon
  } from '$lib/components/icons';

  /**
   * @type {{
   *   url: string,
   *   communityPubkey?: string,
   *   targetHighlightId?: string | null
   * }}
   */
  let { url, communityPubkey = undefined, targetHighlightId = null } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const normalizedUrl = $derived(url ? normalizeUrl(url) : '');
  const domain = $derived.by(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return normalizedUrl.split('/')[0];
    }
  });

  // --- Reader article (fetched HTML for the web page) ---
  let webArticle = $state(
    /** @type {{ title?: string, content?: string, byline?: string, siteName?: string } | null} */ (
      null
    )
  );
  let articleLoading = $state(false);
  let articleFailed = $state(false);

  $effect(() => {
    if (!url) return;
    articleLoading = true;
    articleFailed = false;
    webArticle = null;

    const ac = new AbortController();
    fetch(`/api/reader?url=${encodeURIComponent(url)}`, { signal: ac.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          articleFailed = true;
          articleLoading = false;
          return;
        }
        webArticle = data.article;
        articleLoading = false;
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          articleFailed = true;
          articleLoading = false;
        }
      });

    return () => ac.abort();
  });

  // Sanitize fetched HTML and inject heading ids so the TOC + scroll anchors work.
  const htmlContent = $derived.by(() => {
    if (!webArticle?.content || !browser) return '';
    const clean =
      typeof DOMPurify?.sanitize === 'function'
        ? DOMPurify.sanitize(webArticle.content, {
            ALLOWED_TAGS: [
              'p',
              'br',
              'strong',
              'em',
              'u',
              's',
              'del',
              'code',
              'pre',
              'a',
              'ul',
              'ol',
              'li',
              'blockquote',
              'h1',
              'h2',
              'h3',
              'h4',
              'h5',
              'h6',
              'hr',
              'table',
              'thead',
              'tbody',
              'tr',
              'th',
              'td',
              'img',
              'figure',
              'figcaption',
              'mark',
              'span',
              'div',
              'section'
            ],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class']
          })
        : webArticle.content;
    return injectHeadingIds(clean);
  });

  /** @param {string} html */
  function injectHeadingIds(html) {
    if (typeof document === 'undefined') return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient set for slug dedup
    const used = new Set();
    doc.querySelectorAll('h2, h3').forEach((el) => {
      if (el.id) {
        used.add(el.id);
        return;
      }
      const base =
        (el.textContent || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'section';
      let id = base;
      let n = 1;
      while (used.has(id)) id = `${base}-${++n}`;
      used.add(id);
      el.id = id;
    });
    return doc.body.innerHTML;
  }

  const readMinutes = $derived.by(() => {
    if (!webArticle?.content) return 0;
    const text = webArticle.content.replace(/<[^>]+>/g, ' ');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return words > 0 ? Math.max(1, Math.round(words / 200)) : 0;
  });

  // --- Bookmark layer: savers (39701) + highlights (9802) for this URL ---
  let bookmarks = $state.raw(/** @type {any[]} */ ([]));
  let highlights = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    if (!url || !normalizedUrl) return;

    bookmarks = [];
    highlights = [];

    const relays = [...new Set([...getArticleRelays(), ...getAllLookupRelays()])];
    /** @type {import('nostr-tools').Filter} */
    const filter = { kinds: [39701, 9802], '#r': [url, normalizedUrl] };

    const loader = createCachedTimelineLoader(relays, filter, { limit: 200 });
    const loaderSub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      const urlFiltered = (events || []).filter((event) => {
        const eventUrl = extractUrlFromEvent(event);
        return eventUrl && normalizeUrl(eventUrl) === normalizedUrl;
      });
      bookmarks = urlFiltered.filter((e) => e.kind === 39701);
      highlights = urlFiltered.filter((e) => e.kind === 9802);
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Title: prefer the reader title, then a bookmark's title tag, then the domain.
  const bookmarkTitle = $derived.by(() => {
    for (const b of bookmarks) {
      const t = b.tags?.find((/** @type {string[]} */ tag) => tag[0] === 'title');
      if (t?.[1]) return t[1];
    }
    return '';
  });
  const title = $derived(webArticle?.title || bookmarkTitle || domain);

  // --- Profiles for savers + highlighters ---
  const allPubkeys = $derived.by(() => {
    /** @type {string[]} */
    const all = [...bookmarks.map((e) => e.pubkey), ...highlights.map((e) => e.pubkey)];
    return all.filter((p, i) => all.indexOf(p) === i);
  });
  const getProfiles = useProfileMap(() => allPubkeys);
  const profiles = $derived(getProfiles());

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

  let saversExpanded = $state(false);
  const shownSavers = $derived(saversExpanded ? savers : savers.slice(0, 3));

  // --- Highlights grouped by quote ---
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
  // `39701:<saverPubkey>:<dTag>` (dTag = the URL without scheme). NIP-22
  // comments that anchor to a specific bookmark carry that coordinate in #A
  // (and the bookmark event id in #E).
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
          url,
          title,
          description: '',
          communityPubkeys: communityPubkey ? [communityPubkey] : [],
          account: activeUser
        });
        publishEventOptimistic(signed);
      }
    } catch (err) {
      console.error('WebBookmarkDetailView: failed to toggle bookmark', err);
      showToast(m.bookmark_detail_save_error(), 'error');
    } finally {
      saveBusy = false;
    }
  }

  async function handleDeleteBookmark() {
    if (!myBookmark || !activeUser) return;
    const result = await deleteEvent(myBookmark, activeUser);
    if (!result.success) {
      showToast(result.error || m.event_delete_error(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
    showToast(m.event_delete_success(), 'success');
  }

  // --- Merken dropdown: public social bookmark (39701) + personal NIP-51 lists ---
  // Web URLs live in NIP-51 lists as `r` tags (no Nostr event to reference).
  let saveMenuOpen = $state(false);
  let showNewSetInput = $state(false);
  let newSetName = $state('');
  /** @type {HTMLInputElement | undefined} */
  let newSetInputEl = $state();
  /** @type {HTMLDetailsElement | undefined} */
  let saveMenuEl = $state();

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
  const inDefaultList = $derived(url ? isUrlBookmarked(url) : false);
  const savedAnywhere = $derived(
    saved || inDefaultList || (url ? listSets.some((s) => isUrlInBookmarkSet(url, s)) : false)
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
    if (!url) return;
    const isIn =
      identifier === undefined
        ? isUrlBookmarked(url)
        : listSets.some(
            (s) => getBookmarkSetIdentifier(s) === identifier && isUrlInBookmarkSet(url, s)
          );
    const action = isIn ? removeUrlFromList(url, identifier) : addUrlToList(url, identifier);
    action.catch((err) => {
      console.error('WebBookmarkDetailView: list bookmark failed', err);
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
    if (!name || !url) return;
    try {
      await createBookmarkSetAndBookmarkUrl(url, name);
      showToast(m.bookmark_dropdown_set_created({ setName: name }), 'success');
    } catch (err) {
      console.error('WebBookmarkDetailView: create set failed', err);
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
    }
  }

  // EventContextMenu needs a Nostr event; use the user's own bookmark or any saver.
  const menuEvent = $derived(myBookmark || savers[0]);

  // Standalone "copy link" button (separate from the ShareMenu dropdown).
  async function copyLink() {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast(m.bookmark_detail_share_copied(), 'success');
    } catch {
      // clipboard unavailable — ignore
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
            <a href={resolve(profileLink(featuredSaver.pubkey))} class="font-bold hover:underline">
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
            <ul class="dropdown-content menu z-20 mt-1 w-60 rounded-box bg-base-100 p-2 shadow-lg">
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
                  {#if isUrlBookmarkPending(url)}
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
                {@const inSet = isUrlInBookmarkSet(url, set)}
                <li>
                  <button type="button" onclick={() => toggleListBookmark(identifier, setTitle)}>
                    {#if isUrlBookmarkPending(url, identifier)}
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
          {#if menuEvent}
            <EventContextMenu
              event={menuEvent}
              onDelete={myBookmark ? handleDeleteBookmark : undefined}
              deleteTitle={m.social_bookmarks_delete_confirm_title()}
              deleteItemName={title}
            />
          {/if}
        </div>

        <h1 class="mt-3 font-serif text-3xl leading-tight font-bold text-base-content sm:text-4xl">
          {title}
        </h1>

        <!-- Source meta -->
        <div
          class="mt-6 flex flex-wrap items-center gap-3 border-y border-base-300 py-4 text-sm text-base-content/60"
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 font-semibold text-base-content hover:text-primary"
          >
            <ExternalLinkIcon class_="h-4 w-4" />
            {webArticle?.siteName || domain}
          </a>
          {#if webArticle?.byline}
            <span class="truncate">{webArticle.byline}</span>
          {/if}
          {#if readMinutes > 0}
            <span class="inline-flex items-center gap-1">
              <ClockIcon class_="h-3.5 w-3.5" />
              {m.bookmark_detail_read_time({ count: readMinutes })}
            </span>
          {/if}
        </div>

        {#if articleLoading}
          <div class="mt-8 flex flex-col gap-3">
            <div class="h-4 w-full skeleton"></div>
            <div class="h-4 w-full skeleton"></div>
            <div class="h-4 w-5/6 skeleton"></div>
            <div class="h-4 w-full skeleton"></div>
            <div class="h-4 w-4/5 skeleton"></div>
          </div>
        {:else if articleFailed || !htmlContent}
          <div
            class="mt-8 flex items-start gap-3 rounded-lg border border-base-300 bg-base-200/50 p-4 text-sm text-base-content/70"
          >
            <span class="mt-0.5 flex-shrink-0 text-base-content/50">
              <InfoCircleIcon class_="h-4 w-4" />
            </span>
            <div>
              {m.web_bookmark_reader_unavailable()}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="ml-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                {m.bookmark_detail_open_article()}
                <ExternalLinkIcon class_="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        {:else}
          <HighlightOverlay
            {htmlContent}
            {highlights}
            {profiles}
            source={url}
            {activeUser}
            {communityPubkey}
            {targetHighlightId}
            class="prose prose-lg mt-8 max-w-none prose-a:text-primary prose-blockquote:border-primary/50 prose-pre:rounded-lg prose-pre:bg-base-200 prose-img:rounded-lg"
          />
        {/if}
      </article>

      <!-- Shared social: anchored to the URL (canonical thread) -->
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
          <UrlReactionBar {url} />
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
          <CommentList rootUrl={url} {activeUser} {communityPubkey} />
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
                      <a
                        href={resolve(profileLink(saver.pubkey))}
                        class="block truncate text-sm font-semibold text-base-content hover:underline"
                      >
                        {saverName(saver)}
                      </a>
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
                      aria-label={m.bookmark_detail_saver_comments_aria({ name: saverName(saver) })}
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
          extraRelays={[...new Set([...getArticleRelays(), ...getAllLookupRelays()])]}
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
