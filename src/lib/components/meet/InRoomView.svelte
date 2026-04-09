<!--
  InRoomView — In-room video/audio UI with participant grid and controls.
  Rendered when a user joins a room via the MeetView.
-->

<script>
  import { SvelteSet } from 'svelte/reactivity';
  import {
    connectToRoom,
    disconnectFromRoom,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    getLiveKitState,
    refreshAudioDevices,
    switchAudioDevice,
    switchAudioOutputDevice
  } from '$lib/services/livekit-connection.svelte.js';
  import { Track } from 'livekit-client';
  import { startPresence, stopPresence } from '$lib/services/meet-presence.svelte.js';
  import { requestLiveKitToken } from '$lib/services/livekit-token-service.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { getRoomCoordinate } from '$lib/helpers/meet.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { MeetIcon, ChevronDownIcon, CopyIcon, VolumeUpIcon } from '$lib/components/icons';
  import ParticipantTile from './ParticipantTile.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   room: import('$lib/helpers/meet.js').ParsedRoomEvent,
   *   communityPubkey: string,
   *   livekitUrl: string,
   *   onLeave: () => void
   * }}
   */
  let { room, communityPubkey, livekitUrl, onLeave } = $props();

  const lk = getLiveKitState();
  let error = $state(/** @type {string | null} */ (null));

  // --- #5: Profile map for participant tiles ---
  const getProfiles = useProfileMap(() => {
    /** @type {string[]} */
    const pks = [];
    if (lk.localParticipant?.identity) pks.push(lk.localParticipant.identity);
    for (const p of lk.remoteParticipants) {
      if (p.identity) pks.push(p.identity);
    }
    return pks;
  });

  // Connect on mount
  $effect(() => {
    if (!manager.active || !livekitUrl) return;

    const coordinate = getRoomCoordinate(room.event);
    const isVideo = room.type === 'video';

    (async () => {
      try {
        const signer = async (/** @type {any} */ draft) => {
          const factory = createAppEventFactory({ signer: manager.signer });
          return factory.sign(draft);
        };

        const { token, url } = await requestLiveKitToken(
          livekitUrl,
          coordinate,
          communityPubkey,
          signer
        );

        await connectToRoom(token, url, { video: isVideo, audio: true });
        await startPresence(coordinate, communityPubkey);
      } catch (err) {
        console.error('Failed to join room:', err);
        error = err instanceof Error ? err.message : m.meet_connection_error();
      }
    })();

    return () => {
      disconnectFromRoom();
      stopPresence();
    };
  });

  async function handleLeave() {
    await disconnectFromRoom();
    await stopPresence();
    onLeave();
  }

  // --- Share room link ---
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
      if (/** @type {Error} */ (err).name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    }
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

  // --- Per-participant local mute ---
  let mutedParticipants = new SvelteSet();

  /** @param {string} identity */
  function toggleParticipantMute(identity) {
    if (mutedParticipants.has(identity)) mutedParticipants.delete(identity);
    else mutedParticipants.add(identity);
  }

  // --- #6: Audio device selector ---
  let audioDropdownOpen = $state(false);
</script>

