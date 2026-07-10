<!--
  NotePreview Component
  Fetches and displays a compact preview for note/nevent identifiers
  Collapses tall content with a "Show more" button
-->

<script>
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { ChevronDownIcon } from '$lib/components/icons';
  import ProfileAvatar from '../ProfileAvatar.svelte';
  import NostrContentRenderer from '../NostrContentRenderer.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const MAX_DEPTH = 2;
  const COLLAPSED_HEIGHT_PX = 192; // max-h-48 = 12rem = 192px
  // How long the skeleton shows before falling back to the badge. The store
  // subscription stays open, so a late arrival still upgrades the badge.
  const LOADING_TIMEOUT_MS = 8000;

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

  /**
   * Decode note/nevent identifier to an EventPointer. Relay hints from the
   * nevent are unioned with the lookup relays so the store's fallback loader
   * knows where to fetch from.
   * @param {string} id
   * @returns {{ id: string, relays?: string[] } | null}
   */
  function toEventPointer(id) {
    try {
      const decoded = nip19.decode(id);
      if (decoded.type === 'nevent') {
        const hints = decoded.data.relays?.length ? decoded.data.relays : [];
        return { id: decoded.data.id, relays: [...new Set([...hints, ...getAllLookupRelays()])] };
      }
      if (decoded.type === 'note') {
        return { id: decoded.data, relays: getAllLookupRelays() };
      }
    } catch {
      // fall through to null
    }
    return null;
  }

  // Reactive store subscription (issue #37): eventStore.event() auto-loads
  // missing events via the attached eventLoader and keeps emitting, so an
  // event arriving late (from the loader or any other surface) upgrades the
  // badge to the embedded card without a remount.
  $effect(() => {
    if (depth >= MAX_DEPTH) {
      isLoading = false;
      return;
    }

    const pointer = toEventPointer(identifier);
    if (!pointer) {
      isLoading = false;
      return;
    }

    isLoading = true;
    const sub = eventStore.event(pointer).subscribe((e) => {
      if (e) {
        event = e;
        isLoading = false;
      }
    });
    const timer = setTimeout(() => {
      isLoading = false;
    }, LOADING_TIMEOUT_MS);

    return () => {
      sub.unsubscribe();
      clearTimeout(timer);
    };
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
{:else if event && event.kind === 1068}
  <div class="my-2">
    <PollCard {event} truncate={true} />
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
