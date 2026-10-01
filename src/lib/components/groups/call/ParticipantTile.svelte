<!--
  ParticipantTile — one seat in a call: camera video (or avatar), speaking
  ring, mic-off / raised-hand badges, floating reactions, and for remote
  seats a per-person volume slider (0–200 %) and a pin button.

  It never plays audio: the call service attaches every remote audio track
  once, centrally, so a call drawn twice (the /c layout's twins, stage +
  dock) is still heard once.

  `pubkey` is resolved by the parent (groups/livekit.js identityToPubkey):
  a NIP-29 relay mints identities as `<64-hex>:<suffix>` so one user can sit
  in the room twice, and the raw identity is never a pubkey by itself.
-->

<script>
  import { Track, ParticipantEvent } from 'livekit-client';
  import { profileLink } from '$lib/helpers/nostrUtils';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import ProfileHoverCardContent from '$lib/components/shared/ProfileHoverCardContent.svelte';
  import { MicOffIcon, HandIcon, VolumeUpIcon, PinIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   participant: import('livekit-client').LocalParticipant | import('livekit-client').RemoteParticipant,
   *   pubkey?: string | null,
   *   isLocal?: boolean,
   *   isMicOff?: boolean,
   *   isSpeaking?: boolean,
   *   handRaised?: boolean,
   *   isGuest?: boolean,
   *   reactions?: Array<{id: string, emoji: string}>,
   *   profile?: any,
   *   volume?: number,
   *   onVolumeChange?: (volume: number) => void,
   *   pinned?: boolean,
   *   onTogglePin?: () => void,
   *   compact?: boolean
   * }}
   */
  let {
    participant,
    pubkey = null,
    isLocal = false,
    isMicOff = false,
    isSpeaking = false,
    handRaised = false,
    isGuest = false,
    reactions = [],
    profile = undefined,
    volume = 1,
    onVolumeChange = undefined,
    pinned = false,
    onTogglePin = undefined,
    compact = false
  } = $props();

  /** @type {import('livekit-client').Track | null} */
  let videoTrack = $state(null);
  let videoMuted = $state(true);

  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state(undefined);

  function updateTracks() {
    const cameraPub = participant.getTrackPublication(Track.Source.Camera);
    videoTrack = cameraPub?.track ?? null;
    videoMuted = cameraPub?.isMuted ?? true;
  }

  /** @type {string[]} */
  const events = $derived(
    isLocal
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
    updateTracks();
    for (const evt of events) {
      participant.on(/** @type {any} */ (evt), updateTracks);
    }
    return () => {
      for (const evt of events) {
        participant.off(/** @type {any} */ (evt), updateTracks);
      }
    };
  });

  $effect(() => {
    const el = videoEl;
    const track = videoTrack;
    if (!el || !track) return;
    track.attach(el);
    return () => track.detach(el);
  });

  let volumeOpen = $state(false);
  const volumePercent = $derived(Math.round(volume * 100));
  const showVolume = $derived(!isLocal && !!onVolumeChange && !compact);

  const fallbackName = $derived(pubkey ? pubkey.slice(0, 8) : 'Participant');
  const displayName = $derived(
    isLocal ? 'You' : profile ? getDisplayName(profile, fallbackName) : fallbackName
  );
  // A hover card + profile link only make sense for a resolved Nostr identity.
  const linkable = $derived(!!pubkey && !isLocal && !compact);
  const hasVideo = $derived(!!videoTrack && !videoMuted);
</script>

<div
  class="group/tile relative h-full min-h-0 transition-shadow duration-200"
  class:ring-2={isSpeaking}
  class:ring-primary={isSpeaking}
  class:rounded-lg={isSpeaking}
