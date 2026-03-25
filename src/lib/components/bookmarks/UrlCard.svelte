<!--
  UrlCard — URL-grouped card showing bookmark/highlight/page note preview
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getHighlightText } from 'applesauce-common/helpers';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { ExternalLinkIcon, BookmarkIcon } from '$lib/components/icons';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';

  /**
   * @type {{
   *   group: import('$lib/helpers/urlGrouping.js').UrlGroup,
   *   authorProfiles: Map<string, any>,
   *   communityPubkey?: string
   * }}
   */
  let { group, authorProfiles, communityPubkey } = $props();

  const domain = $derived.by(() => {
    try {
      const url = new URL(group.displayUrl);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return group.url.split('/')[0];
    }
  });

  const featuredHighlight = $derived(group.highlights[0]);
  const featuredHighlightText = $derived(
    featuredHighlight ? getHighlightText(featuredHighlight) : ''
  );
  const featuredPageNote = $derived(group.pageNotes[0]);

  function getAuthorName(/** @type {string} */ pubkey) {
    const profile = authorProfiles.get(pubkey);
    return profile ? getDisplayName(profile) : 'Unknown';
  }

  function handleClick() {
    if (communityPubkey) {
      const npub = hexToNpub(communityPubkey);
      const encodedUrl = encodeURIComponent(group.displayUrl);
      goto(resolve(`/c/${npub}/bookmarks/${encodedUrl}`));
    } else {
      // No community context — open the URL directly
      window.open(group.displayUrl, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<button
  onclick={handleClick}
  class="card w-full cursor-pointer border border-base-300 bg-base-100 text-left shadow-sm transition-shadow hover:shadow-md"
>
  <div class="card-body gap-3 p-4">
    <!-- Header: title + domain -->
    <div>
      <h3 class="line-clamp-2 text-sm font-semibold">{group.title}</h3>
      <div class="mt-1 flex items-center gap-1">
        <ExternalLinkIcon class_="w-3 h-3 text-base-content/40" />
        <span class="text-xs text-base-content/50">{domain}</span>
      </div>
    </div>

    {#if group.description}
      <p class="line-clamp-2 text-xs text-base-content/60">{group.description}</p>
    {/if}

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

    <!-- Featured page note (blue border) -->
    {#if featuredPageNote && !featuredHighlightText}
      <div class="border-l-3 border-info bg-info/5 py-1 pl-3">
        <p class="line-clamp-3 text-xs text-base-content/80">{featuredPageNote.content}</p>
        <span class="text-xs text-base-content/50">
          {getAuthorName(featuredPageNote.pubkey)}
        </span>
      </div>
    {/if}

    <!-- Stats row -->
    <div class="mt-auto flex items-center gap-3 text-xs text-base-content/50">
      {#if group.bookmarks.length > 0}
        <div class="flex items-center gap-1">
          <BookmarkIcon class_="w-3.5 h-3.5" />
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
      {#if group.pageNotes.length > 0}
        <div class="flex items-center gap-1">
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span>{group.pageNotes.length}</span>
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
