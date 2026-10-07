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
  import { untrack, tick } from 'svelte';
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
    sendReaction,
    setCameraBackground
  } from '$lib/services/livekit-connection.svelte.js';
  import {
    SCREEN_SHARE_QUALITIES,
    getAudioProcessing,
    getCustomBackground,
    getParticipantVolume,
    getScreenShareQuality,
    setCustomBackground,
    setScreenShareQuality,
    TILE_CAPS,
    getCallLayout,
    setCallLayout,
    getTileCap,
    setTileCap
  } from '$lib/services/call-prefs.js';
  import {
    BACKGROUND_PRESETS,
    backgroundEffectsSupported,
    imageFileToDataUrl
  } from '$lib/groups/call-background.js';
  import {
    CALL_LAYOUTS,
    fitGrid,
    maxPins,
    nextPins,
    paginate,
    pickStage,
    togglePinKey
  } from '$lib/groups/call-layout.js';
  import { orderSeats, moveSeat } from '$lib/groups/call-tile-order.js';
  import { getTilePlacements, setTilePlacements } from '$lib/groups/call-tile-placements.svelte.js';
  import { isGuestParticipant } from '$lib/groups/livekit.js';
  import { trackOnScreen as trackNodeOnScreen } from '$lib/groups/track-on-screen.js';
  import { Track } from 'livekit-client';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { showToast } from '$lib/helpers/toast';
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
    LinkIcon,
    MoreIcon,
    GridIcon,
    ChevronLeftIcon,
    ChevronRightIcon
  } from '$lib/components/icons';
  import ParticipantTile from './ParticipantTile.svelte';
  import ScreenShareTile from './ScreenShareTile.svelte';
  import { getCallChatUnread } from '$lib/groups/call-chat-unread.svelte.js';
  import CallUnreadDot from './CallUnreadDot.svelte';
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
  // Unseen call chat behind the "Chat" button (not while the chat is open
  // beside the stage — it is on screen then).
  const chatUnread = getCallChatUnread();
  const chatUnreadHere = $derived(!chatOpen && chatUnread.count > 0);

  // Tell the call store a stage is on screen (the dock steps aside, the
  // channel lists say "you're in the call" instead of "show call"). The
  // CALL is untracked too: the store's register reads and writes its own
  // `$state` counter, and a tracked call made this effect depend on the
  // signal it bumps — effect_update_depth_exceeded on join (2026-09-28).
  $effect(() => {
    const node = rootEl;
    if (!node) return;
    return untrack(() => trackOnScreen(node));
  });

  /** @param {HTMLElement} node */
  function trackOnScreen(node) {
    if (!registerView) return;
    return trackNodeOnScreen(node, registerView);
  }

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

  // The parent asks "Anruf verlassen?" first (leaveGroupCallWithConfirm),
  // which also plays the leave cue once confirmed.
  function handleLeave() {
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

  // Natural seat order: me first, then everyone in the order they came.
  /** @type {SeatItem[]} */
  const baseSeats = $derived.by(() => {
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

  // Raised hands come first, first raised first (lk.raisedHands iterates in
  // queue order); a lowered hand goes back to its natural place. Tiles the
  // viewer placed by hand (drag and drop, Alt+arrow) keep their slot and are
  // not promoted — see orderSeats for the rule.
  const handKeys = $derived([...lk.raisedHands].map((id) => `seat:${id}`));
  const placements = $derived(getTilePlacements(lk.room));
  /** @type {SeatItem[]} */
  const seats = $derived.by(() => {
    const byKey = new Map(baseSeats.map((s) => [s.key, s]));
    return orderSeats(
      baseSeats.map((s) => s.key),
      handKeys,
      placements
    ).map((k) => /** @type {SeatItem} */ (byKey.get(k)));
  });

  // --- Reordering: local to this viewer, kept for the call ---
  let tileAnnouncement = $state('');
  const moveHintId = `call-tile-move-hint-${Math.random().toString(36).slice(2, 8)}`;
  /** @param {string} key @param {number} toIndex */
  function moveTile(key, toIndex) {
    const order = seats.map((s) => s.key);
    const target = Math.min(Math.max(0, toIndex), order.length - 1);
    if (order.indexOf(key) === target) return;
    setTilePlacements(lk.room, moveSeat(order, key, target, placements));
    announce(m.groups_call_tile_moved({ position: target + 1, total: order.length }));
  }
  // Cleared first, set after a tick: the same text twice in a row ("Position
  // 3 von 4" again) must be announced again.
  /** @param {string} text */
  async function announce(text) {
    tileAnnouncement = '';
    await tick();
    tileAnnouncement = text;
  }
  /** @param {KeyboardEvent} event @param {string} key */
  async function onTileKeyDown(event, key) {
    // Only the focused tile itself: Alt+arrow inside its controls (the
    // volume slider) belongs to them.
    if (event.target !== event.currentTarget) return;
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const from = seats.findIndex((s) => s.key === key);
    moveTile(key, from + (event.key === 'ArrowLeft' ? -1 : 1));
    // The keyed block moved the node: keep the focus on the moved tile.
    await tick();
    for (const el of rootEl?.querySelectorAll('[data-seat-key]') ?? []) {
      if (/** @type {HTMLElement} */ (el).dataset.seatKey === key) {
        /** @type {HTMLElement} */ (el).focus();
      }
    }
  }

  // Pointer drag (mouse, pen and touch alike): a press that moves a few
  // pixels picks the tile up, releasing over another tile puts it there.
  /** @type {string | null} */
  let draggingKey = $state(null);
  /** @type {string | null} */
  let dropKey = $state(null);
  const DRAG_THRESHOLD = 6;
  // Ends a drag in progress (window listeners off); also on unmount mid-drag.
  /** @type {(() => void) | null} */
  let stopDrag = null;
  $effect(() => () => stopDrag?.());
  /** @param {PointerEvent} event @param {string} key */
  function onTilePointerDown(event, key) {
    if (event.button !== 0 || seats.length < 2) return;
    const target = /** @type {Element | null} */ (event.target);
    if (target?.closest?.('button, input, select, textarea, [role="slider"]')) return;
    const doc = rootEl?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let active = false;
    // The release would also "click" a profile link under the pointer.
    /** @param {Event} c */
    const swallow = (c) => {
      c.preventDefault();
      c.stopPropagation();
    };
    /** @param {PointerEvent} e */
    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        draggingKey = key;
      }
      const over = doc.elementFromPoint(e.clientX, e.clientY)?.closest('[data-seat-key]');
      const overKey = over instanceof win.HTMLElement ? (over.dataset.seatKey ?? null) : null;
      dropKey = overKey && overKey !== key ? overKey : null;
    };
    const detach = () => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', finish);
      win.removeEventListener('pointercancel', finish);
      if (stopDrag === detach) stopDrag = null;
    };
    const finish = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId !== pointerId) return;
      detach();
      // The tile it was dropped on may have left the call meanwhile: then
      // nothing moves (no jump to the first slot).
      const to = dropKey ? seats.findIndex((s) => s.key === dropKey) : -1;
      if (active && e.type === 'pointerup' && to >= 0) moveTile(key, to);
      if (active) {
        win.addEventListener('click', swallow, true);
        win.setTimeout(() => win.removeEventListener('click', swallow, true), 0);
      }
      draggingKey = null;
      dropKey = null;
    };
    stopDrag?.();
    stopDrag = detach;
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', finish);
    win.addEventListener('pointercancel', finish);
  }

  /** @type {Array<ShareItem | SeatItem>} */
  const items = $derived([...shares, ...seats]);

  // --- Layout: Raster / Fokus / Nebeneinander / Sprecher, remembered on
  // this device (call-prefs). The pure rules live in groups/call-layout.js.
  /** @typedef {import('$lib/groups/call-layout.js').CallLayout} CallLayout */
  /** @type {CallLayout} */
  let layout = $state(getCallLayout());
  /** @type {Record<CallLayout, () => string>} */
  const LAYOUT_LABELS = {
    grid: m.groups_call_layout_grid,
    focus: m.groups_call_layout_focus,
    side: m.groups_call_layout_side,
    speaker: m.groups_call_layout_speaker
  };
  /** @param {CallLayout} next */
  function pickLayout(next) {
    setCallLayout(next);
    layout = next;
    openMenu = null;
  }

  // --- Pins: a pinned item takes a spotlight slot (two side by side) ---
  /** @type {string[]} */
  let pins = $state.raw([]);
  // Shares already seen on this stage (plain: bookkeeping, not UI state).
  /** @type {Set<string>} */
  const seenShares = new Set();

  // A NEW remote share is pinned; your own share never is (showing your
  // screen to yourself big is a hall of mirrors). A pin whose item left the
  // call is dropped, and a layout with fewer slots keeps the newest pins.
  $effect(() => {
    const remoteShareKeys = shares.filter((s) => !s.isLocal).map((s) => s.key);
    const itemKeys = items.map((i) => i.key);
    const max = maxPins(layout);
    const current = untrack(() => pins);
    const next = nextPins(current, itemKeys, remoteShareKeys, seenShares, max);
    if (next !== current) pins = next;
  });

  /** @param {string} key */
  function togglePin(key) {
    pins = togglePinKey(pins, key, maxPins(layout));
  }

  // --- Active speaker: the remote seat heard last with its mic on. Sticks
  // through silence until someone else speaks (Sprecher layout; also the
  // fallback for a free slot). LiveKit's speaker detection counts
  // microphone tracks only, so a shared tab's sound never "speaks".
  /** @type {string | null} */
  let speakerKey = $state(null);
  $effect(() => {
    const me = lk.localParticipant?.identity;
    const heard = [...lk.speakingParticipantIds].find(
      (id) => id !== me && !lk.mutedIdentities.has(id)
    );
    if (heard) speakerKey = `seat:${heard}`;
  });

  const stagePick = $derived(
    pickStage({
      layout,
      pins,
      itemKeys: items.map((i) => i.key),
      remoteShareKeys: shares.filter((s) => !s.isLocal).map((s) => s.key),
      speakerKey,
      localKeys: items.filter((i) => i.isLocal).map((i) => i.key)
    })
  );
  const itemsByKey = $derived(new Map(items.map((i) => [i.key, i])));
  /** @type {Array<ShareItem | SeatItem>} */
  const slotItems = $derived(
    stagePick.slots.map((k) => /** @type {ShareItem | SeatItem} */ (itemsByKey.get(k)))
  );
  /** @type {Array<ShareItem | SeatItem>} */
  const strip = $derived(
    stagePick.strip.map((k) => /** @type {ShareItem | SeatItem} */ (itemsByKey.get(k)))
  );
  const spotlight = $derived(slotItems.length > 0);

  // --- Grid pages: at most `tileCap` tiles at once; the rest wait on the
  // next pages. Tiles off the page are not rendered at all, so no video
  // element asks for their stream (adaptive stream drops it); their audio
  // keeps playing (attached centrally by the call service).
  /** @type {9 | 16 | 25} */
  let tileCap = $state(getTileCap());
  /** @param {9 | 16 | 25} cap */
  function pickCap(cap) {
    setTileCap(cap);
    tileCap = cap;
    openMenu = null;
  }
  let page = $state(0);
  const paging = $derived(paginate(items.length, page, tileCap));
  const pageItems = $derived(items.slice(paging.start, paging.end));
  /** @param {number} delta */
  function goPage(delta) {
    page = paginate(items.length, paging.page + delta, tileCap).page;
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
    fitGrid(
      pageItems.length,
      Math.max(0, gridWidth - 2 * PAD),
      Math.max(0, gridHeight - 2 * PAD),
      GAP
    )
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
  // "1. Name, 2. Name …" — who is waiting, in the order they raised.
  const handNames = $derived(
    [...lk.raisedHands].map((identity) => {
      const seat = baseSeats.find((s) => s.participant.identity === identity);
      if (seat?.isLocal) return m.groups_call_tile_you();
      return seat ? nameOf(seat.participant) : nameOf({ identity });
    })
  );
  // The pill's list opens on mouse hover, keyboard focus, or a tap (which
  // toggles). A tap also focuses the pill: the click right after that
  // focus-open must not close it again.
  let handsOpen = $state(false);
  let handsOpenedAt = 0;
  /** @type {HTMLButtonElement | undefined} */
  let handsPillEl = $state(undefined);
  function showHands() {
    if (handsOpen) return;
    handsOpen = true;
    handsOpenedAt = Date.now();
  }
  function hideHands() {
    handsOpen = false;
    handsOpenedAt = 0;
  }
  function tapHands() {
    if (handsOpen && Date.now() - handsOpenedAt < 400) return;
    if (handsOpen) hideHands();
    else handsOpen = true;
  }
  /** @param {PointerEvent} event @param {boolean} enter */
  function hoverHands(event, enter) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (enter) showHands();
    else hideHands();
  }
  /** @param {string} identity */
  function reactionsOf(identity) {
    return lk.reactions.filter((r) => r.identity === identity);
  }

  // --- Menus (one open at a time; outside click / Escape closes) ---
  /** @type {'mic' | 'camera' | 'screen' | 'react' | 'layout' | null} */
  let openMenu = $state(null);
  /** @param {'mic' | 'camera' | 'screen' | 'react' | 'layout'} name */
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
      if (event.key === 'Escape') {
        openMenu = null;
        hideHands();
      }
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

  // Camera background: blur or an image, applied in this browser before the
  // video leaves it. Hidden where the browser cannot run the processor.
  const backgroundSupported = backgroundEffectsSupported();
  /** @type {Record<string, () => string>} */
  const PRESET_LABELS = {
    paper: m.groups_call_background_paper,
    teal: m.groups_call_background_teal,
    shelf: m.groups_call_background_shelf
  };
  let customBackground = $state(getCustomBackground());
  /** @type {HTMLInputElement | undefined} */
  let backgroundFileInput = $state();
  /** @param {string} effect */
  async function pickBackground(effect) {
    try {
      await setCameraBackground(effect);
    } catch (err) {
      console.warn('background effect failed:', err);
      showToast(m.groups_call_background_failed(), 'error');
    }
  }
  /** @param {Event} event */
  async function onBackgroundFile(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let dataUrl;
    try {
      dataUrl = await imageFileToDataUrl(file);
    } catch (err) {
      console.warn('background image unreadable:', err);
      showToast(m.groups_call_background_failed(), 'error');
      return;
    }
    if (!setCustomBackground(dataUrl)) {
      showToast(m.groups_call_background_store_failed(), 'error');
      return;
    }
    customBackground = dataUrl;
    await pickBackground('custom');
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
  // The full picker ("Weitere Emojis"): loaded on first open only.
  const EmojiPickerLazy = lazyComponent(() => import('./CallEmojiPicker.svelte'));
  let pickerOpen = $state(false);
  $effect(() => {
    if (openMenu !== 'react') pickerOpen = false;
  });
  /** @param {string | {shortcode: string, url: string}} emoji */
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
      pinned={pins.includes(it.key)}
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
      pinned={pins.includes(it.key)}
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
  wide window, so the header's labels answer to the STAGE's width (@lg:),
  not the viewport's (laoc, 2026-10-02: the button row widened the page). -->
<!-- cursor-default + select-none for the whole stage: every badge, name and
  label in here is decoration (laoc 2026-10-03: the I-beam over the Gast
  pill). Buttons and links bring their own pointer; seats in the grid the
  grab cursor (they can be dragged). The cursor inherits, so this one place
  covers ParticipantTile and ScreenShareTile too. -->
<div
  bind:this={rootEl}
  class="@container flex min-h-0 min-w-0 flex-1 cursor-default flex-col select-none"
  data-testid="group-call-stage"
>
  <!-- Header -->
  <!-- Tighter below the stage's @lg so the title keeps its letters (QA K4). -->
  <div
    class="relative flex items-center justify-between gap-1.5 border-b border-base-300 px-3 py-2 @lg:gap-2 @lg:px-4"
  >
    <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden @lg:gap-2">
      <MeetIcon class_="w-5 h-5 shrink-0 text-primary" />
      <h2 class="min-w-0 flex-1 truncate font-semibold">{title}</h2>
      {#if !lk.canPublish}
        <span class="badge shrink-0 badge-ghost badge-sm" data-testid="group-call-listen-only">
          {m.groups_call_listen_only()}
        </span>
      {/if}
      {#if handCount > 0}
        <button
          bind:this={handsPillEl}
          type="button"
          class="badge shrink-0 cursor-pointer gap-1 badge-sm badge-warning select-none"
          aria-expanded={handsOpen}
          aria-controls={handsOpen ? 'group-call-hands-list' : undefined}
          aria-label={`${m.groups_call_hands_raised({ count: handCount })}: ${m.groups_call_hands_order()}`}
          data-testid="group-call-hands"
          onpointerenter={(e) => hoverHands(e, true)}
          onpointerleave={(e) => hoverHands(e, false)}
          onfocus={showHands}
          onblur={hideHands}
          onclick={tapHands}
        >
          <HandIcon class_="h-3 w-3" title="" />
          {m.groups_call_hands_raised({ count: handCount })}
        </button>
      {/if}
    </div>
    {#if handsOpen && handCount > 0}
      <!-- Outside the title row's overflow-hidden, so it is never clipped. -->
      <div
        id="group-call-hands-list"
        class="absolute top-full z-30 mt-1 max-w-64 cursor-default rounded-box bg-base-100 p-2 text-sm shadow-lg select-none"
        style="left: {Math.max(12, handsPillEl?.offsetLeft ?? 12)}px"
        data-testid="group-call-hands-list"
      >
        <p class="mb-1 text-xs text-base-content/60">{m.groups_call_hands_order()}</p>
        <ol>
          {#each handNames as name, i (i)}
            <li class="truncate">{i + 1}. {name}</li>
          {/each}
        </ol>
      </div>
    {/if}
    <div class="flex shrink-0 items-center gap-1 @lg:gap-2">
      {#if onInvite}
        <button
          class="btn btn-square btn-ghost btn-sm @lg:w-auto @lg:px-3"
          onclick={onInvite}
          title={m.groups_call_invite_title()}
          aria-label={m.groups_call_invite_title()}
          data-testid="group-call-invite"
        >
          <LinkIcon class_="h-4 w-4" title="" />
          <span class="hidden @lg:inline">{m.groups_call_invite_button()}</span>
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
      <div class="relative" data-call-menu>
        <button
          class="btn px-2 btn-ghost btn-sm @lg:px-3"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'layout'}
          aria-label={`${m.groups_call_layout()}: ${LAYOUT_LABELS[layout]()}`}
          title={`${m.groups_call_layout()}: ${LAYOUT_LABELS[layout]()}`}
          data-testid="group-call-layout"
          onclick={() => toggleMenu('layout')}
        >
          <GridIcon class_="h-4 w-4" title="" />
          <span class="hidden @lg:inline">{LAYOUT_LABELS[layout]()}</span>
        </button>
        {#if openMenu === 'layout'}
          <ul
            class="menu absolute top-full right-0 z-30 mt-1 w-56 rounded-box bg-base-100 p-2 shadow-lg"
            role="menu"
            data-testid="group-call-layout-menu"
          >
            <li class="menu-title text-xs">{m.groups_call_layout()}</li>
            {#each CALL_LAYOUTS as l (l)}
              <li>
                <button
                  class="text-sm"
                  role="menuitemradio"
                  aria-checked={layout === l}
                  class:menu-active={layout === l}
                  onclick={() => pickLayout(l)}
                >
                  {LAYOUT_LABELS[l]()}
                </button>
              </li>
            {/each}
            <li class="mt-1 menu-title text-xs">{m.groups_call_tiles_per_page()}</li>
            {#each TILE_CAPS as cap (cap)}
              <li>
                <button
                  class="text-sm"
                  role="menuitemradio"
                  aria-checked={tileCap === cap}
                  class:menu-active={tileCap === cap}
                  onclick={() => pickCap(cap)}
                >
                  {cap}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if onShowChat}
        <button
          class="btn relative btn-square btn-ghost btn-sm @lg:w-auto @lg:px-3 {chatOpen
            ? 'btn-active'
            : ''}"
          onclick={onShowChat}
          aria-pressed={chatOpen}
          aria-label={chatUnreadHere
            ? `${m.groups_call_show_chat()} – ${m.groups_call_chat_unread()}`
            : m.groups_call_show_chat()}
          title={m.groups_call_show_chat()}
          data-testid="group-call-show-chat"
        >
          <ChatIcon class_="h-4 w-4" />
          <span class="hidden @lg:inline">{m.groups_call_show_chat()}</span>
          {#if chatUnreadHere}
            <CallUnreadDot class="absolute top-1 right-1" />
          {/if}
        </button>
      {/if}
      <button class="btn btn-sm btn-error" onclick={handleLeave} data-testid="group-call-leave">
        {m.groups_call_leave()}
      </button>
    </div>
  </div>

  <span id={moveHintId} class="sr-only">{m.groups_call_tile_move_hint()}</span>
  <p class="sr-only" aria-live="polite" data-testid="group-call-tile-announce">
    {tileAnnouncement}
  </p>

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
      <!-- One slot (Fokus, Sprecher, a pin) or two side by side (Nebeneinander;
        stacked below the stage's @md so a phone still shows both). -->
      <div class="flex min-h-0 flex-1 flex-col gap-2 @md:flex-row" data-testid="group-call-slots">
        {#each slotItems as it (it.key)}
          <div class="relative min-h-0 min-w-0 flex-1" data-testid={`call-item-${it.key}`}>
            {@render item(it, false)}
          </div>
        {/each}
      </div>
      {#if strip.length > 0}
        <div class="flex h-24 shrink-0 gap-2 overflow-x-auto" data-testid="group-call-strip">
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
          {#each pageItems as it (it.key)}
            {#if it.kind === 'seat'}
              <!-- A seat can be reordered: dragged (pointer/touch, so no
                touch scrolling on it) or moved with Alt+←/→ when focused.
                A focusable group, not a button: it holds its own controls
                (pin, volume, profile link). -->
              <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
              <div
                class="relative touch-none rounded-lg outline-offset-2 {measured
                  ? ''
                  : 'aspect-video'} {draggingKey === it.key
                  ? 'cursor-grabbing opacity-50'
                  : 'cursor-grab'} {dropKey === it.key ? 'ring-2 ring-primary ring-offset-2' : ''}"
                style={tileStyle}
                role="group"
                tabindex="0"
                aria-label={it.isLocal ? m.groups_call_tile_you() : nameOf(it.participant)}
                aria-describedby={moveHintId}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                data-seat-key={it.key}
                data-drop-target={dropKey === it.key ? 'true' : undefined}
                data-testid={`call-item-${it.key}`}
                onkeydown={(e) => onTileKeyDown(e, it.key)}
                onpointerdown={(e) => onTilePointerDown(e, it.key)}
                ondragstart={(e) => e.preventDefault()}
              >
                {@render item(it, false)}
              </div>
            {:else}
              <div
                class="relative {measured ? '' : 'aspect-video'}"
                style={tileStyle}
                data-testid={`call-item-${it.key}`}
              >
                {@render item(it, false)}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>
    {#if paging.pageCount > 1}
      <div
        class="flex shrink-0 items-center justify-center gap-2 px-2 pb-1 text-xs text-base-content/70"
        data-testid="group-call-pager"
      >
        <button
          class="btn btn-circle btn-ghost btn-xs"
          aria-label={m.groups_call_page_prev()}
          title={m.groups_call_page_prev()}
          disabled={paging.page === 0}
          onclick={() => goPage(-1)}
        >
          <ChevronLeftIcon class_="h-4 w-4" title="" />
        </button>
        <span class="tabular-nums">
          {m.groups_call_page({ page: paging.page + 1, total: paging.pageCount })}
        </span>
        <button
          class="btn btn-circle btn-ghost btn-xs"
          aria-label={m.groups_call_page_next()}
          title={m.groups_call_page_next()}
          disabled={paging.page >= paging.pageCount - 1}
          onclick={() => goPage(1)}
        >
          <ChevronRightIcon class_="h-4 w-4" title="" />
        </button>
      </div>
    {/if}
  {/if}

  <!-- Controls -->
  {#if lk.isConnected}
    <!-- No top border (laoc, 2026-10-02: looked redundant against the tiles
         above and the chat column's own borders); the padding alone still
         reads as a control bar. -->
    <div
      class="mt-auto flex shrink-0 flex-wrap items-center justify-center gap-3 px-4 py-3"
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
                class="menu absolute bottom-full left-0 z-30 mb-2 max-h-[70vh] w-64 flex-nowrap overflow-y-auto rounded-box bg-base-100 p-2 shadow-lg"
                data-testid="group-call-camera-menu"
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

                {#if backgroundSupported}
                  <li class="mt-1 menu-title text-xs">{m.groups_call_background()}</li>
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={lk.backgroundEffect === 'none'}
                      onclick={() => pickBackground('none')}
                    >
                      {m.groups_call_background_none()}
                    </button>
                  </li>
                  <li>
                    <button
                      class="text-sm"
                      class:menu-active={lk.backgroundEffect === 'blur'}
                      onclick={() => pickBackground('blur')}
                    >
                      {m.groups_call_background_blur()}
                    </button>
                  </li>
                  {#each BACKGROUND_PRESETS as preset (preset.id)}
                    <li>
                      <button
                        class="text-sm"
                        class:menu-active={lk.backgroundEffect === `preset:${preset.id}`}
                        onclick={() => pickBackground(`preset:${preset.id}`)}
                      >
                        <img src={preset.src} alt="" class="h-5 w-9 rounded-sm object-cover" />
                        {PRESET_LABELS[preset.id]?.() ?? preset.id}
                      </button>
                    </li>
                  {/each}
                  {#if customBackground}
                    <li>
                      <button
                        class="text-sm"
                        class:menu-active={lk.backgroundEffect === 'custom'}
                        onclick={() => pickBackground('custom')}
                      >
                        <img
                          src={customBackground}
                          alt=""
                          class="h-5 w-9 rounded-sm object-cover"
                        />
                        {m.groups_call_background_custom()}
                      </button>
                    </li>
                  {/if}
                  <li>
                    <button
                      class="grid-flow-row justify-items-start gap-0 text-sm"
                      onclick={() => backgroundFileInput?.click()}
                    >
                      {m.groups_call_background_upload()}
                      <span class="text-xs text-base-content/60"
                        >{m.groups_call_background_upload_hint()}</span
                      >
                    </button>
                    <input
                      bind:this={backgroundFileInput}
                      type="file"
                      accept="image/*"
                      class="hidden"
                      data-testid="group-call-background-file"
                      onchange={onBackgroundFile}
                    />
                  </li>
                {/if}
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
              class="absolute right-0 bottom-full z-30 mb-2 flex flex-col gap-1 rounded-box bg-base-100 p-1.5 shadow-lg"
            >
              {#if pickerOpen}
                {#if EmojiPickerLazy.Component}
                  <EmojiPickerLazy.Component onPick={react} />
                {:else}
                  <div class="flex h-80 w-72 items-center justify-center">
                    <span class="loading loading-md loading-spinner"></span>
                  </div>
                {/if}
              {/if}
              <div class="flex gap-1" data-testid="group-call-reactions">
                {#each CALL_REACTIONS as emoji (emoji)}
                  <button
                    class="btn btn-square text-xl btn-ghost btn-sm"
                    onclick={() => react(emoji)}
                  >
                    {emoji}
                  </button>
                {/each}
                <button
                  class="btn btn-square btn-ghost btn-sm"
                  aria-label={m.groups_call_more_emojis()}
                  title={m.groups_call_more_emojis()}
                  aria-expanded={pickerOpen}
                  onclick={() => (pickerOpen = !pickerOpen)}
                >
                  <MoreIcon class_="h-5 w-5" title="" />
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
