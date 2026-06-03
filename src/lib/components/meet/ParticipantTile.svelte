<!--
  ParticipantTile — Renders a single participant with video/audio track attachment.
  Listens to LiveKit participant events to attach/detach media tracks reactively.
-->

<script>
  import { Track, ParticipantEvent } from 'livekit-client';
  import { profileLink } from '$lib/helpers/nostrUtils';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import ProfileHoverCardContent from '$lib/components/shared/ProfileHoverCardContent.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   participant: import('livekit-client').LocalParticipant | import('livekit-client').RemoteParticipant,
   *   isLocal?: boolean,
   *   isMuted?: boolean,
   *   isSpeaking?: boolean,
   *   profile?: any,
   *   isRemoteMuted?: boolean,
   *   onToggleMute?: () => void
   * }}
   */
  let {
    participant,
    isLocal = false,
    isMuted = false,
    isSpeaking = false,
    profile = undefined,
    isRemoteMuted = false,
    onToggleMute = undefined
  } = $props();

  /** @type {import('livekit-client').Track | null} */
  let videoTrack = $state(null);
  let videoMuted = $state(true);
  /** @type {import('livekit-client').Track | null} */
  let audioTrack = $state(null);

  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state(undefined);
  /** @type {HTMLAudioElement | undefined} */
  let audioEl = $state(undefined);

  function updateTracks() {
    const cameraPub = participant.getTrackPublication(Track.Source.Camera);
    videoTrack = cameraPub?.track ?? null;
    videoMuted = cameraPub?.isMuted ?? true;
    if (!isLocal) {
      audioTrack = participant.getTrackPublication(Track.Source.Microphone)?.track ?? null;
    }
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

  // Setup listeners + initial track state; cleanup on destroy
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

  // Attach/detach video track
  $effect(() => {
    const el = videoEl;
    const track = videoTrack;
    if (!el || !track) return;
    track.attach(el);
    return () => track.detach(el);
  });

  // Attach/detach remote audio track
  $effect(() => {
    const el = audioEl;
    const track = audioTrack;
    if (!el || !track) return;
    track.attach(el);
    return () => track.detach(el);
  });

  // Apply local mute to audio element
  $effect(() => {
    const el = audioEl;
    if (!el) return;
    el.muted = isRemoteMuted;
  });

  const displayName = $derived(
    isLocal
      ? 'You'
      : profile
        ? getDisplayName(profile, participant?.identity?.slice(0, 8) || 'Participant')
        : participant?.identity?.slice(0, 8) || 'Participant'
  );
</script>

<div
  class="group/tile relative h-full min-h-0 transition-shadow duration-200"
  class:ring-2={isSpeaking}
  class:ring-primary={isSpeaking}
>
  <!-- Inner: overflow-hidden for video/avatar rounding -->
  <div
    class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg bg-base-200"
  >
    {#if videoTrack && !videoMuted}
      <video
        bind:this={videoEl}
        autoplay
        playsinline
        muted={isLocal}
        class="h-full w-full object-cover"
        class:scale-x-[-1]={isLocal}
      ></video>
    {:else}
      <div class="text-center">
        {#if participant?.identity}
          <ProfileAvatar
            pubkey={participant.identity}
            {profile}
            size="lg"
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
        <p class="mt-1 text-xs text-base-content/60">{displayName}</p>
      </div>
    {/if}
  </div>

  <!-- Name overlay + hover card: OUTSIDE overflow-hidden -->
  {#if videoTrack && !videoMuted}
    <div
      class="absolute right-0 bottom-0 left-0 z-10 rounded-b-lg bg-gradient-to-t from-black/50 to-transparent px-2 py-1"
    >
      {#if participant?.identity && !isLocal}
        <HoverCard position="top" fixed={true}>
          {#snippet trigger()}
            <a href={profileLink(participant.identity)} class="text-xs text-white hover:underline">
              {displayName}
            </a>
          {/snippet}
          {#snippet content()}
            <ProfileHoverCardContent pubkey={participant.identity} {profile} />
          {/snippet}
        </HoverCard>
      {:else}
        <p class="text-xs text-white">{displayName}</p>
      {/if}
    </div>
  {/if}

  <!-- Video-off hover card: OUTSIDE overflow-hidden -->
  {#if (!videoTrack || videoMuted) && participant?.identity && !isLocal}
    <div class="absolute inset-0 z-10 flex items-center justify-center">
      <HoverCard position="top" fixed={true}>
        {#snippet trigger()}
          <a href={profileLink(participant.identity)} class="text-center">
            <ProfileAvatar
              pubkey={participant.identity}
              {profile}
              size="lg"
              showHoverCard={false}
              linkToProfile={false}
            />
            <p class="mt-1 text-xs text-base-content/60">{displayName}</p>
          </a>
        {/snippet}
        {#snippet content()}
          <ProfileHoverCardContent pubkey={participant.identity} {profile} />
        {/snippet}
      </HoverCard>
    </div>
  {/if}

  {#if isLocal && isMuted}
    <span class="absolute top-2 right-2 z-10 badge badge-sm badge-error">
      {m.meet_mute()}
    </span>
  {/if}

  {#if !isLocal && isRemoteMuted}
    <span class="absolute top-2 right-2 z-10 badge badge-sm badge-warning">
      {m.meet_mute_participant()}
    </span>
  {/if}

  {#if !isLocal && onToggleMute}
    <button
      class="btn absolute right-1 bottom-1 z-10 btn-circle opacity-0 btn-ghost transition-opacity btn-xs group-hover/tile:opacity-100"
      class:opacity-100={isRemoteMuted}
      onclick={onToggleMute}
      title={isRemoteMuted ? m.meet_unmute_participant() : m.meet_mute_participant()}
    >
      {#if isRemoteMuted}
        <svg class="h-4 w-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
          />
        </svg>
      {:else}
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728"
          />
        </svg>
      {/if}
    </button>
  {/if}

  {#if !isLocal}
    <audio bind:this={audioEl} autoplay></audio>
  {/if}
</div>
