<!--
  RoomCard — Displays a meet room with status, type badge, and join button.
-->

<script>
  import { isRoomActive, formatTimeRemaining, getRoomCoordinate } from '$lib/helpers/meet.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { useRoomPresence } from '$lib/hooks/useRoomPresence.svelte.js';
  import { MeetIcon, CopyIcon } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   room: import('$lib/helpers/meet.js').ParsedRoomEvent,
   *   authorProfile?: any,
   *   onJoin?: (room: import('$lib/helpers/meet.js').ParsedRoomEvent) => void
   * }}
   */
  let { room, authorProfile = null, onJoin } = $props();

  let active = $derived(isRoomActive(room.event));
  let hostName = $derived(authorProfile?.name || authorProfile?.display_name || '');

  // --- #1: Expiry countdown ---
  let tick = $state(0);
  /** @type {ReturnType<typeof setInterval> | null} */
  let countdownTimer = null;

  $effect(() => {
    if (active && room.expiration) {
      countdownTimer = setInterval(() => {
        tick++;
      }, 30_000);
      return () => {
        if (countdownTimer) clearInterval(countdownTimer);
      };
    }
  });

  const expiryText = $derived.by(() => {
    const _ = tick; // establish dependency
    if (!active || !room.expiration) return '';
    const remaining = formatTimeRemaining(room.expiration);
    if (!remaining) return '';
    if (remaining.hours === 0 && remaining.minutes === 0) return m.meet_ends_soon();
    if (remaining.hours > 0)
      return m.meet_ends_in_hours_minutes({
        hours: String(remaining.hours),
        minutes: String(remaining.minutes)
      });
    return m.meet_ends_in_minutes({ minutes: String(remaining.minutes) });
  });

  // --- #2: Share room link ---
  async function handleShare() {
    try {
      const naddr = encodeEventToNaddr(room.event);
      if (!naddr) return;
      const url = `${window.location.origin}/${naddr}`;

      if (navigator.share) {
        await navigator.share({ title: room.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast(m.meet_link_copied(), 'success');
      }
    } catch (err) {
      // User cancelled share dialog — ignore
      if (/** @type {Error} */ (err).name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    }
  }

  // --- #3: Presence indicators ---
  const getPresent = useRoomPresence(
    () => getRoomCoordinate(room.event),
    () => room.communityPubkey
  );

  const presencePubkeys = $derived(active ? getPresent() : []);
  const presenceDisplay = $derived(presencePubkeys.slice(0, 3));
</script>

<div class="card border border-base-300 bg-base-100 shadow-sm {active ? '' : 'opacity-60'}">
  <div class="card-body p-4">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <MeetIcon class_="w-5 h-5 text-primary" />
        <h3 class="card-title text-base">{room.name || 'Unnamed Room'}</h3>
      </div>
      <div class="flex items-center gap-1.5">
        {#if active}
          <button
            class="btn btn-circle btn-ghost btn-xs"
            onclick={handleShare}
            title={m.meet_share_room()}
          >
            <CopyIcon class_="w-3.5 h-3.5" />
          </button>
        {/if}
        <span class="badge badge-sm {room.type === 'audio' ? 'badge-secondary' : 'badge-primary'}">
          {room.type === 'audio' ? m.meet_room_type_audio() : m.meet_room_type_video()}
        </span>
        {#if active}
          <span class="badge badge-sm badge-success">{m.meet_active()}</span>
        {:else}
          <span class="badge badge-ghost badge-sm">{m.meet_ended()}</span>
        {/if}
      </div>
    </div>

    {#if room.summary}
      <p class="text-sm text-base-content/70">{room.summary}</p>
    {/if}

    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        {#if room.hostPubkey}
          <!-- #4: Host profile with hover card -->
          <div class="flex items-center gap-1.5">
            <ProfileAvatar
              pubkey={room.hostPubkey}
              size="xs"
              showHoverCard={true}
              linkToProfile={true}
            />
            {#if hostName}
              <span class="text-xs text-base-content/50"
                >{m.meet_hosted_by({ name: hostName })}</span
              >
            {/if}
          </div>
        {:else if hostName}
          <p class="text-xs text-base-content/50">{m.meet_hosted_by({ name: hostName })}</p>
        {/if}
      </div>

      {#if expiryText}
        <span class="text-xs text-base-content/50">{expiryText}</span>
      {/if}
    </div>

    <!-- #3: Presence indicators -->
    {#if active && presencePubkeys.length > 0}
      <div class="flex items-center gap-2">
        <div class="flex items-center -space-x-2">
          {#each presenceDisplay as pubkey (pubkey)}
            <ProfileAvatar {pubkey} size="xs" showHoverCard={true} linkToProfile={true} />
          {/each}
        </div>
        <span class="text-xs text-base-content/50">
          {m.meet_in_room({ count: String(presencePubkeys.length) })}
        </span>
      </div>
    {/if}

    {#if active && onJoin}
      <div class="mt-2 card-actions justify-end">
        <button class="btn btn-sm btn-primary" onclick={() => onJoin(room)}>
          {m.meet_join()}
        </button>
      </div>
    {/if}
  </div>
</div>
