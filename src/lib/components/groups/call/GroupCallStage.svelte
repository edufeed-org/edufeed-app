<!--
  GroupCallStage — the in-call audio/video UI hosted in a channel's stage
  slot (the same slot GroupAppStage takes for a shared webxdc session).

  A pure VIEW of the one call: the connection belongs to the call store
  (groups/group-call), which keeps the call running when this view goes
  away (channel switch, route change — the app-level CallDock takes over).
  Mounting or unmounting it never connects or disconnects anything.

  Also mounted into the call's pop-out window (groups/call-popout), a
  second document: window listeners and size measurement therefore go
  through the document the stage is rendered in, never the global one.

  Protocol-agnostic on purpose: it gets a title, an identity→pubkey
  resolver and callbacks. Who minted the token — a NIP-29 relay today, a
  CORD-07 broker later — is the parent's business.
-->

<script>
  import { SvelteMap } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import {
    CALL_REACTIONS,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    getLiveKitState,
    refreshAudioDevices,
    switchAudioDevice,
    switchAudioOutputDevice,
    refreshVideoDevices,
    switchVideoDevice,
    setParticipantVolume,
    setAudioProcessingLive,
    canSelectSpeaker,
    setHandRaised,
    sendReaction
  } from '$lib/services/livekit-connection.svelte.js';
  import {
    SCREEN_SHARE_QUALITIES,
    getAudioProcessing,
    getParticipantVolume,
    getScreenShareQuality,
    setScreenShareQuality
  } from '$lib/services/call-prefs.js';
  import { fitGrid, nextSpotlight } from '$lib/groups/call-layout.js';
  import { isGuestParticipant } from '$lib/groups/livekit.js';
  import { Track } from 'livekit-client';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import { playLeaveSound } from '$lib/services/call-sounds.js';
  import { callMediaErrorMessage } from '$lib/groups/call-media-errors.js';
  import {
    MeetIcon,
    ChevronDownIcon,
    MicIcon,
    MicOffIcon,
    VideoIcon,
    ScreenShareIcon,
    HandIcon,
    SmilePlusIcon,
    ChatIcon,
    ExternalLinkIcon,
    LinkIcon
  } from '$lib/components/icons';
  import ParticipantTile from './ParticipantTile.svelte';
  import ScreenShareTile from './ScreenShareTile.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   title: string,
   *   identityToPubkey: (identity: string) => string | null,
   *   video?: boolean,
   *   onLeave: () => void,
   *   onShowChat?: () => void,
   *   chatOpen?: boolean,
   *   onPopOut?: () => void,
   *   onPopIn?: () => void,
   *   onInvite?: () => void,
   *   registerView?: () => () => void
   * }}
   * `chatOpen`: the chat sits beside the stage (wide screens);
   * `onPopOut`: offered where the call can move to its own window;
   * `onPopIn`: this stage IS that window — the way back to the tab.
   * `onInvite`: offered when the parent has resolved guest links are
   * available for this channel (relay support + membership).
   */
  let {
    title,
    identityToPubkey,
    video = true,
    onLeave,
    onShowChat = undefined,
    chatOpen = false,
    onPopOut = undefined,
    onPopIn = undefined,
    onInvite = undefined,
    registerView = undefined
  } = $props();

  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);

  const lk = getLiveKitState();

  // Tell the call store a stage is on screen (the dock steps aside). The
  // CALL is untracked too: the store's register reads and writes its own
  // `$state` counter, and a tracked call made this effect depend on the
  // signal it bumps — effect_update_depth_exceeded on join (2026-09-28).
  $effect(() => untrack(() => registerView?.()));

  /** @param {{identity?: string} | null | undefined} participant */
  function pubkeyOf(participant) {
    return participant?.identity ? identityToPubkey(participant.identity) : null;
  }

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

  /** @param {{identity?: string}} participant */
  function nameOf(participant) {
    const pk = pubkeyOf(participant);
    const profile = pk ? getProfiles().get(pk) : undefined;
    return profile?.display_name || profile?.name || pk?.slice(0, 8) || participant.identity || '';
  }

  // --- Media actions: failures are explained, never swallowed ---
  /** @param {'mic' | 'camera' | 'screen'} kind @param {() => Promise<void>} action */
  async function runMedia(kind, action) {
    try {
      await action();
    } catch (err) {
      console.warn(`call ${kind} action failed:`, err);
      showToast(callMediaErrorMessage(err, kind), 'error');
    }
  }
  const onToggleMute = () => runMedia('mic', toggleMute);
  const onToggleCamera = () => runMedia('camera', toggleCamera);
  const onToggleScreenShare = () => runMedia('screen', toggleScreenShare);

  function handleLeave() {
    // Played inside the click: the teardown would cut it off otherwise.
    playLeaveSound();
    onLeave();
  }

  // --- Stage items: screen shares first, then seats ---
  /**
   * @typedef {{kind: 'screen', key: string, participant: any, track: any, isLocal: boolean}} ShareItem
   * @typedef {{kind: 'seat', key: string, participant: any, isLocal: boolean}} SeatItem
   */
  /** @type {ShareItem[]} */
  const shares = $derived.by(() => {
    /** @type {ShareItem[]} */
    const out = [];
    const local = lk.localParticipant;
    if (lk.isScreenSharing && local) {
      const track = local.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (track) {
        out.push({
          kind: 'screen',
          key: `screen:${local.identity}`,
          participant: local,
          track,
          isLocal: true
        });
      }
    }
    for (const p of lk.remoteParticipants) {
      const track = p.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (track) {
        out.push({
          kind: 'screen',
          key: `screen:${p.identity}`,
          participant: p,
          track,
          isLocal: false
        });
      }
    }
    return out;
  });

  /** @type {SeatItem[]} */
  const seats = $derived.by(() => {
    /** @type {SeatItem[]} */
    const out = [];
    const local = lk.localParticipant;
    if (local) {
      out.push({ kind: 'seat', key: `seat:${local.identity}`, participant: local, isLocal: true });
    }
    for (const p of lk.remoteParticipants) {
      out.push({ kind: 'seat', key: `seat:${p.identity}`, participant: p, isLocal: false });
    }
    return out;
  });

  /** @type {Array<ShareItem | SeatItem>} */
  const items = $derived([...shares, ...seats]);

  // --- Spotlight: a pinned item fills the stage, the rest go to a strip ---
  /** @type {string | null} */
  let pinnedKey = $state(null);
  // Shares already seen on this stage (plain: bookkeeping, not UI state).
  /** @type {Set<string>} */
  const seenShares = new Set();

  // A NEW remote share takes the spotlight; your own share never does
  // (showing your screen to yourself big is a hall of mirrors). A pin whose
  // item left the call is dropped.
  $effect(() => {
    const remoteShareKeys = shares.filter((s) => !s.isLocal).map((s) => s.key);
    const otherKeys = items.map((i) => i.key);
    const current = untrack(() => pinnedKey);
    const next = nextSpotlight(current, otherKeys, remoteShareKeys, seenShares);
    if (next !== current) pinnedKey = next;
  });

  const spotlight = $derived(items.find((i) => i.key === pinnedKey) ?? null);
  const strip = $derived(spotlight ? items.filter((i) => i.key !== spotlight.key) : []);

  /** @param {string} key */
  function togglePin(key) {
    pinnedKey = pinnedKey === key ? null : key;
  }

  // --- Auto-fit grid ---
  const GAP = 8;
  const PAD = 12; // the grid box's p-3, inside the measured frame
  let gridWidth = $state(0);
  let gridHeight = $state(0);
  // bind:clientWidth would observe through the opener's ResizeObserver,
  // which stops reporting inside the pop-out once the opener tab is hidden.
  /** @param {HTMLElement} node */
  function measureGrid(node) {
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(() => {
      gridWidth = node.clientWidth;
      gridHeight = node.clientHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }
  // The measured frame's grid sits in an absolutely positioned layer, so
  // the pixel-sized tiles never feed back into the width being measured
  // (they did: the stage grew past its column, 2026-09-28).
  const grid = $derived(
    fitGrid(items.length, Math.max(0, gridWidth - 2 * PAD), Math.max(0, gridHeight - 2 * PAD), GAP)
  );
  const measured = $derived(grid.tileWidth > 0);
  const gridStyle = $derived(
    measured
      ? `grid-template-columns: repeat(${grid.cols}, ${Math.floor(grid.tileWidth)}px); gap: ${GAP}px;`
      : `grid-template-columns: repeat(${grid.cols}, minmax(0, 1fr)); gap: ${GAP}px; width: 100%;`
  );
  const tileStyle = $derived(
    measured
      ? `width: ${Math.floor(grid.tileWidth)}px; height: ${Math.floor(grid.tileHeight)}px;`
      : ''
  );

  // --- Per-person volume (0..2), keyed by pubkey so every seat follows ---
  const volumes = new SvelteMap();
  /** @param {string | null} pk */
  function volumeFor(pk) {
    if (!pk) return 1;
    return volumes.get(pk) ?? getParticipantVolume(pk);
  }
  /** @param {string | null} pk @param {number} value */
  function changeVolume(pk, value) {
    if (!pk) return;
    volumes.set(pk, setParticipantVolume(pk, value));
  }

  // --- Hands + reactions ---
  const myIdentity = $derived(lk.localParticipant?.identity ?? '');
  const myHandUp = $derived(!!myIdentity && lk.raisedHands.has(myIdentity));
  const handCount = $derived(lk.raisedHands.size);
  /** @param {string} identity */
  function reactionsOf(identity) {
    return lk.reactions.filter((r) => r.identity === identity);
  }

  // --- Menus (one open at a time; outside click / Escape closes) ---
  /** @type {'mic' | 'camera' | 'screen' | 'react' | null} */
  let openMenu = $state(null);
  /** @param {'mic' | 'camera' | 'screen' | 'react'} name */
  function toggleMenu(name) {
    if (openMenu === name) {
      openMenu = null;
      return;
    }
    if (name === 'mic') refreshAudioDevices();
    if (name === 'camera') refreshVideoDevices();
    openMenu = name;
  }
  // Outside click / Escape, on the window the stage is rendered in.
  $effect(() => {
    const win = rootEl?.ownerDocument.defaultView;
    if (!win) return;
    /** @param {PointerEvent} event */
    const onPointerDown = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.closest?.('[data-call-menu]')) openMenu = null;
    };
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (event.key === 'Escape') openMenu = null;
    };
    win.addEventListener('pointerdown', onPointerDown);
    win.addEventListener('keydown', onKeyDown);
    return () => {
      win.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('keydown', onKeyDown);
    };
  });

  /** @typedef {'noiseSuppression' | 'echoCancellation' | 'autoGainControl'} ProcessingKey */
  let processing = $state(getAudioProcessing());
  /** @type {Array<[ProcessingKey, () => string]>} */
  const PROCESSING_OPTIONS = [
    ['noiseSuppression', m.groups_call_noise_suppression],
    ['echoCancellation', m.groups_call_echo_cancellation],
    ['autoGainControl', m.groups_call_auto_gain]
  ];
  /** @param {ProcessingKey} key */
  async function toggleProcessing(key) {
    const value = !processing[key];
    processing = { ...processing, [key]: value };
    try {
      await setAudioProcessingLive({ [key]: value });
    } catch (err) {
      console.warn('audio processing change failed:', err);
      showToast(callMediaErrorMessage(err, 'mic'), 'error');
    }
  }

  const speakerSelectable = canSelectSpeaker();
  const QUALITY_KEYS = /** @type {Array<keyof typeof SCREEN_SHARE_QUALITIES>} */ (
    Object.keys(SCREEN_SHARE_QUALITIES)
  );
  let shareQuality = $state(getScreenShareQuality());
  /** @param {keyof typeof SCREEN_SHARE_QUALITIES} q */
  function pickQuality(q) {
    setScreenShareQuality(q);
    shareQuality = q;
    openMenu = null;
  }
  /** @param {keyof typeof SCREEN_SHARE_QUALITIES} q */
  function qualityLabel(q) {
    const preset = SCREEN_SHARE_QUALITIES[q];
    return `${preset.height}p · ${preset.frameRate} fps`;
  }
  /** @param {string} emoji */
  function react(emoji) {
    sendReaction(emoji);
    openMenu = null;
  }