<div class="flex flex-1 flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
    <div class="flex items-center gap-2">
      <MeetIcon class_="w-5 h-5 text-primary" />
      <h2 class="font-semibold">{room.name || 'Room'}</h2>
      <span class="badge badge-sm {room.type === 'audio' ? 'badge-secondary' : 'badge-primary'}">
        {room.type === 'audio' ? m.meet_room_type_audio() : m.meet_room_type_video()}
      </span>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn btn-ghost btn-sm" onclick={handleShare} title={m.meet_share_room()}>
        <CopyIcon class_="w-4 h-4" />
        <span class="hidden sm:inline">{m.meet_share_room()}</span>
      </button>
      <button class="btn btn-sm btn-error" onclick={handleLeave}>
        {m.meet_leave()}
      </button>
    </div>
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
  {:else if lk.isConnecting}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        <p class="mt-2 text-base-content/60">{m.meet_connecting()}</p>
      </div>
    </div>
  {:else if lk.isConnected}
    <!-- Participant Grid -->
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
          <div
            class="absolute right-0 bottom-0 left-0 flex items-center justify-between bg-gradient-to-t from-black/50 to-transparent px-3 py-1.5"
          >
            <span class="text-xs text-white">
              {#if activeScreenShare.isLocal}
                {m.meet_screen_share_you()}
              {:else}
                {m.meet_screen_share_active({
                  name:
                    getProfiles().get(activeScreenShare.participant.identity)?.name ||
                    activeScreenShare.participant.identity
                })}
              {/if}
            </span>
            <div class="flex items-center gap-1">
              <button
                class="btn text-white btn-ghost btn-xs"
                onclick={() => (screenShareMaximized = false)}
                title={m.meet_screen_share_minimize()}
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4"
                  />
                </svg>
              </button>
              {#if activeScreenShare.isLocal}
                <button class="btn btn-xs btn-error" onclick={toggleScreenShare}
                  >{m.meet_screen_share_stop()}</button
                >
              {/if}
            </div>
          </div>
        </div>
        <!-- Participant strip -->
        <div class="mt-2 flex gap-2 overflow-x-auto">
          {#if lk.localParticipant}
            <div class="h-20 w-32 flex-shrink-0">
              <ParticipantTile
                participant={lk.localParticipant}
                isLocal={true}
                isMuted={lk.isMuted}
                isSpeaking={lk.speakingParticipantIds.has(lk.localParticipant.identity)}
                profile={getProfiles().get(lk.localParticipant.identity)}
              />
            </div>
          {/if}
          {#each lk.remoteParticipants as participant (participant.sid)}
            <div class="h-20 w-32 flex-shrink-0">
              <ParticipantTile
                {participant}
                isSpeaking={lk.speakingParticipantIds.has(participant.identity)}
                profile={getProfiles().get(participant.identity)}
                isRemoteMuted={mutedParticipants.has(participant.identity)}
                onToggleMute={() => toggleParticipantMute(participant.identity)}
              />
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Normal grid layout -->
      <div class="flex flex-1 flex-col overflow-auto p-4">
        <div class="grid w-full flex-1 auto-rows-fr gap-3 {gridClass}">
          {#if activeScreenShare}
            <div class="relative col-span-full overflow-hidden rounded-lg bg-black">
              <video
                bind:this={screenShareEl}
                autoplay
                playsinline
                muted
                class="max-h-[70vh] w-full object-contain"
              ></video>
              <div
                class="absolute right-0 bottom-0 left-0 flex items-center justify-between bg-gradient-to-t from-black/50 to-transparent px-3 py-1.5"
              >
                <span class="text-xs text-white">
                  {#if activeScreenShare.isLocal}
                    {m.meet_screen_share_you()}
                  {:else}
                    {m.meet_screen_share_active({
                      name:
                        getProfiles().get(activeScreenShare.participant.identity)?.name ||
                        activeScreenShare.participant.identity
                    })}
                  {/if}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    class="btn text-white btn-ghost btn-xs"
                    onclick={() => (screenShareMaximized = true)}
                    title={m.meet_screen_share_maximize()}
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5"
                      />
                    </svg>
                  </button>
                  {#if activeScreenShare.isLocal}
                    <button class="btn btn-xs btn-error" onclick={toggleScreenShare}
                      >{m.meet_screen_share_stop()}</button
                    >
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          {#if lk.localParticipant}
            <ParticipantTile
              participant={lk.localParticipant}
              isLocal={true}
              isMuted={lk.isMuted}
              isSpeaking={lk.speakingParticipantIds.has(lk.localParticipant.identity)}
              profile={getProfiles().get(lk.localParticipant.identity)}
            />
          {/if}

          {#each lk.remoteParticipants as participant (participant.sid)}
            <ParticipantTile
              {participant}
              isSpeaking={lk.speakingParticipantIds.has(participant.identity)}
              profile={getProfiles().get(participant.identity)}
              isRemoteMuted={mutedParticipants.has(participant.identity)}
              onToggleMute={() => toggleParticipantMute(participant.identity)}
            />
          {/each}
        </div>
      </div>
    {/if}

    <!-- Controls -->
    <div class="flex items-center justify-center gap-3 border-t border-base-300 px-4 py-3">
      <!-- Mute button with audio device dropdown -->
      <div class="flex items-center">
        <button
          class="btn btn-circle {lk.isMuted ? 'btn-error' : 'btn-ghost'}"
          onclick={toggleMute}
          title={lk.isMuted ? m.meet_unmute() : m.meet_mute()}
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
            title={m.meet_select_microphone()}
            onclick={() => {
              refreshAudioDevices();
              audioDropdownOpen = !audioDropdownOpen;
            }}
          >
            <ChevronDownIcon class_="w-3 h-3" />
          </button>
          {#if audioDropdownOpen}
            <ul
              class="dropdown-content menu z-10 mb-2 w-60 rounded-box bg-base-200 p-2 shadow-lg"
              role="menu"
              onmouseleave={() => {
                audioDropdownOpen = false;
              }}
            >
              <!-- Microphone section -->
              <li class="menu-title text-xs">{m.meet_select_microphone()}</li>
              {#each lk.audioInputDevices as device (device.deviceId)}
                <li>
                  <button
                    class="text-sm"
                    class:menu-active={device.deviceId === lk.activeAudioDeviceId}
                    onclick={async () => {
                      await switchAudioDevice(device.deviceId);
                    }}
                  >
                    {device.label || m.meet_unknown_device()}
                  </button>
                </li>
              {/each}
              {#if lk.audioInputDevices.length === 0}
                <li><span class="text-sm text-base-content/50">{m.meet_unknown_device()}</span></li>
              {/if}

              <!-- Speaker section -->
              {#if lk.audioOutputDevices.length > 0}
                <li class="mt-1 menu-title text-xs">{m.meet_select_speaker()}</li>
                {#each lk.audioOutputDevices as device (device.deviceId)}
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={device.deviceId === lk.activeAudioOutputDeviceId}
                      onclick={async () => {
                        await switchAudioOutputDevice(device.deviceId);
                      }}
                    >
                      {device.label || m.meet_unknown_device()}
                    </button>
                  </li>
                {/each}
              {/if}
            </ul>
          {/if}
        </div>
      </div>

      {#if room.type === 'video'}
        <button
          class="btn btn-circle {lk.isCameraOff ? 'btn-error' : 'btn-ghost'}"
          onclick={toggleCamera}
          title={lk.isCameraOff ? m.meet_camera_on() : m.meet_camera_off()}
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
      {/if}

      <button
        class="btn btn-circle {lk.isScreenSharing ? 'btn-warning' : 'btn-ghost'}"
        onclick={toggleScreenShare}
        title={lk.isScreenSharing ? m.meet_screen_share_stop() : m.meet_screen_share_start()}
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
</div>