>
  <div
    class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg bg-base-300"
  >
    {#if hasVideo}
      <video
        bind:this={videoEl}
        autoplay
        playsinline
        muted
        class="h-full w-full object-cover"
        class:scale-x-[-1]={isLocal}
      ></video>
    {:else if !linkable}
      <div class="text-center">
        {#if pubkey}
          <ProfileAvatar
            {pubkey}
            {profile}
            size={compact ? 'sm' : 'lg'}
            showHoverCard={false}
            linkToProfile={false}
          />
        {:else}
          <div class="placeholder avatar">
            <div
              class="{isLocal
                ? 'bg-primary text-primary-content'
                : 'bg-secondary text-secondary-content'} w-12 rounded-full"
            >
              <span class="text-lg">?</span>
            </div>
          </div>
        {/if}
        {#if !compact}
          <p class="mt-1 text-xs text-base-content/60">{displayName}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Name overlay + hover card: OUTSIDE overflow-hidden -->
  {#if hasVideo}
    <div
      class="absolute right-0 bottom-0 left-0 z-10 truncate rounded-b-lg bg-gradient-to-t from-black/50 to-transparent px-2 py-1"
    >
      {#if linkable && pubkey}
        <HoverCard position="top" fixed={true}>
          {#snippet trigger()}
            <a href={profileLink(pubkey)} class="text-xs text-white hover:underline">
              {displayName}
            </a>
          {/snippet}
          {#snippet content()}
            <ProfileHoverCardContent {pubkey} {profile} />
          {/snippet}
        </HoverCard>
      {:else}
        <p class="truncate text-xs text-white">{displayName}</p>
      {/if}
    </div>
  {:else if linkable && pubkey}
    <div class="absolute inset-0 z-10 flex items-center justify-center">
      <HoverCard position="top" fixed={true}>
        {#snippet trigger()}
          <a href={profileLink(pubkey)} class="text-center">
            <ProfileAvatar
              {pubkey}
              {profile}
              size="lg"
              showHoverCard={false}
              linkToProfile={false}
            />
            <p class="mt-1 text-xs text-base-content/60">{displayName}</p>
          </a>
        {/snippet}
        {#snippet content()}
          <ProfileHoverCardContent {pubkey} {profile} />
        {/snippet}
      </HoverCard>
    </div>
  {/if}

  <!-- Status badges (top right) -->
  <div class="absolute top-1.5 right-1.5 z-20 flex items-center gap-1">
    {#if handRaised}
      <span
        class="badge badge-sm badge-warning"
        title={m.groups_call_hand_raised()}
        data-testid="call-tile-hand"
      >
        <HandIcon class_="h-3.5 w-3.5" title="" />
      </span>
    {/if}
    {#if isMicOff}
      <span class="badge badge-sm badge-neutral" title={m.groups_call_mic_off()}>
        <MicOffIcon class_="h-3.5 w-3.5" title="" />
      </span>
    {/if}
    {#if isGuest}
      <span class="badge badge-sm badge-info" data-testid="call-guest-badge">
        {m.groups_call_guest_badge()}
      </span>
    {/if}
  </div>

  <!-- Hover controls (top left): pin + volume -->
  {#if onTogglePin || showVolume}
    <div
      class="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100"
      class:opacity-100={volumeOpen || pinned}
    >
      {#if onTogglePin}
        <button
          class="btn btn-circle bg-base-100/80 btn-ghost btn-xs"
          class:text-primary={pinned}
          aria-label={pinned ? m.groups_call_unpin() : m.groups_call_pin()}
          title={pinned ? m.groups_call_unpin() : m.groups_call_pin()}
          onclick={onTogglePin}
        >
          <PinIcon class_="h-3.5 w-3.5" title="" />
        </button>
      {/if}
      {#if showVolume}
        <button
          class="btn btn-circle bg-base-100/80 btn-ghost btn-xs"
          class:text-warning={volume !== 1}
          aria-label={m.groups_call_volume()}
          aria-expanded={volumeOpen}
          title={`${m.groups_call_volume()} ${volumePercent} %`}
          onclick={() => (volumeOpen = !volumeOpen)}
        >
          <VolumeUpIcon class_="h-3.5 w-3.5" title="" />
        </button>
      {/if}
    </div>
    {#if volumeOpen && showVolume}
      <div
        class="absolute top-9 left-1.5 z-30 flex w-44 flex-col gap-1 rounded-box bg-base-100 p-2 shadow-lg"
      >
        <div class="flex items-center justify-between text-xs">
          <span>{m.groups_call_volume()}</span>
          <span class="tabular-nums">{volumePercent} %</span>
        </div>
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
        <button
          class="btn btn-ghost btn-sm"
          disabled={volume === 1}
          onclick={() => onVolumeChange?.(1)}
        >
          {m.groups_call_volume_reset()}
        </button>
      </div>
    {/if}
  {/if}

  <!-- Floating reactions -->
  {#each reactions as reaction (reaction.id)}
    <span class="call-reaction pointer-events-none absolute bottom-6 left-1/2 z-30 text-3xl">
      {reaction.emoji}
    </span>
  {/each}
</div>

<style>
  .call-reaction {
    animation: call-reaction-float 3.5s ease-out forwards;
  }
  @keyframes call-reaction-float {
    0% {
      opacity: 0;
      transform: translate(-50%, 0) scale(0.6);
    }
    10% {
      opacity: 1;
      transform: translate(-50%, -8px) scale(1.1);
    }
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -90px) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .call-reaction {
      animation: none;
    }
  }
</style>
