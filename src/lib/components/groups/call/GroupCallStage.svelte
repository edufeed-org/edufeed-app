<!--
  GroupCallStage — the in-call audio/video UI hosted in a channel's stage
  slot (the same slot GroupAppStage takes for a shared webxdc session).

  Protocol-agnostic on purpose: it is handed a LiveKit token + server url
  and an identity→pubkey resolver, connects on mount and disconnects on
  unmount. Who minted the token — a NIP-29 relay today (groups/group-call),
  a CORD-07 broker later — is the parent's business.
-->

<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import {
    connectToRoom,
    disconnectFromRoom,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    getLiveKitState,
    refreshAudioDevices,
    switchAudioDevice,
    switchAudioOutputDevice,
    refreshVideoDevices,
    switchVideoDevice
  } from '$lib/services/livekit-connection.svelte.js';
  import { Track } from 'livekit-client';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { MeetIcon, ChevronDownIcon, VolumeUpIcon } from '$lib/components/icons';
  import ParticipantTile from './ParticipantTile.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   token: string,
   *   serverUrl: string,
   *   title: string,
   *   identityToPubkey: (identity: string) => string | null,
   *   video?: boolean,
   *   onLeave: () => void
   * }}
   */
  let { token, serverUrl, title, identityToPubkey, video = true, onLeave } = $props();

  const lk = getLiveKitState();
  let error = $state(/** @type {string | null} */ (null));

  /** @param {{identity?: string} | null | undefined} participant */
  function pubkeyOf(participant) {
    return participant?.identity ? identityToPubkey(participant.identity) : null;
  }

  // Profile map for participant tiles, keyed by resolved pubkey.
  const getProfiles = useProfileMap(() => {
    /** @type {string[]} */
    const pks = [];
    const local = pubkeyOf(lk.localParticipant);
    if (local) pks.push(local);
    for (const p of lk.remoteParticipants) {
      const pk = pubkeyOf(p);
      if (pk) pks.push(pk);
    }
    return pks;
  });

  // Tracks whether leave was initiated via the button (prevents double-disconnect in cleanup)
  let leaving = false;

  // Connect on mount with the credentials we were handed — untracked so a
  // parent re-render never reconnects a live call.
  $effect(() => {
    const jwt = untrack(() => token);
    const url = untrack(() => serverUrl);
    const withVideo = untrack(() => video);

    (async () => {
      try {
        await connectToRoom(jwt, url, { video: withVideo, audio: true });
      } catch (err) {
        console.error('Failed to join call:', err);
        error = err instanceof Error ? err.message : m.groups_call_connection_error();
      }
    })();

    return () => {
      if (!leaving) disconnectFromRoom();
    };
  });

  async function handleLeave() {
    leaving = true;
    await disconnectFromRoom();
    onLeave();
  }

  // --- Screen share ---
  /** @type {HTMLVideoElement | undefined} */
  let screenShareEl = $state(undefined);

  const activeScreenShare = $derived.by(() => {
    if (lk.isScreenSharing && lk.localParticipant) {
      const pub = lk.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track) return { participant: lk.localParticipant, track: pub.track, isLocal: true };
    }
    for (const p of lk.remoteParticipants) {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track) return { participant: p, track: pub.track, isLocal: false };
    }
    return null;
  });

  $effect(() => {
    const el = screenShareEl;
    const track = activeScreenShare?.track;
    if (!el || !track) return;
    track.attach(el);
    return () => track.detach(el);
  });

  /** @param {{identity?: string}} participant */
  function sharerName(participant) {
    const pk = pubkeyOf(participant);
    return (pk && getProfiles().get(pk)?.name) || pk?.slice(0, 8) || participant.identity || '';
  }

  // --- Adaptive grid based on participant count ---
  const participantCount = $derived((lk.localParticipant ? 1 : 0) + lk.remoteParticipants.length);

  const gridClass = $derived.by(() => {
    if (participantCount <= 1) return 'grid-cols-1 max-w-2xl mx-auto';
    if (participantCount <= 4) return 'grid-cols-1 sm:grid-cols-2 max-w-4xl mx-auto';
    if (participantCount <= 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  });

  // --- Maximizable screen share ---
  let screenShareMaximized = $state(false);

  // Reset when screen share stops
  $effect(() => {
    if (!activeScreenShare) screenShareMaximized = false;
  });

  // --- Per-participant local mute (keyed by LiveKit identity: one per seat) ---
  let mutedParticipants = new SvelteSet();

  /** @param {string} identity */
  function toggleParticipantMute(identity) {
    if (mutedParticipants.has(identity)) mutedParticipants.delete(identity);
    else mutedParticipants.add(identity);
  }

  // --- Device selectors ---
  let audioDropdownOpen = $state(false);
  let videoDropdownOpen = $state(false);
</script>

{#snippet screenShareOverlay(/** @type {boolean} */ maximized)}
  <div
    class="absolute right-0 bottom-0 left-0 flex items-center justify-between bg-gradient-to-t from-black/50 to-transparent px-3 py-1.5"
  >
    <span class="text-xs text-white">
      {#if activeScreenShare?.isLocal}
        {m.groups_call_screen_share_you()}
      {:else if activeScreenShare}
        {m.groups_call_screen_share_active({ name: sharerName(activeScreenShare.participant) })}
      {/if}
    </span>
    <div class="flex items-center gap-1">
      <button
        class="btn text-white btn-ghost btn-xs"
        onclick={() => (screenShareMaximized = !maximized)}
        title={maximized
          ? m.groups_call_screen_share_minimize()
          : m.groups_call_screen_share_maximize()}
      >
        {#if maximized}
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4"
            />
          </svg>
        {:else}
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5"
            />
          </svg>
        {/if}
      </button>
      {#if activeScreenShare?.isLocal}
        <button class="btn btn-xs btn-error" onclick={toggleScreenShare}
          >{m.groups_call_screen_share_stop()}</button
        >
      {/if}
    </div>
  </div>
{/snippet}

{#snippet tiles(/** @type {string} */ tileClass)}
  {#if lk.localParticipant}
    <div class={tileClass}>
      <ParticipantTile
        participant={lk.localParticipant}
        pubkey={pubkeyOf(lk.localParticipant)}
        isLocal={true}
        isMuted={lk.isMuted}
        isSpeaking={lk.speakingParticipantIds.has(lk.localParticipant.identity)}
        profile={getProfiles().get(pubkeyOf(lk.localParticipant) ?? '')}
      />
    </div>
  {/if}
  {#each lk.remoteParticipants as participant (participant.sid)}
    <div class={tileClass}>
      <ParticipantTile
        {participant}
        pubkey={pubkeyOf(participant)}
        isSpeaking={lk.speakingParticipantIds.has(participant.identity)}
        profile={getProfiles().get(pubkeyOf(participant) ?? '')}
        isRemoteMuted={mutedParticipants.has(participant.identity)}
        onToggleMute={() => toggleParticipantMute(participant.identity)}
      />
    </div>
  {/each}
{/snippet}

<!-- The stage IS the channel body while the call is open (same rule as
     GroupAppStage): a flex column handing its full height to the grid. -->
<div class="flex min-h-0 flex-1 flex-col" data-testid="group-call-stage">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
    <div class="flex min-w-0 items-center gap-2">
      <MeetIcon class_="w-5 h-5 text-primary" />
      <h2 class="truncate font-semibold">{title}</h2>
      {#if !lk.canPublish}
        <span class="badge badge-ghost badge-sm" data-testid="group-call-listen-only">
          {m.groups_call_listen_only()}
        </span>
      {/if}
    </div>
    <button class="btn btn-sm btn-error" onclick={handleLeave} data-testid="group-call-leave">
      {m.groups_call_leave()}
    </button>
  </div>

  <!-- Content -->
  {#if error}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <p class="text-error">{error}</p>
        <button class="btn mt-2 btn-ghost btn-sm" onclick={handleLeave}>
          {m.common_back()}
        </button>
      </div>
    </div>
  {:else if lk.isConnecting || !lk.isConnected}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        <p class="mt-2 text-base-content/60">{m.groups_call_connecting()}</p>
      </div>
    </div>
  {:else}
    {#if activeScreenShare && screenShareMaximized}
      <!-- Maximized screen share layout -->
      <div class="flex flex-1 flex-col overflow-hidden p-2">
        <div class="relative flex-1 overflow-hidden rounded-lg bg-black">
          <video
            bind:this={screenShareEl}
            autoplay
            playsinline
            muted
            class="h-full w-full object-contain"
          ></video>
          {@render screenShareOverlay(true)}
        </div>
        <!-- Participant strip -->
        <div class="mt-2 flex gap-2 overflow-x-auto">
          {@render tiles('h-20 w-32 flex-shrink-0')}
        </div>
      </div>
    {:else}
      <!-- Normal grid layout -->
      <div class="flex flex-1 flex-col overflow-auto p-4">
        <div class="grid w-full gap-3 {gridClass}">
          {#if activeScreenShare}
            <div class="relative col-span-full overflow-hidden rounded-lg bg-black">
              <video
                bind:this={screenShareEl}
                autoplay
                playsinline
                muted
                class="max-h-[70vh] w-full object-contain"
              ></video>
              {@render screenShareOverlay(false)}
            </div>
          {/if}
          {@render tiles('aspect-video')}
        </div>
      </div>
    {/if}

    <!-- Controls: publish controls only when the token allows publishing -->
    {#if lk.canPublish}
      <div
        class="mt-auto flex items-center justify-center gap-3 border-t border-base-300 px-4 py-3"
      >
        <!-- Mute button with audio device dropdown -->
        <div class="flex items-center">
          <button
            class="btn btn-circle {lk.isMuted ? 'btn-error' : 'btn-ghost'}"
            onclick={toggleMute}
            title={lk.isMuted ? m.groups_call_unmute() : m.groups_call_mute()}
          >
            {#if lk.isMuted}
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <VolumeUpIcon class_="w-5 h-5" />
            {/if}
          </button>

          <!-- Audio device selector dropdown -->
          <div class="dropdown dropdown-top">
            <button
              class="btn btn-circle btn-ghost btn-xs"
              title={m.groups_call_select_microphone()}
              onclick={() => {
                refreshAudioDevices();
                audioDropdownOpen = !audioDropdownOpen;
              }}
            >
              <ChevronDownIcon class_="w-3 h-3" />
            </button>
            {#if audioDropdownOpen}
              <ul
                class="dropdown-content menu z-10 mb-2 w-60 rounded-box bg-base-100 p-2 shadow-lg"
                role="menu"
                onmouseleave={() => {
                  audioDropdownOpen = false;
                }}
              >
                <li class="menu-title text-xs">{m.groups_call_select_microphone()}</li>
                {#each lk.audioInputDevices as device (device.deviceId)}
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={device.deviceId === lk.activeAudioDeviceId}
                      onclick={async () => {
                        await switchAudioDevice(device.deviceId);
                      }}
                    >
                      {device.label || m.groups_call_unknown_device()}
                    </button>
                  </li>
                {/each}
                {#if lk.audioInputDevices.length === 0}
                  <li>
                    <span class="text-sm text-base-content/50"
                      >{m.groups_call_unknown_device()}</span
                    >
                  </li>
                {/if}

                {#if lk.audioOutputDevices.length > 0}
                  <li class="mt-1 menu-title text-xs">{m.groups_call_select_speaker()}</li>
                  {#each lk.audioOutputDevices as device (device.deviceId)}
                    <li>
                      <button
                        class="text-sm"
                        class:menu-active={device.deviceId === lk.activeAudioOutputDeviceId}
                        onclick={async () => {
                          await switchAudioOutputDevice(device.deviceId);
                        }}
                      >
                        {device.label || m.groups_call_unknown_device()}
                      </button>
                    </li>
                  {/each}
                {/if}
              </ul>
            {/if}
          </div>
        </div>

        {#if video}
          <div class="flex items-center">
            <button
              class="btn btn-circle {lk.isCameraOff ? 'btn-error' : 'btn-ghost'}"
              onclick={toggleCamera}
              title={lk.isCameraOff ? m.groups_call_camera_on() : m.groups_call_camera_off()}
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>

            <!-- Video device selector dropdown -->
            <div class="dropdown dropdown-top">
              <button
                class="btn btn-circle btn-ghost btn-xs"
                title={m.groups_call_select_camera()}
                onclick={() => {
                  refreshVideoDevices();
                  videoDropdownOpen = !videoDropdownOpen;
                }}
              >
                <ChevronDownIcon class_="w-3 h-3" />
              </button>
              {#if videoDropdownOpen}
                <ul
                  class="dropdown-content menu z-10 mb-2 w-60 rounded-box bg-base-100 p-2 shadow-lg"
                  role="menu"
                  onmouseleave={() => {
                    videoDropdownOpen = false;
                  }}
                >
                  <li class="menu-title text-xs">{m.groups_call_select_camera()}</li>
                  {#each lk.videoInputDevices as device (device.deviceId)}
                    <li>
                      <button
                        class="text-sm"
                        class:menu-active={device.deviceId === lk.activeVideoDeviceId}
                        onclick={async () => {
                          await switchVideoDevice(device.deviceId);
                        }}
                      >
                        {device.label || m.groups_call_unknown_device()}
                      </button>
                    </li>
                  {/each}
                  {#if lk.videoInputDevices.length === 0}
                    <li>
                      <span class="text-sm text-base-content/50"
                        >{m.groups_call_unknown_device()}</span
                      >
                    </li>
                  {/if}
                </ul>
              {/if}
            </div>
          </div>
        {/if}

        <button
          class="btn btn-circle {lk.isScreenSharing ? 'btn-warning' : 'btn-ghost'}"
          onclick={toggleScreenShare}
          title={lk.isScreenSharing
            ? m.groups_call_screen_share_stop()
            : m.groups_call_screen_share_start()}
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>
    {/if}
  {/if}
</div>
