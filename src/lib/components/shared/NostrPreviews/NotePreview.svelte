<!--
  NotePreview Component
  Fetches and displays a compact preview for note/nevent identifiers
  Collapses tall content with a "Show more" button
-->

<script>
  import { resolve } from '$app/paths';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { ChevronDownIcon } from '$lib/components/icons';
  import ProfileAvatar from '../ProfileAvatar.svelte';
  import NostrContentRenderer from '../NostrContentRenderer.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const MAX_DEPTH = 2;
  const COLLAPSED_HEIGHT_PX = 192; // max-h-48 = 12rem = 192px

  let { identifier, depth = 0 } = $props();

  /** @type {any} */
  let event = $state(null);
  let isLoading = $state(true);
  let expanded = $state(false);
  let isOverflowing = $state(false);

  /** @type {HTMLDivElement | undefined} */
  let contentEl = $state(undefined);

  const getUserProfile = useUserProfile(() => event?.pubkey);
  let authorProfile = $derived(getUserProfile());

  $effect(() => {
    if (depth >= MAX_DEPTH) {
      isLoading = false;
      return;
    }

    isLoading = true;

    fetchEventById(identifier)
      .then((e) => {
        event = e;
      })
      .catch(() => {
        // Event not found or network error — event stays null
      })
      .finally(() => {
        isLoading = false;
      });
  });

  // Detect whether the rendered content overflows the collapsed height
  $effect(() => {
    if (!contentEl || !event) return;
    // Re-check after a tick to allow content to render
    requestAnimationFrame(() => {
      if (contentEl) {
        isOverflowing = contentEl.scrollHeight > COLLAPSED_HEIGHT_PX;
      }
    });
  });
</script>

{#if isLoading}
  <div class="my-2 h-24 rounded-lg border border-base-300 bg-base-200/30 p-3">
    <span class="loading loading-xs loading-dots"></span>
  </div>
{:else if event}
  <div class="my-2">
    <a
      href={resolve(`/${identifier}`)}
      class="block rounded-lg border border-base-300 bg-base-200/30 p-3 transition-colors hover:bg-base-200/60"
    >
      <div class="flex items-start gap-2">
        <ProfileAvatar
          pubkey={event.pubkey}
          profile={authorProfile}
          size="xs"
          linkToProfile
          showHoverCard
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium">
              {getDisplayName(authorProfile) || `${event.pubkey.slice(0, 8)}...`}
            </span>
            <span class="text-xs text-base-content/50">
              {formatRelativeTime(event.created_at)}
            </span>
          </div>
          <div bind:this={contentEl} class="relative {expanded ? '' : 'max-h-48 overflow-hidden'}">
            <NostrContentRenderer
              {event}
              depth={depth + 1}
              class="prose-sm mt-1 max-w-none text-base-content/70"
            />
            {#if isOverflowing && !expanded}
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-base-200/90 to-transparent"
              ></div>
            {/if}
          </div>
        </div>
      </div>
    </a>
    {#if isOverflowing}
      <button
        class="mt-1 flex w-full items-center justify-center gap-1 rounded-b-lg py-1 text-xs text-base-content/60 transition-colors hover:text-base-content"
        onclick={() => (expanded = !expanded)}
      >
        {expanded ? m.common_show_less() : m.common_show_more()}
        <ChevronDownIcon class_="w-3 h-3 transition-transform {expanded ? 'rotate-180' : ''}" />
      </button>
    {/if}
  </div>
{:else}
  <span class="badge inline-flex items-center gap-1 badge-outline badge-info">
    📝 {identifier.slice(0, 12)}...
  </span>
{/if}
