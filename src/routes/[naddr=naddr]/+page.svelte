<script>
  import * as m from '$lib/paraglide/messages';
  import ArticleView from '$lib/components/article/ArticleView.svelte';
  import AMBResourceView from '$lib/components/educational/AMBResourceView.svelte';
  import KanbanBoardView from '$lib/components/kanban/KanbanBoardView.svelte';
  import WikiView from '$lib/components/wiki/WikiView.svelte';
  import PublicationView from '$lib/components/publication/PublicationView.svelte';
  import BookmarkSetView from '$lib/components/bookmarks/BookmarkSetView.svelte';
  import NIP51ListDetailView from '$lib/components/shared/NIP51ListDetailView.svelte';
  import ReaderView from '$lib/components/bookmarks/ReaderView.svelte';
  import BookmarkItem from '$lib/components/bookmarks/BookmarkItem.svelte';
  import { ExternalLinkIcon } from '$lib/components/icons';
  import { formatAMBResource } from '$lib/helpers/educational';
  import { extractUrlFromEvent } from '$lib/helpers/urlGrouping.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';

  /** @type {{ data: any }} */
  let { data } = $props();

  let readerFailed = $state(false);

  const getActiveUser = useActiveUser();
  const getProfiles = useProfileMap(() =>
    displayData?.type === 'bookmark' ? [data.event.pubkey] : []
  );

  // Transform event data based on kind
  const displayData = $derived.by(() => {
    if (!data.event) return null;

    // Long-form articles (kind 30023)
    if (data.kind === 30023) {
      return {
        type: 'article',
        event: data.event
      };
    }

    // AMB educational resource (kind 30142)
    if (data.kind === 30142) {
      return {
        type: 'amb',
        event: data.event,
        resource: formatAMBResource(data.event)
      };
    }

    // Scientific publication index (kind 30040, NKBIP-01)
    if (data.kind === 30040) {
      return {
        type: 'publication',
        event: data.event
      };
    }

    // Bookmark set (kind 30003)
    if (data.kind === 30003) {
      return {
        type: 'bookmarkSet',
        event: data.event
      };
    }

    // Kanban board (kind 30301)
    if (data.kind === 30301) {
      return {
        type: 'kanban',
        event: data.event
      };
    }

    // Wiki event (kind 30818 / NIP-54)
    if (data.kind === 30818) {
      return {
        type: 'wiki',
        event: data.event
      };
    }

    // Social bookmark (kind 39701)
    if (data.kind === 39701) {
      const rawUrl = extractUrlFromEvent(data.event);
      const url = rawUrl?.startsWith('http') ? rawUrl : rawUrl ? `https://${rawUrl}` : null;
      const title = data.event.tags?.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1];
      return { type: 'bookmark', event: data.event, url, title };
    }

    // NIP-51 lists (all kinds not already handled above — 30003 routes to BookmarkSetView)
    const nip51Kinds = [
      10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10015, 10030, 10050, 30000, 30002,
      30004, 30015, 30030, 39089
    ];
    if (nip51Kinds.includes(data.kind)) {
      return {
        type: 'nip51list',
        event: data.event
      };
    }

    // Unsupported kind
    return {
      type: 'unsupported',
      kind: data.kind
    };
  });

  // Derive page title based on content type
  const pageTitle = $derived.by(() => {
    if (displayData?.type === 'article') {
      const titleTag = data.event?.tags?.find((/** @type {any} */ t) => t[0] === 'title');
      return `${titleTag?.[1] || 'Article'} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'amb') {
      return `${/** @type {any} */ (displayData.resource)?.name || 'Educational Resource'} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'publication') {
      const pubTitle = getTagValue(displayData.event, 'title') || 'Publication';
      return `${pubTitle} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'kanban') {
      const boardTitle =
        getTagValue(displayData.event, 'title') ||
        getTagValue(displayData.event, 'name') ||
        'Kanban Board';
      return `${boardTitle} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'wiki') {
      const wikiTitle =
        getTagValue(displayData.event, 'title') || getTagValue(displayData.event, 'd') || 'Wiki';
      return `${wikiTitle} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'bookmarkSet') {
      const setTitle =
        getTagValue(displayData.event, 'title') ||
        getTagValue(displayData.event, 'd') ||
        'Bookmark Set';
      return `${setTitle} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'nip51list') {
      const listTitle =
        getTagValue(displayData.event, 'title') || getTagValue(displayData.event, 'd') || 'List';
      return `${listTitle} - ${runtimeConfig.appName}`;
    } else if (displayData?.type === 'bookmark') {
      return `${displayData.title || 'Bookmark'} - ${runtimeConfig.appName}`;
    }
    return `Content - ${runtimeConfig.appName}`;
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content="View content on {runtimeConfig.appName}" />
</svelte:head>

<div class="container mx-auto px-4 py-8">
  {#if displayData?.type === 'article'}
    <!-- Article Display -->
    <ArticleView event={displayData.event} />
  {:else if displayData?.type === 'amb'}
    <!-- AMB Resource Display -->
    <AMBResourceView event={displayData.event} resource={displayData.resource} />
  {:else if displayData?.type === 'publication'}
    <!-- Scientific Publication -->
    <PublicationView event={displayData.event} />
  {:else if displayData?.type === 'kanban'}
    <!-- Kanban Board Preview -->
    <KanbanBoardView event={displayData.event} />
  {:else if displayData?.type === 'wiki'}
    <!-- Wiki Article -->
    <WikiView event={displayData.event} />
  {:else if displayData?.type === 'bookmarkSet'}
    <!-- Bookmark Set Detail -->
    <BookmarkSetView event={displayData.event} />
  {:else if displayData?.type === 'nip51list'}
    <!-- NIP-51 List Detail -->
    <NIP51ListDetailView event={displayData.event} />
  {:else if displayData?.type === 'bookmark'}
    <!-- Social Bookmark -->
    {#if displayData.url && !readerFailed}
      <ReaderView
        articleUrl={displayData.url}
        bookmarks={[displayData.event]}
        highlights={[]}
        profiles={getProfiles()}
        activeUser={getActiveUser()}
        onerror={() => (readerFailed = true)}
      />
    {:else}
      <div class="mx-auto max-w-2xl space-y-4">
        {#if displayData.url}
          <a
            href={displayData.url}
            target="_blank"
            rel="noopener noreferrer"
            class="btn gap-2 btn-primary"
          >
            <ExternalLinkIcon class_="w-4 h-4" />
            {displayData.url}
          </a>
        {/if}
        <BookmarkItem
          event={displayData.event}
          authorProfile={getProfiles().get(data.event.pubkey)}
          expanded={true}
          activeUser={getActiveUser()}
        />
      </div>
    {/if}
  {:else if displayData?.type === 'unsupported'}
    <!-- Unsupported Content Type -->
    <div class="alert alert-warning">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <div>
        <h3 class="font-bold">{m.route_unsupported_content()}</h3>
        <p class="text-sm">
          {m.route_unsupported_content_detail({ kind: displayData.kind })}
        </p>
      </div>
    </div>
  {:else}
    <!-- Loading or Error State -->
    <div class="alert alert-error">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{m.route_failed_load_content()}</span>
    </div>
  {/if}
</div>
