<!--
  CallParticipantRow — one line of the participant list: avatar, name,
  state badges and the row menu (pin, local volume, host extras). The
  camera state is read from the participant's own track publication and
  followed live, the same way ParticipantTile does; everything else comes
  from the stage through `row`.
-->
<script>
  import { Track, ParticipantEvent } from 'livekit-client';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import {
    MoreIcon,
    HandIcon,
    MicIcon,
    MicOffIcon,
    VideoIcon,
    PinIcon,
    VolumeUpIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   row: import('$lib/groups/call-participants.js').ParticipantRow,
   *   menuOpen: boolean,
   *   onToggleMenu: () => void,
   *   onTogglePin: () => void,
   *   onVolumeChange?: (volume: number) => void,
   *   menuExtras?: import('svelte').Snippet<[any]>
   * }}
   */
  let {
    row,
    menuOpen,
    onToggleMenu,
    onTogglePin,
    onVolumeChange = undefined,
    menuExtras = undefined
  } = $props();

  let cameraOn = $state(false);
  function updateCamera() {
    const pub = row.participant.getTrackPublication(Track.Source.Camera);
    cameraOn = !!pub?.track && !pub.isMuted;
  }
  /** @type {string[]} */
  const events = $derived(
    row.isLocal
      ? [
          ParticipantEvent.LocalTrackPublished,
          ParticipantEvent.LocalTrackUnpublished,
          ParticipantEvent.TrackMuted,
          ParticipantEvent.TrackUnmuted
        ]
      : [
          ParticipantEvent.TrackSubscribed,
          ParticipantEvent.TrackUnsubscribed,
          ParticipantEvent.TrackMuted,
          ParticipantEvent.TrackUnmuted
        ]
  );
  $effect(() => {
    const participant = row.participant;
    updateCamera();
    for (const evt of events) participant.on(/** @type {any} */ (evt), updateCamera);
    return () => {
      for (const evt of events) participant.off(/** @type {any} */ (evt), updateCamera);
    };
  });

  const fallbackName = $derived(row.pubkey ? row.pubkey.slice(0, 8) : 'Participant');
  const name = $derived(
    row.isLocal
      ? m.groups_call_tile_you()
      : row.profile
        ? getDisplayName(row.profile, fallbackName)
        : fallbackName
  );
  const volumePercent = $derived(Math.round(row.volume * 100));
  const micTitle = $derived(row.micOff ? m.groups_call_mic_off() : m.groups_call_mic_on());
  const cameraTitle = $derived(
    cameraOn ? m.groups_call_camera_on_badge() : m.groups_call_camera_off()
  );
</script>

<li
  class="relative flex items-center gap-2 rounded-lg px-2 py-1.5 {row.speaking
    ? 'bg-primary/10'
    : ''}"
  data-testid="call-participant-row"
  data-identity={row.participant.identity}
  data-speaking={row.speaking}
>
  {#if row.pubkey}
    <ProfileAvatar
      pubkey={row.pubkey}
      profile={row.profile}
      size="sm"
      showHoverCard={false}
      linkToProfile={false}
    />
  {:else}
    <div class="placeholder avatar">
      <div class="w-8 rounded-full bg-secondary text-secondary-content">
        <span class="text-sm">?</span>
      </div>
    </div>
  {/if}
  <div class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-sm" title={row.speaking ? m.groups_call_speaking() : undefined}>
      {name}
    </span>
    {#if row.guest || row.listenOnly}
      <span class="flex flex-wrap gap-1">
        {#if row.guest}
          <span class="badge badge-xs badge-info" data-testid="call-guest-badge">
            {m.groups_call_guest_badge()}
          </span>
        {/if}
        {#if row.listenOnly}
          <span class="badge badge-ghost badge-xs" data-testid="call-participant-listen-only">
            {m.groups_call_listen_only()}
          </span>
        {/if}
      </span>
    {/if}
  </div>
  <span class="flex shrink-0 items-center gap-1 text-base-content/70">
    {#if row.handRaised}
      <span
        class="text-warning"
        title={m.groups_call_hand_raised()}
        data-testid="call-participant-hand"
      >
        <HandIcon class_="h-4 w-4" title="" />
      </span>
    {/if}
    <span
      class={row.micOff ? 'text-base-content/40' : row.speaking ? 'text-primary' : ''}
      title={micTitle}
      data-testid="call-participant-mic"
    >
      {#if row.micOff}
        <MicOffIcon class_="h-4 w-4" title="" />
      {:else}
        <MicIcon class_="h-4 w-4" title="" />
      {/if}
    </span>
    <span
      class={cameraOn ? '' : 'text-base-content/30'}
      title={cameraTitle}
      data-testid="call-participant-camera"
    >
      <VideoIcon class_="h-4 w-4" title="" />
    </span>
  </span>
  <div class="relative shrink-0" data-participant-menu>
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-xs"
      aria-label={m.groups_call_participant_menu({ name })}
      title={m.groups_call_participant_menu({ name })}
      aria-expanded={menuOpen}
      onclick={onToggleMenu}
    >
      <MoreIcon class_="h-4 w-4" title="" />
    </button>
    {#if menuOpen}
      <ul
        class="menu absolute top-full right-0 z-30 mt-1 w-56 rounded-box bg-base-100 p-2 shadow-lg"
        data-testid="call-participant-menu"
      >
        <li>
          <button class="text-sm" class:text-primary={row.pinned} onclick={onTogglePin}>
            <PinIcon class_="h-4 w-4" title="" />
            {row.pinned ? m.groups_call_unpin() : m.groups_call_pin()}
          </button>
        </li>
        {#if onVolumeChange}
          <li class="flex-row items-center justify-between menu-title text-xs">
            <span class="flex items-center gap-1">
              <VolumeUpIcon class_="h-3.5 w-3.5" title="" />
              {m.groups_call_volume()}
            </span>
            <span class="tabular-nums">{volumePercent} %</span>
          </li>
          <li class="pointer-events-auto">
            <input
              type="range"
              class="range range-primary range-xs"
              min="0"
              max="200"
              step="5"
              value={volumePercent}
              aria-label={m.groups_call_volume()}
              oninput={(e) => onVolumeChange?.(Number(e.currentTarget.value) / 100)}
            />
          </li>
          <li>
            <button class="text-sm" disabled={row.volume === 1} onclick={() => onVolumeChange?.(1)}>
              {m.groups_call_volume_reset()}
            </button>
          </li>
        {/if}
        {@render menuExtras?.(row)}
      </ul>
    {/if}
  </div>
</li>