</script>

{#snippet item(/** @type {any} */ it, /** @type {boolean} */ compact)}
  {#if it.kind === 'screen'}
    <ScreenShareTile
      track={it.track}
      label={it.isLocal
        ? m.groups_call_screen_share_you()
        : m.groups_call_screen_share_active({ name: nameOf(it.participant) })}
      isLocal={it.isLocal}
      pinned={pinnedKey === it.key}
      onTogglePin={() => togglePin(it.key)}
      onStop={onToggleScreenShare}
      {compact}
    />
  {:else}
    {@const pk = pubkeyOf(it.participant)}
    <ParticipantTile
      participant={it.participant}
      pubkey={pk}
      isLocal={it.isLocal}
      isMicOff={it.isLocal ? lk.isMuted : lk.mutedIdentities.has(it.participant.identity)}
      isSpeaking={lk.speakingParticipantIds.has(it.participant.identity)}
      handRaised={lk.raisedHands.has(it.participant.identity)}
      isGuest={isGuestParticipant(it.participant)}
      reactions={reactionsOf(it.participant.identity)}
      profile={getProfiles().get(pk ?? '')}
      volume={volumeFor(pk)}
      onVolumeChange={it.isLocal ? undefined : (/** @type {number} */ v) => changeVolume(pk, v)}
      pinned={pinnedKey === it.key}
      onTogglePin={() => togglePin(it.key)}
      {compact}
    />
  {/if}
{/snippet}

{#snippet menuButton(/** @type {'mic' | 'camera' | 'screen'} */ name, /** @type {string} */ label)}
  <button
    class="btn btn-circle btn-ghost btn-xs"
    aria-label={label}
    title={label}
    aria-expanded={openMenu === name}
    onclick={() => toggleMenu(name)}
  >
    <ChevronDownIcon class_="w-3 h-3" />
  </button>
{/snippet}

<!-- The stage IS the channel body while the call is open (same rule as
     GroupAppStage): a flex column handing its full height to the grid. -->
<!-- A size container: beside the chat column the stage is narrow even in a
  wide window, so the header's labels answer to the STAGE's width (@md:),
  not the viewport's (laoc, 2026-10-02: the button row widened the page). -->
<div
  bind:this={rootEl}
  class="@container flex min-h-0 min-w-0 flex-1 flex-col"
  data-testid="group-call-stage"
>
  <!-- Header -->
  <div class="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-2">
    <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <MeetIcon class_="w-5 h-5 shrink-0 text-primary" />
      <h2 class="truncate font-semibold">{title}</h2>
      {#if !lk.canPublish}
        <span class="badge shrink-0 badge-ghost badge-sm" data-testid="group-call-listen-only">
          {m.groups_call_listen_only()}
        </span>
      {/if}
      {#if handCount > 0}
        <span class="badge shrink-0 gap-1 badge-sm badge-warning" data-testid="group-call-hands">
          <HandIcon class_="h-3 w-3" title="" />
          {m.groups_call_hands_raised({ count: handCount })}
        </span>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if onInvite}
        <button
          class="btn btn-ghost btn-sm"
          onclick={onInvite}
          title={m.groups_call_invite_title()}
          data-testid="group-call-invite"
        >
          <LinkIcon class_="h-4 w-4" title="" />
          <span class="hidden @md:inline">{m.groups_call_invite_button()}</span>
        </button>
      {/if}
      {#if onPopOut}
        <button
          class="btn btn-square btn-ghost btn-sm"
          onclick={onPopOut}
          title={m.groups_call_pop_out()}
          aria-label={m.groups_call_pop_out()}
          data-testid="group-call-pop-out"
        >
          <ExternalLinkIcon class_="h-4 w-4" title="" />
        </button>
      {/if}
      {#if onPopIn}
        <button class="btn btn-ghost btn-sm" onclick={onPopIn} data-testid="group-call-pop-in">
          {m.groups_call_pop_in()}
        </button>
      {/if}
      {#if onShowChat}
        <button
          class="btn btn-ghost btn-sm {chatOpen ? 'btn-active' : ''}"
          onclick={onShowChat}
          aria-pressed={chatOpen}
          data-testid="group-call-show-chat"
        >
          <ChatIcon class_="h-4 w-4" />
          <span class="hidden @md:inline">{m.groups_call_show_chat()}</span>
        </button>
      {/if}
      <button class="btn btn-sm btn-error" onclick={handleLeave} data-testid="group-call-leave">
        {m.groups_call_leave()}
      </button>
    </div>
  </div>

  {#if lk.connectionState === 'reconnecting'}
    <div
      class="flex items-center justify-center gap-2 bg-warning px-3 py-1 text-sm text-warning-content"
      role="status"
      data-testid="group-call-reconnecting"
    >
      <span class="loading loading-xs loading-spinner"></span>
      {m.groups_call_reconnecting()}
    </div>
  {/if}

  <!-- Content -->
  {#if lk.isConnecting || !lk.isConnected}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        <p class="mt-2 text-base-content/60">{m.groups_call_connecting()}</p>
      </div>
    </div>
  {:else if spotlight}
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2" data-testid="group-call-spotlight">
      <div class="relative min-h-0 flex-1" data-testid={`call-item-${spotlight.key}`}>
        {@render item(spotlight, false)}
      </div>
      {#if strip.length > 0}
        <div class="flex h-24 shrink-0 gap-2 overflow-x-auto">
          {#each strip as it (it.key)}
            <div class="relative aspect-video h-full shrink-0" data-testid={`call-item-${it.key}`}>
              {@render item(it, true)}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="relative min-h-0 min-w-0 flex-1" {@attach measureGrid}>
      <!-- Top-aligned: in a tall stage the tiles belong under the header,
        not centred in empty space (laoc, 2026-10-01). -->
      <div class="absolute inset-0 flex items-start justify-center overflow-hidden p-3">
        <div
          class="grid content-start justify-center"
          style={gridStyle}
          data-testid="group-call-grid"
        >
          {#each items as it (it.key)}
            <div
              class="relative {measured ? '' : 'aspect-video'}"
              style={tileStyle}
              data-testid={`call-item-${it.key}`}
            >
              {@render item(it, false)}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Controls -->
  {#if lk.isConnected}
    <div
      class="mt-auto flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-base-300 px-4 py-3"
      data-testid="group-call-controls"
    >
      {#if lk.canPublish}
        <!-- Microphone + devices + processing -->
        <div class="relative flex items-center" data-call-menu>
          <button
            class="btn btn-circle {lk.isMuted ? 'btn-error' : 'btn-ghost'}"
            onclick={onToggleMute}
            title={lk.isMuted ? m.groups_call_unmute() : m.groups_call_mute()}
          >
            {#if lk.isMuted}
              <MicOffIcon class_="w-5 h-5" title="" />
            {:else}
              <MicIcon class_="w-5 h-5" title="" />
            {/if}
          </button>
          {@render menuButton('mic', m.groups_call_mic_options())}
          {#if openMenu === 'mic'}
            <ul
              class="menu absolute bottom-full left-0 z-30 mb-2 w-64 rounded-box bg-base-100 p-2 shadow-lg"
              data-testid="group-call-mic-menu"
            >
              <li class="menu-title text-xs">{m.groups_call_select_microphone()}</li>
              {#each lk.audioInputDevices as device (device.deviceId)}
                <li>
                  <button
                    class="text-sm"
                    class:menu-active={device.deviceId === lk.activeAudioDeviceId}
                    onclick={() => switchAudioDevice(device.deviceId)}
                  >
                    {device.label || m.groups_call_unknown_device()}
                  </button>
                </li>
              {:else}
                <li>
                  <span class="text-sm text-base-content/50">{m.groups_call_unknown_device()}</span>
                </li>
              {/each}

              {#if speakerSelectable && lk.audioOutputDevices.length > 0}
                <li class="mt-1 menu-title text-xs">{m.groups_call_select_speaker()}</li>
                {#each lk.audioOutputDevices as device (device.deviceId)}
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={device.deviceId === lk.activeAudioOutputDeviceId}
                      onclick={() => switchAudioOutputDevice(device.deviceId)}
                    >
                      {device.label || m.groups_call_unknown_device()}
                    </button>
                  </li>
                {/each}
              {/if}

              <li class="mt-1 menu-title text-xs">{m.groups_call_audio_processing()}</li>
              {#each PROCESSING_OPTIONS as [key, label] (key)}
                <li>
                  <label class="flex cursor-pointer items-center justify-between gap-2 text-sm">
                    {label()}
                    <input
                      type="checkbox"
                      class="toggle toggle-primary toggle-sm"
                      checked={processing[key]}
                      onchange={() => toggleProcessing(key)}
                    />
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#if video}
          <div class="relative flex items-center" data-call-menu>
            <button
              class="btn btn-circle {lk.isCameraOff ? 'btn-error' : 'btn-ghost'}"
              onclick={onToggleCamera}
              title={lk.isCameraOff ? m.groups_call_camera_on() : m.groups_call_camera_off()}
            >
              <VideoIcon class_="w-5 h-5" title="" />
            </button>
            {@render menuButton('camera', m.groups_call_camera_options())}
            {#if openMenu === 'camera'}
              <ul
                class="menu absolute bottom-full left-0 z-30 mb-2 w-60 rounded-box bg-base-100 p-2 shadow-lg"
              >
                <li class="menu-title text-xs">{m.groups_call_select_camera()}</li>
                {#each lk.videoInputDevices as device (device.deviceId)}
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={device.deviceId === lk.activeVideoDeviceId}
                      onclick={() => switchVideoDevice(device.deviceId)}
                    >
                      {device.label || m.groups_call_unknown_device()}
                    </button>
                  </li>
                {:else}
                  <li>
                    <span class="text-sm text-base-content/50"
                      >{m.groups_call_unknown_device()}</span
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="relative flex items-center" data-call-menu>
          <button
            class="btn btn-circle {lk.isScreenSharing ? 'btn-warning' : 'btn-ghost'}"
            onclick={onToggleScreenShare}
            title={lk.isScreenSharing
              ? m.groups_call_screen_share_stop()
              : m.groups_call_screen_share_start()}
          >
            <ScreenShareIcon class_="w-5 h-5" title="" />
          </button>
          {@render menuButton('screen', m.groups_call_screen_share_options())}
          {#if openMenu === 'screen'}
            <ul
              class="menu absolute right-0 bottom-full z-30 mb-2 w-52 rounded-box bg-base-100 p-2 shadow-lg"
              data-testid="group-call-screen-menu"
            >
              <li class="menu-title text-xs">{m.groups_call_screen_share_quality()}</li>
              {#each QUALITY_KEYS as q (q)}
                <li>
                  <button
                    class="text-sm"
                    class:menu-active={q === shareQuality}
                    onclick={() => pickQuality(q)}
                  >
                    {qualityLabel(q)}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if lk.canSignal}
        <button
          class="btn btn-circle {myHandUp ? 'btn-warning' : 'btn-ghost'}"
          aria-pressed={myHandUp}
          title={myHandUp ? m.groups_call_lower_hand() : m.groups_call_raise_hand()}
          onclick={() => setHandRaised(!myHandUp)}
        >
          <HandIcon class_="w-5 h-5" title="" />
        </button>

        <div class="relative" data-call-menu>
          <button
            class="btn btn-circle btn-ghost"
            title={m.groups_call_react()}
            aria-expanded={openMenu === 'react'}
            onclick={() => toggleMenu('react')}
          >
            <SmilePlusIcon class="h-5 w-5" />
          </button>
          {#if openMenu === 'react'}
            <div
              class="absolute right-0 bottom-full z-30 mb-2 flex gap-1 rounded-box bg-base-100 p-1.5 shadow-lg"
              data-testid="group-call-reactions"
            >
              {#each CALL_REACTIONS as emoji (emoji)}
                <button
                  class="btn btn-square text-xl btn-ghost btn-sm"
                  onclick={() => react(emoji)}
                >
                  {emoji}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
