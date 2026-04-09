<!--
  ParticipantTile — Renders a single participant with video/audio track attachment.
  Listens to LiveKit participant events to attach/detach media tracks reactively.
-->

<script>
  import { nip19 } from 'nostr-tools';
  import { Track, ParticipantEvent } from 'livekit-client';
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
   *   profile?: any
   * }}
   */
  let {
    participant,
    isLocal = false,
    isMuted = false,
    isSpeaking = false,
    profile = undefined
  } = $props();

  /** @type {import('livekit-client').Track | null} */
  let videoTrack = $state(null);
  /** @type {import('livekit-client').Track | null} */
  let audioTrack = $state(null);

  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state(undefined);
  /** @type {HTMLAudioElement | undefined} */
  let audioEl = $state(undefined);

  function updateTracks() {
    videoTrack = participant.getTrackPublication(Track.Source.Camera)?.track ?? null;
    if (!isLocal) {
      audioTrack = participant.getTrackPublication(Track.Source.Microphone)?.track ?? null;
    }
  }

  const events = isLocal
    ? [ParticipantEvent.LocalTrackPublished, ParticipantEvent.LocalTrackUnpublished]
    : [ParticipantEvent.TrackSubscribed, ParticipantEvent.TrackUnsubscribed];

  // Setup listeners + initial track state; cleanup on destroy
  $effect(() => {
    updateTracks();
    for (const evt of events) {
      participant.on(evt, updateTracks);
    }
    return () => {
      for (const evt of events) {
        participant.off(evt, updateTracks);
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

  const displayName = $derived(
    isLocal
      ? 'You'
      : profile
        ? getDisplayName(profile, participant?.identity?.slice(0, 8) || 'Participant')
        : participant?.identity?.slice(0, 8) || 'Participant'
  );
</script>

<div
  class="relative aspect-video transition-shadow duration-200"
  class:ring-2={isSpeaking}
  class:ring-primary={isSpeaking}
>
  <!-- Inner: overflow-hidden for video/avatar rounding -->
  <div
    class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg bg-base-200"
  >
    {#if videoTrack}
      <video
        bind:this={videoEl}
        autoplay
        playsinline
        muted={isLocal}
        class="h-full w-full object-cover"
        class:scale-x-[-1]={isLocal}
      />
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
  {#if videoTrack}
    <div
      class="absolute right-0 bottom-0 left-0 z-10 rounded-b-lg bg-gradient-to-t from-black/50 to-transparent px-2 py-1"
    >
      {#if participant?.identity && !isLocal}
        <HoverCard position="top" fixed={true}>
          {#snippet trigger()}
            <a
              href="/p/{nip19.npubEncode(participant.identity)}"
              class="text-xs text-white hover:underline"
            >
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
  {#if !videoTrack && participant?.identity && !isLocal}
    <div class="absolute inset-0 z-10 flex items-center justify-center">
      <HoverCard position="top" fixed={true}>
        {#snippet trigger()}
          <a href="/p/{nip19.npubEncode(participant.identity)}" class="text-center">
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

  {#if !isLocal}
    <audio bind:this={audioEl} autoplay />
  {/if}
</div>
