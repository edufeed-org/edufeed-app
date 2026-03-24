<!--
  EventHighlightCard — Card for article/wiki highlight groups (a-tag based).
  Follows UrlCard's visual pattern but adapted for Nostr event references.
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getHighlightText } from 'applesauce-common/helpers';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { nip19 } from 'nostr-tools';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';

  /**
   * @type {{
   *   group: import('$lib/helpers/urlGrouping.js').EventRefGroup,
   *   authorProfiles: Map<string, any>,
   *   communityPubkey: string
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
  const routePrefix = $derived(group.kind === 30818 ? 'wiki' : 'article');

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
    const npub = hexToNpub(communityPubkey);
    const naddr = nip19.naddrEncode({
      kind: group.kind,
      pubkey: group.pubkey,
      identifier: group.identifier,
      relays: group.relayHints.slice(0, 3)
    });
    goto(resolve(`/c/${npub}/${routePrefix}/${naddr}`));
  }
</script>

<button
  onclick={handleClick}
  class="card w-full cursor-pointer border border-base-300 bg-base-100 text-left shadow-sm transition-shadow hover:shadow-md"
>
  <div class="card-body gap-3 p-4">
    <!-- Header: title + type badge -->
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
    <div class="mt-auto flex items-center gap-3 text-xs text-base-content/50">
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
      <!-- Contributors avatars -->
      {#if group.contributors.length > 0}
        <div class="ml-auto flex -space-x-1.5">
          {#each group.contributors.slice(0, 3) as pubkey (pubkey)}
            {@const profile = authorProfiles.get(pubkey)}
            {@const avatar = profile ? getProfilePicture(profile) : null}
            {#if avatar}
              <div class="avatar">
                <div class="w-4 rounded-full ring-1 ring-base-100">
                  <img src={avatar} alt="" />
                </div>
              </div>
            {/if}
          {/each}
          {#if group.contributors.length > 3}
            <span class="pl-1 text-xs text-base-content/40">
              +{group.contributors.length - 3}
            </span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</button>
