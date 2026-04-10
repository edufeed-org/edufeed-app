<!--
  NotePreview Component
  Fetches and displays a compact preview for note/nevent identifiers
-->

<script>
  import { resolve } from '$app/paths';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import ProfileAvatar from '../ProfileAvatar.svelte';
  import NostrContentRenderer from '../NostrContentRenderer.svelte';

  const MAX_DEPTH = 2;

  let { identifier, depth = 0 } = $props();

  /** @type {any} */
  let event = $state(null);
  let isLoading = $state(true);

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
</script>

{#if isLoading}
  <div class="my-2 rounded-lg border border-base-300 bg-base-200/30 p-3">
    <span class="loading loading-xs loading-dots"></span>
  </div>
{:else if event}
  <a
    href={resolve(`/${identifier}`)}
    class="my-2 block rounded-lg border border-base-300 bg-base-200/30 p-3 transition-colors hover:bg-base-200/60"
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
        <NostrContentRenderer
          {event}
          depth={depth + 1}
          class="prose-sm mt-1 max-w-none text-base-content/70"
        />
      </div>
    </div>
  </a>
{:else}
  <span class="badge inline-flex items-center gap-1 badge-outline badge-info">
    📝 {identifier.slice(0, 12)}...
  </span>
{/if}
