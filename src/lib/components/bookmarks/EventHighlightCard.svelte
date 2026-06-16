<!--
  EventHighlightCard — Card for article/wiki highlight groups (a-tag based).
  Follows UrlCard's visual pattern but adapted for Nostr event references.
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getHighlightText } from 'applesauce-common/helpers';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';

  /**
   * @type {{
   *   group: import('$lib/helpers/urlGrouping.js').EventRefGroup,
   *   authorProfiles: Map<string, any>,
   *   communityPubkey?: string
   * }}
   */
  let { group, authorProfiles, communityPubkey } = $props();

  /** @type {any} */
  let resolvedEvent = $state(undefined);

  // Subscribe to EventStore for reactive title updates + load from network
  $effect(() => {
    const relays = [...new Set([...group.relayHints, ...getAllLookupRelays()])];

    // Load from network into EventStore
    const loaderSub = addressLoader({
      kind: group.kind,
      pubkey: group.pubkey,
      identifier: group.identifier,
      relays
    }).subscribe();

    // Subscribe reactively — fires when event arrives in EventStore
    const modelSub = eventStore
      .replaceable(group.kind, group.pubkey, group.identifier)
      .subscribe((event) => {
        if (event) resolvedEvent = event;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  const typeLabel = $derived(group.kind === 30818 ? 'Wiki' : 'Article');

  const title = $derived.by(() => {
    if (resolvedEvent) {
      const titleTag = resolvedEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'title');
      if (titleTag?.[1]) return titleTag[1];
    }
    // Humanize d-tag identifier as fallback
    return group.identifier.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  });

  const featuredHighlight = $derived(group.highlights[0]);
  const featuredHighlightText = $derived(
    featuredHighlight ? getHighlightText(featuredHighlight) : ''
  );

  function getAuthorName(/** @type {string} */ pubkey) {
    const profile = authorProfiles.get(pubkey);
    return profile ? getDisplayName(profile) : 'Unknown';
  }

  function handleClick() {
    // Route to the unified social-bookmark detail view, keyed by the target
    // event coordinate. The view renders the referenced article natively,
    // wrapped in savers/highlights + a shared discussion.
    const coordinate = encodeURIComponent(`${group.kind}:${group.pubkey}:${group.identifier}`);
    if (communityPubkey) {
      const npub = hexToNpub(communityPubkey);
      goto(resolve(`/c/${npub}/bookmarks/${coordinate}`));
    } else {
      goto(resolve(`/bookmarks/${coordinate}`));
    }
  }
</script>

<button
  onclick={handleClick}
  class="w-full cursor-pointer rounded-lg border border-base-300 bg-base-100 p-4 text-left shadow-sm transition-shadow hover:shadow-md"
>
  <!-- Contributor header -->
  {#if group.contributors.length > 0}
    <div class="mb-3 flex items-center gap-2">
      <div class="flex -space-x-1.5">
        {#each group.contributors.slice(0, 3) as pubkey (pubkey)}
          {@const profile = authorProfiles.get(pubkey)}
          <ProfileAvatar
            {pubkey}
            {profile}
            size="sm"
            fallbackType="robohash"
            class="ring-2 ring-base-100"
          />
        {/each}
      </div>
      <div class="min-w-0 flex-1">
        <span class="truncate text-sm font-medium text-base-content">
          {getAuthorName(group.contributors[0])}
          {#if group.contributors.length > 1}
            <span class="font-normal text-base-content/50">
              +{group.contributors.length - 1}
            </span>
          {/if}
        </span>
      </div>
    </div>
  {/if}

  <div class="flex flex-col gap-3">
    <!-- Title + type badge -->
    <div>
      <h3 class="line-clamp-2 text-sm font-semibold">{title}</h3>
      <div class="mt-1">
        <span class="badge badge-outline badge-sm">{typeLabel}</span>
      </div>
    </div>

    <!-- Featured highlight (yellow border) -->
    {#if featuredHighlightText}
      <div class="border-l-3 border-warning bg-warning/5 py-1 pl-3">
        <p class="line-clamp-3 text-xs text-base-content/80 italic">
          &ldquo;{featuredHighlightText}&rdquo;
        </p>
        <span class="text-xs text-base-content/50">
          {getAuthorName(featuredHighlight.pubkey)}
        </span>
      </div>
    {/if}

    <!-- Stats row -->
    <div class="flex items-center gap-3 text-xs text-base-content/50">
      {#if group.bookmarks?.length > 0}
        <div class="flex items-center gap-1">
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <span>{group.bookmarks.length}</span>
        </div>
      {/if}
      {#if group.highlights.length > 0}
        <div class="flex items-center gap-1">
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M9 11l3 3L22 4" />
          </svg>
          <span>{group.highlights.length}</span>
        </div>
      {/if}
    </div>
  </div>
</button>
