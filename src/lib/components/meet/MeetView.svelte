<!--
  MeetView — Community meet rooms view.
  Uses CommunityContentView for data loading, renders RoomCard for each room.
  When a room is joined, replaces the room list with the InRoomView.
-->

<script>
  import { getContext } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import CommunityContentView from '$lib/components/community/views/CommunityContentView.svelte';
  import { useMeetRoomLoader } from '$lib/loaders/community-content-loader.js';
  import { CommunityRoomModel } from '$lib/models/community-content.js';
  import { parseCommunityMetadata } from '$lib/helpers/communityRelays.js';
  import { isRoomActive, parseRoomEvent } from '$lib/helpers/meet.js';
  import { fetchEventById, encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import RoomCard from './RoomCard.svelte';
  import InRoomView from './InRoomView.svelte';
  import { PlusIcon, MeetIcon } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();

  const getCommunikeyEvent = getContext('communikeyEvent');
  let communikeyEvent = $derived(getCommunikeyEvent());

  let livekitUrl = $derived.by(() => {
    if (!communikeyEvent) return null;
    return parseCommunityMetadata(communikeyEvent).livekitUrl;
  });

  /** @type {import('$lib/helpers/meet.js').ParsedRoomEvent | null} */
  let joinedRoom = $state(null);

  /**
   * Handle joining a room — shows InRoomView inline
   * @param {import('$lib/helpers/meet.js').ParsedRoomEvent} room
   */
  function handleJoinRoom(room) {
    joinedRoom = room;
    autoJoinAttempted = true;
    const naddr = encodeEventToNaddr(room.event);
    if (naddr) {
      const url = new URL($page.url);
      url.searchParams.set('room', naddr);
      goto(url, { replaceState: true, noScroll: true });
    }
  }

  function handleLeaveRoom() {
    joinedRoom = null;
    // Clear room param from URL when leaving
    const url = new URL($page.url);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      goto(url, { replaceState: true, noScroll: true });
    }
  }

  // Auto-join room from ?room= query param on initial load (e.g. from shared link redirect)
  let autoJoinAttempted = false;
  $effect(() => {
    const roomNaddr = $page.url.searchParams.get('room');
    if (!roomNaddr || joinedRoom || autoJoinAttempted) return;
    autoJoinAttempted = true;

    (async () => {
      try {
        const event = await fetchEventById(roomNaddr);
        if (event && isRoomActive(event)) {
          const parsed = parseRoomEvent(event);
          if (parsed) joinedRoom = parsed;
        }
      } catch (err) {
        console.error('Failed to auto-join room:', err);
      }
    })();
  });

  /**
   * Sort rooms: active first, then by created_at descending
   * @param {any[]} items
   * @returns {any[]}
   */
  function sortRooms(items) {
    return [...items].sort((a, b) => {
      const aActive = isRoomActive(a.event);
      const bActive = isRoomActive(b.event);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (b.event?.created_at || 0) - (a.event?.created_at || 0);
    });
  }
</script>

{#if joinedRoom && livekitUrl}
  <div class="flex h-full flex-col">
    <InRoomView room={joinedRoom} {communityPubkey} {livekitUrl} onLeave={handleLeaveRoom} />
  </div>
{:else if !livekitUrl && communikeyEvent}
  <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
    <MeetIcon class_="h-12 w-12 text-base-content/30" />
    <div>
      <h3 class="text-lg font-semibold">{m.meet_not_configured_title()}</h3>
      <p class="mt-1 max-w-md text-sm text-base-content/60">
        {m.meet_not_configured_description()}
        <a
          href="/p/npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma"
          class="link link-primary"
        >
          @laoc42
        </a>
      </p>
    </div>
  </div>
{:else}
  <CommunityContentView
    {communityPubkey}
    {communityProfile}
    loaderHook={useMeetRoomLoader}
    model={CommunityRoomModel}
    loadingText={m.common_loading()}
    emptyTitle={m.meet_no_rooms()}
    emptyDescription={m.meet_no_rooms_description()}
    formatCount={(count) => m.meet_participants({ count })}
    emptyIconPath="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
  >
    {#snippet headerAction()}
      {#if manager.active && livekitUrl}
        <button
          class="btn gap-1 btn-sm btn-primary"
          onclick={() =>
            modalStore.openModal('createRoom', {
              communityPubkey,
              livekitUrl
            })}
        >
          <PlusIcon class_="h-4 w-4" />
          {m.meet_create_room()}
        </button>
      {/if}
    {/snippet}

    {#snippet content(items, authorProfiles)}
      {@const sorted = sortRooms(items)}
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each sorted as room (room.event?.id || room.id)}
          <RoomCard
            {room}
            authorProfile={authorProfiles.get(room.hostPubkey || room.event?.pubkey) || null}
            onJoin={handleJoinRoom}
          />
        {/each}
      </div>
    {/snippet}
  </CommunityContentView>
{/if}
