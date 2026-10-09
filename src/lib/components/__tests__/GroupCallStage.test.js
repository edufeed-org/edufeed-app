// @ts-nocheck
/**
 * GroupCallStage — the in-call UI hosted in a channel's stage slot. A pure
 * view: the call store owns the connection (so the call survives leaving
 * the channel), so mounting/unmounting never connects or disconnects. It
 * registers itself as an on-screen view, hides publish controls for a
 * listen-only token, and carries the call controls: mic/camera/screen with
 * their menus, raise hand, reactions, reconnect bar and spotlight.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { lk, svc, media, bg } = vi.hoisted(() => ({
  lk: {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    isCameraOff: true,
    isScreenSharing: false,
    screenShareAudioMissing: false,
    canPublish: true,
    canSignal: true,
    connectionState: 'connected',
    joinedAt: 0,
    localParticipant: null,
    remoteParticipants: [],
    mutedIdentities: new Set(),
    raisedHands: new Set(),
    reactions: [],
    room: null,
    speakingParticipantIds: new Set(),
    audioInputDevices: [],
    activeAudioDeviceId: '',
    audioOutputDevices: [],
    activeAudioOutputDeviceId: '',
    videoInputDevices: [],
    activeVideoDeviceId: '',
    backgroundEffect: 'none'
  },
  svc: {
    connectToRoom: vi.fn(),
    disconnectFromRoom: vi.fn(async () => {}),
    setHandRaised: vi.fn(async () => {}),
    sendReaction: vi.fn(async () => {}),
    setAudioProcessingLive: vi.fn(async () => {}),
    setParticipantVolume: vi.fn((_pk, v) => v),
    canSelectSpeaker: vi.fn(() => false),
    refreshAudioDevices: vi.fn(),
    refreshVideoDevices: vi.fn(),
    setCameraBackground: vi.fn(async () => {})
  },
  media: {
    toggleMute: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    showToast: vi.fn(),
    playLeaveSound: vi.fn()
  },
  bg: {
    supported: true,
    imageFileToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,OWN')
  }
}));

vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  CALL_REACTIONS: ['👍', '🎉'],
  connectToRoom: svc.connectToRoom,
  disconnectFromRoom: svc.disconnectFromRoom,
  toggleMute: (...a) => media.toggleMute(...a),
  toggleCamera: (...a) => media.toggleCamera(...a),
  toggleScreenShare: (...a) => media.toggleScreenShare(...a),
  refreshAudioDevices: svc.refreshAudioDevices,
  switchAudioDevice: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
  refreshVideoDevices: svc.refreshVideoDevices,
  switchVideoDevice: vi.fn(),
  setParticipantVolume: svc.setParticipantVolume,
  setAudioProcessingLive: svc.setAudioProcessingLive,
  canSelectSpeaker: svc.canSelectSpeaker,
  setHandRaised: svc.setHandRaised,
  sendReaction: svc.sendReaction,
  setCameraBackground: (...a) => svc.setCameraBackground(...a),
  getLiveKitState: () => lk
}));
vi.mock('$lib/groups/call-background.js', () => ({
  BACKGROUND_PRESETS: [
    { id: 'paper', src: '/call-backgrounds/paper.svg' },
    { id: 'shelf', src: '/call-backgrounds/shelf.svg' }
  ],
  backgroundEffectsSupported: () => bg.supported,
  imageFileToDataUrl: (...a) => bg.imageFileToDataUrl(...a),
  parseBackgroundEffect: (v) => v || 'none'
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: media.showToast }));
const moderateActiveCall = vi.fn(async () => {});
vi.mock('$lib/groups/group-call.svelte.js', async (importOriginal) => ({
  ...(await importOriginal()),
  moderateActiveCall: (...a) => moderateActiveCall(...a)
}));
vi.mock('$lib/services/call-sounds.js', () => ({ playLeaveSound: media.playLeaveSound }));
// The breakout store reaches the relay pool; the stage only reads its state
// and calls its actions.
const breakout = vi.hoisted(() => ({
  state: {
    session: null,
    currentRoom: null,
    rooms: [],
    membersByRoomId: {},
    presenceByRoomId: {},
    remaining: null,
    busy: false,
    pending: null,
    joinRequest: null
  },
  returnToMain: vi.fn(async () => {}),
  startBreakout: vi.fn(async () => {}),
  endBreakout: vi.fn(async () => {}),
  extendBreakout: vi.fn(async () => {}),
  setBreakoutDeadline: vi.fn(async () => {}),
  sendCallBroadcast: vi.fn(async () => true),
  setSessionAutoAssign: vi.fn(),
  requestBreakoutRoom: vi.fn(async () => {}),
  moveParticipant: vi.fn(async () => {}),
  joinBreakoutRoom: vi.fn(async () => {}),
  ensureBreakoutListener: vi.fn(async () => {})
}));
vi.mock('$lib/groups/breakout.svelte.js', () => ({
  getBreakoutState: () => breakout.state,
  returnToMain: (...a) => breakout.returnToMain(...a),
  startBreakout: (...a) => breakout.startBreakout(...a),
  endBreakout: (...a) => breakout.endBreakout(...a),
  extendBreakout: (...a) => breakout.extendBreakout(...a),
  setBreakoutDeadline: (...a) => breakout.setBreakoutDeadline(...a),
  sendCallBroadcast: (...a) => breakout.sendCallBroadcast(...a),
  setSessionAutoAssign: (...a) => breakout.setSessionAutoAssign(...a),
  requestBreakoutRoom: (...a) => breakout.requestBreakoutRoom(...a),
  moveParticipant: (...a) => breakout.moveParticipant(...a),
  joinBreakoutRoom: (...a) => breakout.joinBreakoutRoom(...a),
  ensureBreakoutListener: (...a) => breakout.ensureBreakoutListener(...a)
}));
vi.mock('$lib/components/groups/call/BreakoutDialog.svelte', () => ({ default: Stub }));
vi.mock(
  '$lib/components/groups/call/BreakoutPanel.svelte',
  () => import('./fixtures/BreakoutPanelStub.svelte')
);
vi.mock(
  '$lib/components/groups/call/BreakoutBanner.svelte',
  () => import('./fixtures/BreakoutBannerStub.svelte')
);
vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } }
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
function Stub() {}
vi.mock(
  '$lib/components/groups/call/ParticipantTile.svelte',
  () => import('./fixtures/ParticipantTileStub.svelte')
);
vi.mock('$lib/components/groups/call/ScreenShareTile.svelte', () => ({ default: Stub }));
vi.mock(
  '$lib/components/groups/call/CallParticipantsPanel.svelte',
  () => import('./fixtures/CallParticipantsPanelStub.svelte')
);
vi.mock(
  '$lib/components/groups/call/CallEmojiPicker.svelte',
  () => import('./fixtures/CallEmojiPickerStub.svelte')
);
vi.mock('$lib/components/icons', async () => ({
  MeetIcon: Stub,
  ChevronDownIcon: Stub,
  MicIcon: Stub,
  MicOffIcon: Stub,
  // The camera pair renders distinguishable markers: the control must swap
  // icons with the camera state, not only recolour (issue "camera button
  // needs a struck-through icon").
  VideoIcon: (await import('./fixtures/VideoIconStub.svelte')).default,
  VideoOffIcon: (await import('./fixtures/VideoOffIconStub.svelte')).default,
  ScreenShareIcon: Stub,
  HandIcon: Stub,
  SmilePlusIcon: Stub,
  ChatIcon: Stub,
  ExternalLinkIcon: Stub,
  LinkIcon: Stub,
  MoreIcon: Stub,
  PeopleIcon: Stub,
  GridIcon: Stub,
  ChevronLeftIcon: Stub,
  ChevronRightIcon: Stub,
  CloseIcon: Stub,
  StarIcon: Stub,
  ChannelsIcon: Stub,
  ClockIcon: Stub,
  CallEndIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_more: () => 'More',
  groups_call_participants_close: () => 'Close participant list',
  groups_call_duration: ({ time }) => `Call duration ${time}`,
  groups_call_in_call: () => 'In the call',
  groups_breadcrumb_channels: () => 'Channels',
  groups_breadcrumb_channels_aria: () => 'Back to the channel list',
  groups_call_host_badge: () => 'Host',
  groups_call_cohost_badge: () => 'Co-host',
  groups_call_chat_unread: () => 'New messages in the call chat',
  groups_call_chat_mentions_unread: () => 'You were mentioned in the call chat',
  groups_call_leave: () => 'Leave call',
  groups_call_connecting: () => 'Connecting…',
  groups_call_listen_only: () => 'You are listening only',
  groups_call_mute: () => 'Mute',
  groups_call_unmute: () => 'Unmute',
  groups_call_camera_on: () => 'Camera on',
  groups_call_camera_off: () => 'Camera off',
  groups_call_select_microphone: () => 'Select microphone',
  groups_call_select_speaker: () => 'Select speaker',
  groups_call_select_camera: () => 'Select camera',
  groups_call_unknown_device: () => 'Unknown device',
  groups_call_screen_share_start: () => 'Share screen',
  groups_call_screen_share_stop: () => 'Stop sharing',
  groups_call_screen_share_you: () => 'You are sharing',
  groups_call_screen_share_active: (p) => `${p.name} is sharing`,
  groups_call_screen_share_quality: () => 'Sharing quality',
  groups_call_screen_share_audio: () => 'Share sound',
  groups_call_screen_share_audio_hint: () => 'Tab or system sound (Chrome, Edge).',
  groups_call_screen_share_audio_missing: () => 'The browser delivered no sound.',
  groups_call_screen_share_options: () => 'Screen options',
  groups_call_camera_options: () => 'Camera options',
  groups_call_mic_options: () => 'Mic options',
  groups_call_audio_processing: () => 'Audio processing',
  groups_call_noise_suppression: () => 'Noise suppression',
  groups_call_echo_cancellation: () => 'Echo cancellation',
  groups_call_auto_gain: () => 'Automatic volume',
  groups_call_reconnecting: () => 'Reconnecting…',
  groups_call_raise_hand: () => 'Raise hand',
  groups_call_lower_hand: () => 'Lower hand',
  groups_call_hands_raised: (p) => `${p.count} raised`,
  groups_call_hands_order: () => 'Order of raised hands',
  groups_call_tile_you: () => 'You',
  groups_call_react: () => 'React',
  groups_call_more_emojis: () => 'More emojis',
  groups_call_tile_moved: (p) => `Tile moved, position ${p.position} of ${p.total}`,
  groups_call_tile_move_hint: () => 'Alt+arrow keys move this tile',
  groups_call_show_chat: () => 'Chat',
  groups_call_participants: () => 'Participants',
  groups_call_participants_count: (p) => `Participants (${p.count})`,
  groups_call_layout: () => 'View',
  groups_call_layout_grid: () => 'Grid',
  groups_call_layout_focus: () => 'Focus',
  groups_call_layout_side: () => 'Side by side',
  groups_call_layout_speaker: () => 'Speaker',
  groups_call_tiles_per_page: () => 'Tiles per page',
  groups_call_page: (p) => `Page ${p.page} of ${p.total}`,
  groups_call_page_prev: () => 'Previous page',
  groups_call_page_next: () => 'Next page',
  groups_call_you_are_host: () => 'You are the host',
  groups_call_you_are_cohost: () => 'You are a co-host',
  groups_call_host_actions_title: () => 'Host actions',
  groups_call_mod_mute: () => 'Mute',
  groups_call_mod_stop_video: () => 'Stop camera',
  groups_call_mod_stop_screen: () => 'Stop screen share',
  groups_call_mod_remove: () => 'Remove from call',
  groups_call_mod_make_cohost: () => 'Make co-host',
  groups_call_mod_revoke_cohost: () => 'Remove co-host',
  groups_call_mod_remove_title: () => 'Remove from the call?',
  groups_call_mod_remove_body: (p) => `${p.name} will be disconnected.`,
  groups_call_mod_remove_action: () => 'Remove',
  groups_call_mod_done_mute: (p) => `${p.name} muted`,
  groups_call_mod_done_stop_video: (p) => `${p.name} camera stopped`,
  groups_call_mod_done_stop_screen: (p) => `${p.name} screen stopped`,
  groups_call_mod_done_remove: (p) => `${p.name} removed`,
  groups_call_mod_done_make_cohost: (p) => `${p.name} is co-host`,
  groups_call_mod_done_revoke_cohost: (p) => `${p.name} is no co-host`,
  groups_call_mod_failed: (p) => `failed: ${p.reason}`,
  common_cancel: () => 'Cancel',
  groups_call_pop_out: () => 'Pop out',
  groups_call_pop_in: () => 'Back to tab',
  groups_call_invite_title: () => 'Invite guests',
  groups_call_invite_button: () => 'Invite link',
  groups_call_error_mic_denied: () => 'Microphone access denied',
  groups_call_error_mic_missing: () => 'No microphone',
  groups_call_error_camera_denied: () => 'Camera access denied',
  groups_call_error_camera_missing: () => 'No camera',
  groups_call_error_device_busy: () => 'Device busy',
  groups_call_error_screen_denied: () => 'Screen capture blocked',
  groups_call_error_media_generic: () => 'Media failed',
  groups_call_background: () => 'Background',
  groups_call_background_none: () => 'None',
  groups_call_background_blur: () => 'Blur',
  groups_call_background_paper: () => 'Paper',
  groups_call_background_teal: () => 'Teal',
  groups_call_background_shelf: () => 'Bookshelf',
  groups_call_background_custom: () => 'Own image',
  groups_call_background_upload: () => 'Choose own image',
  groups_call_background_upload_hint: () => 'Stays on this device',
  groups_call_background_failed: () => 'Background failed',
  groups_call_background_store_failed: () => 'Image not saved',
  groups_call_breakout_title: () => 'Breakout rooms',
  groups_call_column_tab_participants: ({ count }) => `Participants ${count}`,
  groups_call_breakout_running_badge: () => 'Session running',
  groups_call_breakout_in_room: (p) => `Breakout room ${p.n}`,
  groups_call_breakout_time_left: (p) => `${p.time} left`,
  groups_call_breakout_back_to_main: () => 'Back to the main room'
}));

// bind:clientWidth measures through ResizeObserver, which jsdom lacks; an
// unmeasured stage falls back to the CSS grid, which is what we assert on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const unreadMod = await import('$lib/groups/call-chat-unread.svelte.js');
// The participant panel loads lazily: warm its (stubbed) module so the first
// open in a test is not at the mercy of vite's transform time.
await import('$lib/components/groups/call/CallParticipantsPanel.svelte');
const { default: GroupCallStage } = await import(
  '$lib/components/groups/call/GroupCallStage.svelte'
);

const HEX = 'b'.repeat(64);
const baseProps = {
  title: 'Standup',
  identityToPubkey: (id) => id.slice(0, 64),
  onLeave: vi.fn()
};

function remote(identity, { screenShare = false, metadata } = {}) {
  return {
    identity,
    sid: `sid-${identity}`,
    metadata,
    getTrackPublication: (source) =>
      screenShare && source === 'screen_share' ? { track: { sid: 'ss' } } : undefined
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(lk, {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    canPublish: true,
    canSignal: true,
    connectionState: 'connected',
    localParticipant: { identity: `${'a'.repeat(64)}:me`, getTrackPublication: () => undefined },
    remoteParticipants: [],
    raisedHands: new Set(),
    reactions: []
  });
});

describe('GroupCallStage — a view, not the connection owner', () => {
  it('never connects or disconnects on mount / unmount', () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    unmount();
    expect(svc.connectToRoom).not.toHaveBeenCalled();
    expect(svc.disconnectFromRoom).not.toHaveBeenCalled();
  });

  it('registers itself as an on-screen view while mounted', () => {
    const off = vi.fn();
    const registerView = vi.fn(() => off);
    const { unmount } = render(GroupCallStage, { props: { ...baseProps, registerView } });
    expect(registerView).toHaveBeenCalledTimes(1);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  // Below md the channel's "← Kanäle" only hides the chat (display:none):
  // the stage stays mounted. A stage without layout is not on screen — the
  // dock and the channel list's "Anruf anzeigen" must come back (review
  // 2026-10-02).
  it('counts as on screen only while it has a size', () => {
    /** @type {((entries: any[]) => void)[]} */
    const callbacks = [];
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      const off = vi.fn();
      const registerView = vi.fn(() => off);
      const { unmount } = render(GroupCallStage, { props: { ...baseProps, registerView } });
      expect(registerView).toHaveBeenCalledTimes(1);
      const report = (width, height) =>
        callbacks.forEach((cb) => cb([{ contentRect: { width, height } }]));
      report(0, 0);
      expect(off).toHaveBeenCalledTimes(1);
      report(0, 0);
      expect(off).toHaveBeenCalledTimes(1);
      report(400, 300);
      expect(registerView).toHaveBeenCalledTimes(2);
      report(400, 320);
      expect(registerView).toHaveBeenCalledTimes(2);
      unmount();
      expect(off).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });

  // Regression (live 2026-09-28, effect_update_depth_exceeded on join): the
  // REAL register reads and writes the store's `$state` counter; called
  // tracked inside the mount effect it re-ran the effect forever.
  it('registers with the real call store without an effect loop', async () => {
    const { registerCallStageView, getGroupCallState } = await import(
      '$lib/groups/group-call.svelte.js'
    );
    const { unmount } = render(GroupCallStage, {
      props: { ...baseProps, registerView: () => registerCallStageView('/x') }
    });
    await Promise.resolve();
    expect(getGroupCallState().stageViews).toBe(1);
    unmount();
    expect(getGroupCallState().stageViews).toBe(0);
  });

  it('leave hands the leave to the parent (which asks first and plays the cue)', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    // No cue here: a cancelled "Anruf verlassen?" must stay silent (Task 19).
    expect(media.playLeaveSound).not.toHaveBeenCalled();
    expect(baseProps.onLeave).toHaveBeenCalledTimes(1);
    expect(svc.disconnectFromRoom).not.toHaveBeenCalled();
  });

  it('offers a way back to the chat while staying in the call', async () => {
    const onShowChat = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onShowChat } });
    await fireEvent.click(screen.getByTestId('group-call-show-chat'));
    expect(onShowChat).toHaveBeenCalledTimes(1);
  });

  // Issue "notification dot for new messages": the call chat is hidden
  // behind this button, so it says when something new is in there.
  // Issue "@mentions of call participants": a mention is a stronger signal
  // than the dot — the button shows how many, and says so.
  it('shows a mention count on the chat button instead of the dot', async () => {
    unreadMod.resetCallChatUnread();
    render(GroupCallStage, { props: { ...baseProps, onShowChat: vi.fn() } });
    const button = screen.getByTestId('group-call-show-chat');
    unreadMod.noteCallChatReceived();
    unreadMod.noteCallChatMention();
    unreadMod.noteCallChatMention();
    flushSync();
    const badge = button.querySelector('[data-testid="call-chat-mention-badge"]');
    expect(badge.textContent.trim()).toBe('2');
    expect(button.querySelector('[data-testid="call-chat-unread-dot"]')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Chat – You were mentioned in the call chat');
  });

  it('shows an unread dot on the chat button while the chat is closed', () => {
    unreadMod.resetCallChatUnread();
    render(GroupCallStage, { props: { ...baseProps, onShowChat: vi.fn() } });
    const button = screen.getByTestId('group-call-show-chat');
    expect(button.querySelector('[data-testid="call-chat-unread-dot"]')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Chat');
    unreadMod.noteCallChatReceived();
    flushSync();
    expect(button.querySelector('[data-testid="call-chat-unread-dot"]')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Chat – New messages in the call chat');
    unreadMod.resetCallChatUnread();
  });

  it('shows no unread dot while the chat is open beside the stage', () => {
    unreadMod.resetCallChatUnread();
    unreadMod.noteCallChatReceived();
    render(GroupCallStage, { props: { ...baseProps, onShowChat: vi.fn(), chatOpen: true } });
    expect(screen.queryByTestId('call-chat-unread-dot')).toBeNull();
    unreadMod.resetCallChatUnread();
  });

  it('marks the chat button pressed while the chat is open beside the stage', () => {
    render(GroupCallStage, { props: { ...baseProps, onShowChat: vi.fn(), chatOpen: true } });
    expect(screen.getByTestId('group-call-show-chat').getAttribute('aria-pressed')).toBe('true');
  });

  // Design 1d ("Bühne"): the rare actions — invite, pop out, back to the
  // tab — sit behind one "More" button in the dock, which only exists when
  // there is something to put in it.
  it('offers the pop-out window only when the parent can open one', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-more')).toBeNull();
    expect(screen.queryByTestId('group-call-pop-out')).toBeNull();
    unmount();
    const onPopOut = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopOut } });
    expect(screen.queryByTestId('group-call-pop-out')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-call-more'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Pop out' }));
    expect(onPopOut).toHaveBeenCalledTimes(1);
    // Picking closes the menu.
    expect(screen.queryByTestId('group-call-more-menu')).toBeNull();
  });

  it('inside the pop-out: a way back to the tab', async () => {
    const onPopIn = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopIn } });
    await fireEvent.click(screen.getByTestId('group-call-more'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Back to tab' }));
    expect(onPopIn).toHaveBeenCalledTimes(1);
  });

  it('offers Einladungslink only when the parent passes onInvite', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-invite')).toBeNull();
    unmount();
    const onInvite = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onInvite } });
    await fireEvent.click(screen.getByTestId('group-call-more'));
    await fireEvent.click(screen.getByTestId('group-call-invite'));
    expect(onInvite).toHaveBeenCalled();
  });

  it('carries the way back to the channel list in the title pill when the parent has one', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-back')).toBeNull();
    unmount();
    const onBack = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onBack } });
    await fireEvent.click(screen.getByTestId('group-call-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("counts how long I have been in the call, from the connection's own join stamp", () => {
    lk.joinedAt = Date.now() - 65_000;
    render(GroupCallStage, { props: baseProps });
    const duration = screen.getByTestId('group-call-duration');
    expect(duration.textContent).toBe('1:05');
    expect(duration.getAttribute('aria-label')).toBe('Call duration 1:05');
    lk.joinedAt = 0;
  });

  it('no duration before the first join stamp', () => {
    lk.joinedAt = 0;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-duration')).toBeNull();
  });

  // The pop-out is another document: menus must close on clicks in the
  // document the stage is rendered in, not only the opener's.
  it('closes an open menu on a click outside it', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('React'));
    expect(screen.getByTestId('group-call-reactions')).toBeTruthy();
    await fireEvent.pointerDown(screen.getByTestId('group-call-stage'));
    expect(screen.queryByTestId('group-call-reactions')).toBeNull();
  });

  // Task 19 cursor audit: nothing in the stage is text to select; the cursor
  // inherits, so the stage root covers every badge (the Gast pill showed an
  // I-beam), while grid seats show they can be dragged.
  it('decoration gets the default cursor and no selection; seats the grab cursor', () => {
    lk.remoteParticipants = [remote(`${HEX}:x1`)];
    render(GroupCallStage, { props: baseProps });
    const stage = screen.getByTestId('group-call-stage');
    expect(stage.classList.contains('cursor-default')).toBe(true);
    expect(stage.classList.contains('select-none')).toBe(true);
    expect(screen.getByTestId(`call-item-seat:${HEX}:x1`).classList.contains('cursor-grab')).toBe(
      true
    );
  });

  it('renders inside the stage layout with the title', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-stage')).toBeTruthy();
    expect(screen.getByText('Standup')).toBeTruthy();
  });
});

describe('publish controls', () => {
  it('shows mic, camera and screen for a normal token', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTitle('Mute')).toBeTruthy();
    expect(screen.getByTitle('Camera on')).toBeTruthy();
    expect(screen.getByTitle('Share screen')).toBeTruthy();
    expect(screen.queryByText('You are listening only')).toBeNull();
  });

  it('shows the struck-through camera icon while the camera is off, the plain one while on', () => {
    lk.isCameraOff = true;
    const off = render(GroupCallStage, { props: baseProps });
    const button = screen.getByTitle('Camera on');
    expect(button.className).toContain('btn-error');
    expect(button.querySelector('[data-testid="video-off-icon"]')).toBeTruthy();
    expect(button.querySelector('[data-testid="video-icon"]')).toBeNull();
    off.unmount();

    lk.isCameraOff = false;
    try {
      render(GroupCallStage, { props: baseProps });
      const on = screen.getByTitle('Camera off');
      expect(on.className).not.toContain('btn-error');
      expect(on.querySelector('[data-testid="video-icon"]')).toBeTruthy();
      expect(on.querySelector('[data-testid="video-off-icon"]')).toBeNull();
    } finally {
      lk.isCameraOff = true;
    }
  });

  it('hides the camera button for an audio-only call', () => {
    render(GroupCallStage, { props: { ...baseProps, video: false } });
    expect(screen.queryByTitle('Camera on')).toBeNull();
  });

  it('listen-only: no mic/camera/screen, a hint, but hands and reactions stay', () => {
    lk.canPublish = false;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTitle('Mute')).toBeNull();
    expect(screen.queryByTitle('Camera on')).toBeNull();
    expect(screen.queryByTitle('Share screen')).toBeNull();
    expect(screen.getByText('You are listening only')).toBeTruthy();
    expect(screen.getByTitle('Raise hand')).toBeTruthy();
  });

  it('toasts why the microphone could not be enabled', async () => {
    media.toggleMute.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    );
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Mute'));
    await Promise.resolve();
    expect(media.showToast).toHaveBeenCalledWith('Microphone access denied', 'error');
  });

  it('the mic menu toggles audio processing live', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    expect(svc.refreshAudioDevices).toHaveBeenCalled();
    const toggle = screen.getByRole('checkbox', { name: 'Noise suppression' });
    expect(toggle.checked).toBe(true);
    await fireEvent.click(toggle);
    expect(svc.setAudioProcessingLive).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it('only lists speakers where the output can actually be chosen', async () => {
    lk.audioOutputDevices = [{ deviceId: 'spk', label: 'Headphones' }];
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    expect(screen.queryByText('Select speaker')).toBeNull();
    lk.audioOutputDevices = [];
  });

  describe('camera background', () => {
    beforeEach(() => {
      bg.supported = true;
      lk.backgroundEffect = 'none';
    });
    const openCameraMenu = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Camera options' }));

    it('offers none, blur and the presets, marking the active one', async () => {
      lk.backgroundEffect = 'blur';
      render(GroupCallStage, { props: baseProps });
      await openCameraMenu();
      const menu = screen.getByTestId('group-call-camera-menu');
      expect(menu.textContent).toContain('Background');
      expect(screen.getByRole('button', { name: 'Blur' }).className).toContain('menu-active');
      expect(screen.getByRole('button', { name: 'None' }).className).not.toContain('menu-active');
      expect(screen.getByRole('button', { name: 'Bookshelf' })).toBeTruthy();
      // no own image stored yet: only the way to choose one
      expect(screen.queryByRole('button', { name: 'Own image' })).toBeNull();
    });

    it('picks an effect through the service', async () => {
      render(GroupCallStage, { props: baseProps });
      await openCameraMenu();
      await fireEvent.click(screen.getByRole('button', { name: 'Paper' }));
      expect(svc.setCameraBackground).toHaveBeenCalledWith('preset:paper');
    });

    it('toasts when the effect cannot start', async () => {
      svc.setCameraBackground.mockRejectedValueOnce(new Error('no webgl2'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(GroupCallStage, { props: baseProps });
      await openCameraMenu();
      await fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
      await vi.waitFor(() =>
        expect(media.showToast).toHaveBeenCalledWith('Background failed', 'error')
      );
    });

    it('keeps an own image on this device and switches to it', async () => {
      render(GroupCallStage, { props: baseProps });
      await openCameraMenu();
      const input = screen.getByTestId('group-call-background-file');
      const file = new File(['x'], 'me.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await fireEvent.change(input);
      await vi.waitFor(() => expect(svc.setCameraBackground).toHaveBeenCalledWith('custom'));
      expect(bg.imageFileToDataUrl).toHaveBeenCalledWith(file);
      expect(localStorage.getItem('edufeed:call:backgroundImage')).toBe(
        'data:image/jpeg;base64,OWN'
      );
      expect(screen.getByRole('button', { name: 'Own image' })).toBeTruthy();
    });

    it('hides the section where the browser cannot run the effect', async () => {
      bg.supported = false;
      render(GroupCallStage, { props: baseProps });
      await openCameraMenu();
      expect(screen.queryByRole('button', { name: 'Blur' })).toBeNull();
    });
  });

  // Issue "share tab/system audio with the screen share": opt-in, per device.
  it('"Ton teilen" is off by default, toggles in the screen menu and is remembered', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Screen options' }));
    const toggle = screen.getByTestId('group-call-screen-share-audio');
    expect(toggle.checked).toBe(false);
    expect(screen.getByText('Tab or system sound (Chrome, Edge).')).toBeTruthy();
    await fireEvent.click(toggle);
    expect(localStorage.getItem('edufeed:call:screenShareAudio')).toBe('1');
    await fireEvent.click(toggle);
    expect(localStorage.getItem('edufeed:call:screenShareAudio')).toBe('0');
  });

  it('hints once, as info, when a share asked for sound but got none', async () => {
    media.toggleScreenShare.mockImplementationOnce(async () => {
      lk.isScreenSharing = true;
      lk.screenShareAudioMissing = true;
    });
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Share screen'));
    await vi.waitFor(() =>
      expect(media.showToast).toHaveBeenCalledWith('The browser delivered no sound.', 'info')
    );
    lk.isScreenSharing = false;
    lk.screenShareAudioMissing = false;
  });

  it('no hint when the share has its sound, or never asked for it', async () => {
    media.toggleScreenShare.mockImplementationOnce(async () => {
      lk.isScreenSharing = true;
      lk.screenShareAudioMissing = false;
    });
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Share screen'));
    await vi.waitFor(() => expect(media.toggleScreenShare).toHaveBeenCalled());
    expect(media.showToast).not.toHaveBeenCalled();
    lk.isScreenSharing = false;
  });

  it('picks and remembers a screen share quality', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Screen options' }));
    await fireEvent.click(screen.getByRole('button', { name: '720p · 15 fps' }));
    expect(localStorage.getItem('edufeed:call:screenShareQuality')).toBe('720p15');
  });
});

describe('hands, reactions, connection state', () => {
  it('raises and lowers my hand', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Raise hand'));
    expect(svc.setHandRaised).toHaveBeenCalledWith(true);
  });

  it('shows my hand as raised and lowers it', async () => {
    lk.raisedHands = new Set([lk.localParticipant.identity]);
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-hands').textContent).toContain('1 raised');
    await fireEvent.click(screen.getByTitle('Lower hand'));
    expect(svc.setHandRaised).toHaveBeenCalledWith(false);
  });

  const gridOrder = () =>
    [...screen.getByTestId('group-call-grid').querySelectorAll('[data-testid^="call-item-"]')].map(
      (el) => el.dataset.testid.replace('call-item-seat:', '')
    );

  it('raised hands move to the front in the order they went up; lowered ones go back', () => {
    const B = `${'b'.repeat(64)}:1`;
    const C = `${'c'.repeat(64)}:1`;
    const D = `${'d'.repeat(64)}:1`;
    lk.remoteParticipants = [remote(B), remote(C), remote(D)];
    lk.raisedHands = new Set([D, B]); // D raised first
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(gridOrder()).toEqual([D, B, lk.localParticipant.identity, C]);
    unmount();
    lk.raisedHands = new Set([B]);
    render(GroupCallStage, { props: baseProps });
    expect(gridOrder()).toEqual([B, lk.localParticipant.identity, C, D]);
  });

  describe('the hands pill lists who is waiting, in order', () => {
    const B = `${'b'.repeat(64)}:1`;
    const C = `${'c'.repeat(64)}:1`;
    beforeEach(() => {
      lk.remoteParticipants = [remote(B), remote(C)];
      lk.raisedHands = new Set([C, B]);
    });
    const list = () => screen.queryByTestId('group-call-hands-list');

    it('opens on hover and closes on leave', async () => {
      render(GroupCallStage, { props: baseProps });
      const pill = screen.getByTestId('group-call-hands');
      expect(list()).toBeNull();
      await fireEvent.pointerEnter(pill, { pointerType: 'mouse' });
      const items = [...list().querySelectorAll('li')].map((li) => li.textContent.trim());
      expect(items).toEqual([`1. ${'c'.repeat(8)}`, `2. ${'b'.repeat(8)}`]);
      await fireEvent.pointerLeave(pill, { pointerType: 'mouse' });
      expect(list()).toBeNull();
    });

    it('opens on keyboard focus, and a tap toggles it', async () => {
      render(GroupCallStage, { props: baseProps });
      const pill = screen.getByTestId('group-call-hands');
      expect(pill.tagName).toBe('BUTTON');
      await fireEvent.focus(pill);
      expect(list()).toBeTruthy();
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      await fireEvent.blur(pill);
      expect(list()).toBeNull();
      await fireEvent.click(pill);
      expect(list()).toBeTruthy();
      await fireEvent.click(pill);
      expect(list()).toBeNull();
    });

    it('points aria-controls at the list only while it is rendered', async () => {
      render(GroupCallStage, { props: baseProps });
      const pill = screen.getByTestId('group-call-hands');
      expect(pill.hasAttribute('aria-controls')).toBe(false);
      await fireEvent.click(pill);
      expect(document.getElementById(pill.getAttribute('aria-controls'))).toBe(list());
    });

    it('is display only: no buttons inside the list', async () => {
      render(GroupCallStage, { props: baseProps });
      await fireEvent.click(screen.getByTestId('group-call-hands'));
      expect(list().querySelector('button')).toBeNull();
    });
  });

  it('sends a reaction from the picker', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('React'));
    await fireEvent.click(screen.getByRole('button', { name: '🎉' }));
    expect(svc.sendReaction).toHaveBeenCalledWith('🎉');
    expect(screen.queryByTestId('group-call-reactions')).toBeNull();
  });

  // Task 19: the quick row keeps its defaults and ends in a "more" button
  // that opens the app's full emoji picker (lazy), custom emojis included.
  it('"More emojis" opens the full picker; any pick is sent and closes it', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('React'));
    const row = screen.getByTestId('group-call-reactions');
    const more = screen.getByRole('button', { name: 'More emojis' });
    expect(row.lastElementChild.contains(more)).toBe(true);
    expect(screen.getByRole('button', { name: '👍' })).toBeTruthy();
    expect(screen.queryByTestId('call-emoji-picker-stub')).toBeNull();
    await fireEvent.click(more);
    await screen.findByTestId('call-emoji-picker-stub');
    await fireEvent.click(screen.getByText('pick-custom'));
    expect(svc.sendReaction).toHaveBeenCalledWith({
      shortcode: 'parrot',
      url: 'https://x.org/p.gif'
    });
    expect(screen.queryByTestId('group-call-reactions')).toBeNull();
    await fireEvent.click(screen.getByTitle('React'));
    expect(screen.queryByTestId('call-emoji-picker-stub')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await fireEvent.click(await screen.findByText('pick-unicode'));
    expect(svc.sendReaction).toHaveBeenLastCalledWith('🫶');
  });

  it('no hands or reactions when the token cannot send data', () => {
    lk.canSignal = false;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTitle('Raise hand')).toBeNull();
    expect(screen.queryByTitle('React')).toBeNull();
  });

  it('shows a reconnecting bar while the connection recovers', () => {
    lk.connectionState = 'reconnecting';
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-reconnecting')).toBeTruthy();
  });
});

describe('layout', () => {
  it('everyone in an auto-fit grid when nothing is spotlighted', () => {
    lk.remoteParticipants = [remote(`${HEX}:x1`)];
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-grid')).toBeTruthy();
    expect(screen.getByTestId(`call-item-seat:${HEX}:x1`)).toBeTruthy();
    expect(screen.queryByTestId('group-call-spotlight')).toBeNull();
  });

  it('tiles start at the top of the video area, not centred in a tall box', () => {
    // laoc 2026-10-01: in a tall channel the centred grid sat far below the
    // header (and below the fold while the page itself grew).
    lk.remoteParticipants = [remote(`${HEX}:x1`)];
    render(GroupCallStage, { props: baseProps });
    const grid = screen.getByTestId('group-call-grid');
    expect(grid.classList.contains('content-start')).toBe(true);
    expect(grid.classList.contains('content-center')).toBe(false);
    const layer = grid.parentElement;
    expect(layer.classList.contains('items-start')).toBe(true);
    expect(layer.classList.contains('items-center')).toBe(false);
  });

  // Design 1d: the dock floats over the stage instead of taking a row of
  // its own; the tiles keep clear of it (and of the title row above).
  it('the dock floats along the bottom and the tiles keep clear of the chrome', () => {
    render(GroupCallStage, { props: baseProps });
    const controls = screen.getByTestId('group-call-controls');
    expect(controls.getAttribute('role')).toBe('toolbar');
    const layer = controls.parentElement;
    expect(layer.classList.contains('absolute')).toBe(true);
    expect(layer.classList.contains('bottom-0')).toBe(true);
    // The free space around the dock belongs to the tiles (drag targets).
    expect(layer.classList.contains('pointer-events-none')).toBe(true);
    expect(controls.classList.contains('pointer-events-auto')).toBe(true);
    const tiles = screen.getByTestId('group-call-tiles');
    expect(tiles.classList.contains('pt-16')).toBe(true);
    expect(tiles.classList.contains('pb-28')).toBe(true);
    expect(tiles.classList.contains('@xl:pb-20')).toBe(true);
    const videoArea = screen.getByTestId('group-call-grid').parentElement.parentElement;
    expect(videoArea.classList.contains('min-h-0')).toBe(true);
    expect(videoArea.classList.contains('flex-1')).toBe(true);
  });

  it('the chrome answers to the stage width, not the viewport: icon dock, truncating title', () => {
    // laoc 2026-10-02: beside the chat column the stage is narrow even on a
    // wide window. The stage is a size container; the dock is icons only
    // (every button carries its name) and the title pill truncates.
    render(GroupCallStage, {
      props: { ...baseProps, onShowChat: vi.fn(), onInvite: vi.fn(), onPopOut: vi.fn() }
    });
    const stage = screen.getByTestId('group-call-stage');
    expect(stage.classList.contains('@container')).toBe(true);
    const chat = screen.getByTestId('group-call-show-chat');
    expect(chat.querySelector('span')).toBeNull();
    // QA K1: icon-only, so it needs its own name.
    expect(chat.getAttribute('aria-label')).toBe('Chat');
    const title = stage.querySelector('h2');
    expect(title.classList.contains('truncate')).toBe(true);
    expect(title.classList.contains('min-w-0')).toBe(true);
    const pill = screen.getByTestId('group-call-title-pill');
    expect(pill.classList.contains('min-w-0')).toBe(true);
    expect(pill.classList.contains('max-w-full')).toBe(true);
    expect(pill.textContent).toContain('Standup');
  });

  it('a remote screen share takes the spotlight, seats move to the strip', () => {
    lk.remoteParticipants = [remote(`${HEX}:x1`, { screenShare: true })];
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-spotlight')).toBeTruthy();
    expect(screen.getByTestId(`call-item-screen:${HEX}:x1`)).toBeTruthy();
    expect(screen.getByTestId(`call-item-seat:${HEX}:x1`)).toBeTruthy();
  });

  it('marks guests who joined through a call link', () => {
    const GUEST = 'b'.repeat(64);
    const MEMBER = 'c'.repeat(64);
    lk.remoteParticipants = [
      remote(`${GUEST}:1`, { metadata: '{"guest":true,"pass":"p"}' }),
      remote(`${MEMBER}:1`)
    ];
    render(GroupCallStage, { props: baseProps });
    const guestTile = screen
      .getByTestId(`call-item-seat:${GUEST}:1`)
      .querySelector('[data-testid="participant-tile-stub"]');
    const memberTile = screen
      .getByTestId(`call-item-seat:${MEMBER}:1`)
      .querySelector('[data-testid="participant-tile-stub"]');
    expect(guestTile.getAttribute('data-guest')).toBe('true');
    expect(memberTile.getAttribute('data-guest')).toBe('false');
  });
});

// Task 19: tiles can be reordered (drag and drop, Alt+arrow). The order is
// the viewer's own, kept for the call, reset with the next call.
describe('reordering tiles', () => {
  const B = `${'b'.repeat(64)}:1`;
  const C = `${'c'.repeat(64)}:1`;
  const D = `${'d'.repeat(64)}:1`;
  const ME = `${'a'.repeat(64)}:me`;
  const order = () =>
    [...screen.getByTestId('group-call-grid').querySelectorAll('[data-seat-key]')].map((el) =>
      el.dataset.seatKey.replace('seat:', '')
    );
  const tile = (id) => screen.getByTestId(`call-item-seat:${id}`);

  beforeEach(() => {
    lk.room = {}; // a fresh call
    lk.remoteParticipants = [remote(B), remote(C), remote(D)];
  });

  it('Alt+→ / Alt+← move the focused tile and announce its new position', async () => {
    render(GroupCallStage, { props: baseProps });
    expect(order()).toEqual([ME, B, C, D]);
    tile(B).focus();
    await fireEvent.keyDown(tile(B), { key: 'ArrowRight', altKey: true });
    expect(order()).toEqual([ME, C, B, D]);
    await vi.waitFor(() =>
      expect(screen.getByTestId('group-call-tile-announce').textContent.trim()).toBe(
        'Tile moved, position 3 of 4'
      )
    );
    await fireEvent.keyDown(tile(B), { key: 'ArrowLeft', altKey: true });
    await fireEvent.keyDown(tile(B), { key: 'ArrowLeft', altKey: true });
    expect(order()).toEqual([B, ME, C, D]);
    // without Alt the arrows do nothing here
    await fireEvent.keyDown(tile(B), { key: 'ArrowRight' });
    expect(order()).toEqual([B, ME, C, D]);
  });

  it('Alt+arrow inside a tile control (the volume slider) does not move the tile', async () => {
    render(GroupCallStage, { props: baseProps });
    const inner = tile(B).querySelector('[data-testid="participant-tile-stub"]');
    await fireEvent.keyDown(inner, { key: 'ArrowRight', altKey: true });
    expect(order()).toEqual([ME, B, C, D]);
  });

  it('the same announcement twice in a row is cleared in between, so it is read again', async () => {
    render(GroupCallStage, { props: baseProps });
    const live = screen.getByTestId('group-call-tile-announce');
    const seen = [];
    new MutationObserver(() => seen.push(live.textContent.trim())).observe(live, {
      childList: true,
      characterData: true,
      subtree: true
    });
    await fireEvent.keyDown(tile(B), { key: 'ArrowRight', altKey: true }); // B -> 3rd
    await vi.waitFor(() => expect(live.textContent).toBe('Tile moved, position 3 of 4'));
    seen.length = 0;
    await fireEvent.keyDown(tile(C), { key: 'ArrowRight', altKey: true }); // C -> 3rd
    await vi.waitFor(() => expect(seen.at(-1)).toBe('Tile moved, position 3 of 4'));
    expect(seen).toContain('');
    expect(order()).toEqual([ME, B, C, D]);
  });

  it('a drop on a tile that left the call meanwhile moves nothing', async () => {
    render(GroupCallStage, { props: baseProps });
    const gone = document.createElement('div');
    gone.dataset.seatKey = 'seat:gone:1';
    const original = document.elementFromPoint;
    document.elementFromPoint = () => gone;
    try {
      await fireEvent.pointerDown(tile(D), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
      await fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(order()).toEqual([ME, B, C, D]);
  });

  it('unmounting mid-drag takes the window listeners away', async () => {
    const view = render(GroupCallStage, { props: baseProps });
    const removed = vi.spyOn(window, 'removeEventListener');
    try {
      await fireEvent.pointerDown(tile(D), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
      view.unmount();
      const types = removed.mock.calls.map((c) => c[0]);
      expect(types).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
    } finally {
      removed.mockRestore();
    }
  });

  it('tiles are focusable groups that say how to move them', () => {
    render(GroupCallStage, { props: baseProps });
    const el = tile(C);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowLeft Alt+ArrowRight');
    const hint = document.getElementById(el.getAttribute('aria-describedby'));
    expect(hint.textContent).toBe('Alt+arrow keys move this tile');
  });

  it('dragging a tile onto another puts it in that place', async () => {
    render(GroupCallStage, { props: baseProps });
    const original = document.elementFromPoint;
    document.elementFromPoint = () => tile(B);
    try {
      await fireEvent.pointerDown(tile(D), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
      expect(tile(D).classList.contains('opacity-50')).toBe(true);
      expect(tile(B).dataset.dropTarget).toBe('true');
      await fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(order()).toEqual([ME, D, B, C]);
  });

  it('a click without movement is no drag', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.pointerDown(tile(D), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 12, clientY: 11 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 12, clientY: 11 });
    expect(order()).toEqual([ME, B, C, D]);
  });

  it('the order survives the stage remounting in the same call, newcomers append', async () => {
    const first = render(GroupCallStage, { props: baseProps });
    tile(D).focus();
    await fireEvent.keyDown(tile(D), { key: 'ArrowLeft', altKey: true });
    expect(order()).toEqual([ME, B, D, C]);
    first.unmount();
    const E = `${'e'.repeat(64)}:1`;
    lk.remoteParticipants = [remote(B), remote(C), remote(D), remote(E)];
    render(GroupCallStage, { props: baseProps });
    expect(order()).toEqual([ME, B, D, C, E]);
  });

  it('a new call starts from the natural order again', async () => {
    const first = render(GroupCallStage, { props: baseProps });
    await fireEvent.keyDown(tile(D), { key: 'ArrowLeft', altKey: true });
    first.unmount();
    lk.room = {};
    render(GroupCallStage, { props: baseProps });
    expect(order()).toEqual([ME, B, C, D]);
  });

  it('a moved tile keeps its place when its hand goes up; unmoved hands still come first', async () => {
    const first = render(GroupCallStage, { props: baseProps });
    await fireEvent.keyDown(tile(B), { key: 'ArrowRight', altKey: true });
    await fireEvent.keyDown(tile(B), { key: 'ArrowRight', altKey: true });
    expect(order()).toEqual([ME, C, D, B]);
    first.unmount();
    lk.raisedHands = new Set([B, D]);
    render(GroupCallStage, { props: baseProps });
    expect(order()).toEqual([D, ME, C, B]);
  });
});

// Issue "participant list panel inside the call": a "Teilnehmende (N)"
// button in the header opens a list of everyone in the call with their
// state and the per-person actions, so nothing hides behind a tile hover.
describe('participant list panel', () => {
  const B = `${'b'.repeat(64)}:1`;
  const C = `${'c'.repeat(64)}:1`;
  const ME = `${'a'.repeat(64)}:me`;
  const openPanel = async () => {
    // A finished drag in an earlier test swallows the very next click on the
    // window until its 0 ms timer runs: let that macrotask pass first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    return screen.findByTestId('call-participants-panel-stub', {}, { timeout: 4000 });
  };

  it('the header counts everyone in the call, me included, and names the button', () => {
    lk.remoteParticipants = [remote(B), remote(C)];
    render(GroupCallStage, { props: baseProps });
    const button = screen.getByTestId('group-call-show-participants');
    expect(button.getAttribute('aria-label')).toBe('Participants (3)');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent.trim()).toBe('3');
    expect(screen.queryByTestId('call-participants-panel-stub')).toBeNull();
  });

  it('opens the panel lazily with one row per seat in stage order, and closes it again', async () => {
    lk.remoteParticipants = [remote(B), remote(C)];
    lk.raisedHands = new Set([C]);
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    expect(screen.getByTestId('group-call-show-participants').getAttribute('aria-pressed')).toBe(
      'true'
    );
    const rows = [...panel.querySelectorAll('[data-testid="participants-row-stub"]')];
    // Raised hands first, as on the stage.
    expect(rows.map((r) => r.dataset.identity)).toEqual([C, ME, B]);
    expect(rows[0].dataset.hand).toBe('true');
    expect(rows[1].dataset.local).toBe('true');
    await fireEvent.click(screen.getByTestId('stub-close'));
    expect(screen.queryByTestId('call-participants-panel-stub')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    expect(
      await screen.findByTestId('call-participants-panel-stub', {}, { timeout: 4000 })
    ).toBeTruthy();
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    expect(screen.queryByTestId('call-participants-panel-stub')).toBeNull();
  });

  it('hands each row its state: mic, speaking, guest, listen-only, pin, volume', async () => {
    const GUEST = `${'d'.repeat(64)}:g`;
    lk.remoteParticipants = [
      { ...remote(B), permissions: { canPublish: false } },
      remote(GUEST, { metadata: '{"guest":true,"pass":"p"}' })
    ];
    lk.mutedIdentities = new Set([B]);
    lk.speakingParticipantIds = new Set([GUEST]);
    localStorage.setItem('edufeed:call:volumes', JSON.stringify({ ['d'.repeat(64)]: 1.5 }));
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    const row = (id) => panel.querySelector(`[data-identity="${id}"]`);
    expect(row(B).dataset.micOff).toBe('true');
    expect(row(B).dataset.listenOnly).toBe('true');
    expect(row(B).dataset.guest).toBe('false');
    expect(row(GUEST).dataset.speaking).toBe('true');
    expect(row(GUEST).dataset.guest).toBe('true');
    expect(row(GUEST).dataset.listenOnly).toBe('false');
    expect(row(GUEST).dataset.volume).toBe('1.5');
    expect(row(GUEST).dataset.pubkey).toBe('d'.repeat(64));
    expect(row(ME).dataset.local).toBe('true');
    lk.mutedIdentities = new Set();
    lk.speakingParticipantIds = new Set();
  });

  it('pin and volume from the panel are the same actions as on the tiles', async () => {
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    expect(screen.queryByTestId('group-call-spotlight')).toBeNull();
    await fireEvent.click(screen.getByTestId(`stub-pin-seat:${B}`));
    expect(screen.getByTestId('group-call-spotlight')).toBeTruthy();
    expect(panel.querySelector(`[data-identity="${B}"]`).dataset.pinned).toBe('true');
    await fireEvent.click(screen.getByTestId(`stub-pin-seat:${B}`));
    expect(screen.queryByTestId('group-call-spotlight')).toBeNull();
    await fireEvent.click(screen.getByTestId(`stub-volume-seat:${B}`));
    expect(svc.setParticipantVolume).toHaveBeenCalledWith('b'.repeat(64), 0.5);
    expect(panel.querySelector(`[data-identity="${B}"]`).dataset.volume).toBe('0.5');
  });

  it('sits beside the tiles on a wide stage and replaces them on a narrow one', async () => {
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    await openPanel();
    const column = screen.getByTestId('group-call-participants-column');
    expect(column.classList.contains('w-full')).toBe(true);
    expect(column.classList.contains('@2xl:w-72')).toBe(true);
    // A paper card on the dark stage (design 1d).
    expect(column.classList.contains('call-stage-paper')).toBe(true);
    const tiles = screen.getByTestId('group-call-tiles');
    expect(tiles.classList.contains('hidden')).toBe(true);
    expect(tiles.classList.contains('@2xl:flex')).toBe(true);
    await fireEvent.click(screen.getByTestId('stub-close'));
    expect(screen.getByTestId('group-call-tiles').classList.contains('hidden')).toBe(false);
  });

  // Design 1d: one drawer beside the tiles. The chat column (the parent's)
  // and this list never stand side by side.
  it('opening the list folds the chat column away, and the chat opening closes the list', async () => {
    lk.remoteParticipants = [remote(B)];
    const onHideChat = vi.fn();
    const { rerender } = render(GroupCallStage, {
      props: { ...baseProps, onShowChat: vi.fn(), onHideChat, chatOpen: true }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    expect(onHideChat).toHaveBeenCalledTimes(1);
    await rerender({ ...baseProps, onShowChat: vi.fn(), onHideChat, chatOpen: false });
    expect(
      await screen.findByTestId('call-participants-panel-stub', {}, { timeout: 4000 })
    ).toBeTruthy();
    // The parent opens the chat beside the stage: the list steps back.
    await rerender({ ...baseProps, onShowChat: vi.fn(), onHideChat, chatOpen: true });
    expect(screen.queryByTestId('group-call-participants-column')).toBeNull();
  });
});

describe('floating chrome (design 1d "Bühne")', () => {
  const B = `${'b'.repeat(64)}:1`;
  beforeEach(() => {
    lk.remoteParticipants = [];
    lk.raisedHands = new Set();
    lk.connectionState = 'connected';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the stage is the dark room; drawers bring the paper back', () => {
    render(GroupCallStage, { props: baseProps });
    const stage = screen.getByTestId('group-call-stage');
    expect(stage.classList.contains('call-stage')).toBe(true);
    expect(stage.classList.contains('bg-base-200')).toBe(true);
  });

  it('the hand button carries the count of hands up; the list of who waits sits in the title row', () => {
    lk.remoteParticipants = [remote(B)];
    lk.raisedHands = new Set([B]);
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-hand-count').textContent.trim()).toBe('1');
    const pill = screen.getByTestId('group-call-hands');
    expect(screen.getByTestId('group-call-title-row').contains(pill)).toBe(true);
    lk.raisedHands = new Set();
  });

  it('the title row and the dock step back after a few seconds without input, and come back on it', () => {
    vi.useFakeTimers();
    render(GroupCallStage, { props: baseProps });
    const stage = screen.getByTestId('group-call-stage');
    const dockLayer = screen.getByTestId('group-call-controls').parentElement;
    const titleRow = screen.getByTestId('group-call-title-row');
    expect(stage.hasAttribute('data-idle')).toBe(false);
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(stage.getAttribute('data-idle')).toBe('true');
    expect(dockLayer.classList.contains('opacity-0')).toBe(true);
    expect(titleRow.classList.contains('opacity-0')).toBe(true);
    stage.dispatchEvent(new Event('pointermove', { bubbles: true }));
    flushSync();
    expect(stage.hasAttribute('data-idle')).toBe(false);
    expect(dockLayer.classList.contains('opacity-0')).toBe(false);
  });

  it('never steps back while a menu is open or the pointer rests on the dock', async () => {
    vi.useFakeTimers();
    render(GroupCallStage, { props: baseProps });
    const stage = screen.getByTestId('group-call-stage');
    await fireEvent.click(screen.getByTitle('React'));
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(stage.hasAttribute('data-idle')).toBe(false);
    await fireEvent.pointerDown(stage); // closes the menu
    const dock = screen.getByTestId('group-call-controls');
    await fireEvent.pointerEnter(dock, { pointerType: 'mouse' });
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(stage.hasAttribute('data-idle')).toBe(false);
    await fireEvent.pointerLeave(dock, { pointerType: 'mouse' });
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(stage.getAttribute('data-idle')).toBe('true');
  });

  it('the status row never hides: reconnecting is a pill up top, outside the fading row', () => {
    vi.useFakeTimers();
    lk.connectionState = 'reconnecting';
    render(GroupCallStage, { props: baseProps });
    const pill = screen.getByTestId('group-call-reconnecting');
    const statusRow = screen.getByTestId('group-call-status-row');
    expect(statusRow.contains(pill)).toBe(true);
    expect(screen.getByTestId('group-call-title-row').contains(pill)).toBe(false);
    // A bad connection also holds the chrome up.
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(screen.getByTestId('group-call-stage').hasAttribute('data-idle')).toBe(false);
    lk.connectionState = 'connected';
  });
});

// Issue "layouts (side by side, fullscreen camera tiles, tile cap +
// pagination)": a layout picker in the header — Raster (grid), Fokus
// (spotlight + strip), Nebeneinander (two spotlights), Sprecher (active
// speaker) — a tile cap with pages for the grid, both remembered per device.
describe('layouts', () => {
  // A finished drag in the reordering tests swallows the very next click on
  // the window until its 0 ms timer runs: let that macrotask pass first.
  beforeEach(() => {
    lk.room = null; // no tile placements left over from the reordering tests
    lk.speakingParticipantIds = new Set();
    lk.mutedIdentities = new Set();
    return new Promise((resolve) => setTimeout(resolve, 0));
  });
  const B = `${'b'.repeat(64)}:1`;
  const C = `${'c'.repeat(64)}:1`;
  const D = `${'d'.repeat(64)}:1`;
  const ME = `${'a'.repeat(64)}:me`;
  const slots = () =>
    [
      ...screen
        .getByTestId('group-call-slots')
        .querySelectorAll(':scope > [data-testid^="call-item-"]')
    ].map((el) => el.dataset.testid.replace('call-item-', ''));
  const gridKeys = () =>
    [...screen.getByTestId('group-call-grid').querySelectorAll('[data-testid^="call-item-"]')].map(
      (el) => el.dataset.testid.replace('call-item-', '')
    );
  const pinTile = (id) =>
    fireEvent.click(
      screen.getByTestId(`call-item-seat:${id}`).querySelector('[data-testid="tile-pin-stub"]')
    );
  const pickLayout = async (name) => {
    await fireEvent.click(screen.getByTestId('group-call-layout'));
    await fireEvent.click(screen.getByRole('menuitemradio', { name }));
  };

  it('the picker names the current layout and lists the four', async () => {
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    const button = screen.getByTestId('group-call-layout');
    expect(button.getAttribute('aria-label')).toBe('View: Grid');
    await fireEvent.click(button);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent.trim())).toEqual([
      'Grid',
      'Focus',
      'Side by side',
      'Speaker',
      '9',
      '16',
      '25'
    ]);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[5].getAttribute('aria-checked')).toBe('true');
  });

  it('focus: one spotlight even without a pin, remembered on this device', async () => {
    lk.remoteParticipants = [remote(B), remote(C)];
    const view = render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-grid')).toBeTruthy();
    await pickLayout('Focus');
    expect(slots()).toEqual([`seat:${B}`]);
    expect(
      screen.getByTestId('group-call-strip').querySelectorAll('[data-testid^="call-item-"]').length
    ).toBe(2);
    expect(localStorage.getItem('edufeed:call:layout')).toBe('focus');
    view.unmount();
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-layout').getAttribute('aria-label')).toBe('View: Focus');
    expect(slots()).toEqual([`seat:${B}`]);
  });

  it('side by side: two remote shares fill both slots, a third replaces the oldest', async () => {
    localStorage.setItem('edufeed:call:layout', 'side');
    lk.remoteParticipants = [remote(B, { screenShare: true }), remote(C, { screenShare: true })];
    const view = render(GroupCallStage, { props: baseProps });
    expect(slots()).toEqual([`screen:${B}`, `screen:${C}`]);
    const box = screen.getByTestId('group-call-slots');
    expect(box.classList.contains('@md:flex-row')).toBe(true);
    // The mocked participant list is not reactive: a third share arrives
    // with a fresh stage, which sees all three as new and keeps the newest two.
    view.unmount();
    lk.remoteParticipants = [
      remote(B, { screenShare: true }),
      remote(C, { screenShare: true }),
      remote(D, { screenShare: true })
    ];
    render(GroupCallStage, { props: baseProps });
    expect(slots()).toEqual([`screen:${C}`, `screen:${D}`]);
  });

  it('side by side: a share and the active speaker, two pins allowed', async () => {
    localStorage.setItem('edufeed:call:layout', 'side');
    lk.remoteParticipants = [remote(B, { screenShare: true }), remote(C), remote(D)];
    lk.speakingParticipantIds = new Set([D]);
    render(GroupCallStage, { props: baseProps });
    expect(slots()).toEqual([`screen:${B}`, `seat:${D}`]);
    // Pins: the share stays (auto-pinned), pinning C and then ME keeps the two newest.
    await pinTile(C);
    expect(slots()).toEqual([`screen:${B}`, `seat:${C}`]);
    await pinTile(ME);
    expect(slots()).toEqual([`seat:${C}`, `seat:${ME}`]);
    lk.speakingParticipantIds = new Set();
  });

  it('speaker: follows the active remote speaker, ignores a muted one and myself, sticks when silence falls', async () => {
    localStorage.setItem('edufeed:call:layout', 'speaker');
    lk.remoteParticipants = [remote(B), remote(C)];
    // Reactive sets, mutated in place like the service's SvelteSet.
    const speaking = new SvelteSet([ME, C]);
    const muted = new SvelteSet();
    lk.speakingParticipantIds = speaking;
    lk.mutedIdentities = muted;
    render(GroupCallStage, { props: baseProps });
    expect(slots()).toEqual([`seat:${C}`]);
    // B's mic is off: whatever LiveKit reports, B is not the speaker.
    muted.add(B);
    speaking.delete(C);
    speaking.add(B);
    flushSync();
    expect(slots()).toEqual([`seat:${C}`]);
    muted.delete(B);
    flushSync();
    expect(slots()).toEqual([`seat:${B}`]);
    // Silence: the last speaker stays.
    speaking.delete(B);
    flushSync();
    expect(slots()).toEqual([`seat:${B}`]);
  });

  it('a pin beats the speaker, and unpinning hands the slot back', async () => {
    localStorage.setItem('edufeed:call:layout', 'speaker');
    lk.remoteParticipants = [remote(B), remote(C)];
    lk.speakingParticipantIds = new Set([C]);
    render(GroupCallStage, { props: baseProps });
    await pinTile(B);
    expect(slots()).toEqual([`seat:${B}`]);
    await pinTile(B);
    expect(slots()).toEqual([`seat:${C}`]);
    lk.speakingParticipantIds = new Set();
  });

  describe('grid pages', () => {
    const many = (n) =>
      Array.from({ length: n }, (_, i) => remote(`${(i + 2).toString(16).padStart(64, '0')}:1`));

    it('caps the grid at the tile cap and pages through the rest; tiles off the page are not rendered', async () => {
      localStorage.setItem('edufeed:call:tileCap', '9');
      lk.remoteParticipants = many(20); // 21 with me
      render(GroupCallStage, { props: baseProps });
      expect(gridKeys().length).toBe(9);
      expect(gridKeys()[0]).toBe(`seat:${ME}`);
      const pager = screen.getByTestId('group-call-pager');
      expect(pager.textContent).toContain('Page 1 of 3');
      const prev = screen.getByRole('button', { name: 'Previous page' });
      const next = screen.getByRole('button', { name: 'Next page' });
      expect(prev.disabled).toBe(true);
      await fireEvent.click(next);
      expect(pager.textContent).toContain('Page 2 of 3');
      expect(gridKeys().length).toBe(9);
      expect(gridKeys()[0]).toBe(`seat:${(10).toString(16).padStart(64, '0')}:1`);
      await fireEvent.click(next);
      expect(gridKeys().length).toBe(3);
      expect(next.disabled).toBe(true);
      expect(screen.getAllByTestId('participant-tile-stub').length).toBe(3);
    });

    it('no pager when everyone fits; the cap is picked in the layout menu and remembered', async () => {
      lk.remoteParticipants = many(12);
      render(GroupCallStage, { props: baseProps });
      expect(screen.queryByTestId('group-call-pager')).toBeNull();
      expect(gridKeys().length).toBe(13);
      await fireEvent.click(screen.getByTestId('group-call-layout'));
      await fireEvent.click(screen.getByRole('menuitemradio', { name: '9' }));
      expect(gridKeys().length).toBe(9);
      expect(screen.getByTestId('group-call-pager').textContent).toContain('Page 1 of 2');
      expect(localStorage.getItem('edufeed:call:tileCap')).toBe('9');
    });

    // A page that emptied (people left) falls back to the last one: paginate's
    // own test covers the clamp; the mocked participant list is not reactive.

    it('the strip of a spotlight layout is not paged (it scrolls)', async () => {
      localStorage.setItem('edufeed:call:tileCap', '9');
      localStorage.setItem('edufeed:call:layout', 'focus');
      lk.remoteParticipants = many(20);
      render(GroupCallStage, { props: baseProps });
      expect(
        screen.getByTestId('group-call-strip').querySelectorAll('[data-testid^="call-item-"]')
          .length
      ).toBe(20);
      expect(screen.queryByTestId('group-call-pager')).toBeNull();
    });
  });
});

// Issues "Video-Call: host role" + "mute other participants": the relay
// marks the host / co-hosts in participant metadata and offers a NIP-98
// moderation endpoint; the stage shows the badges and, for a host or
// co-host, the actions in the participant list's row menu.
describe('host role', () => {
  const HOST_ME = `${'a'.repeat(64)}:me`;
  const B = `${'b'.repeat(64)}:1`;
  const C = `${'c'.repeat(64)}:1`;
  const GUEST = `${'d'.repeat(64)}:g`;
  const openPanel = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    return screen.findByTestId('call-participants-panel-stub', {}, { timeout: 4000 });
  };
  const asHost = () => {
    lk.localParticipant = {
      identity: HOST_ME,
      metadata: '{"host":true}',
      getTrackPublication: () => undefined
    };
  };
  beforeEach(() => {
    moderateActiveCall.mockReset();
    moderateActiveCall.mockResolvedValue(undefined);
    lk.participantMetadataVersion = 0;
  });

  it('tells me in the title pill when I am the host or a co-host, and nothing otherwise', () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-my-role')).toBeNull();
    unmount();

    asHost();
    const second = render(GroupCallStage, { props: baseProps });
    const badge = screen.getByTestId('group-call-my-role');
    // A chip in the pill: short, the full sentence as its title.
    expect(badge.textContent.trim()).toBe('Host');
    expect(badge.getAttribute('title')).toBe('You are the host');
    expect(badge.dataset.role).toBe('host');
    expect(screen.getByTestId('group-call-title-pill').contains(badge)).toBe(true);
    second.unmount();

    lk.localParticipant.metadata = '{"cohost":true}';
    render(GroupCallStage, { props: baseProps });
    const cohost = screen.getByTestId('group-call-my-role');
    expect(cohost.textContent.trim()).toBe('Co-host');
    expect(cohost.getAttribute('title')).toBe('You are a co-host');
  });

  it("hands tiles and rows the role read from each seat's metadata", async () => {
    lk.remoteParticipants = [
      remote(B, { metadata: '{"host":true}' }),
      remote(C, { metadata: '{"cohost":true}' }),
      remote(GUEST, { metadata: '{"guest":true,"pass":"p"}' })
    ];
    render(GroupCallStage, { props: baseProps });
    const tile = (id) =>
      document.querySelector(`[data-testid="participant-tile-stub"][data-identity="${id}"]`);
    expect(tile(B).dataset.role).toBe('host');
    expect(tile(C).dataset.role).toBe('cohost');
    expect(tile(GUEST).dataset.role).toBe('');
    const panel = await openPanel();
    const row = (id) => panel.querySelector(`[data-identity="${id}"]`);
    expect(row(B).dataset.role).toBe('host');
    expect(row(C).dataset.role).toBe('cohost');
    expect(row(HOST_ME).dataset.role).toBe('');
  });

  it('a plain member sees no host actions in any row menu', async () => {
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    await openPanel();
    expect(screen.queryByTestId('call-host-actions')).toBeNull();
  });

  it('the host mutes a participant through the relay and hears the outcome', async () => {
    asHost();
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    const menu = panel.querySelector(`[data-testid="stub-menu-seat:${B}"]`);
    expect(menu.querySelector('[data-testid="call-host-actions"]')).toBeTruthy();
    expect(
      panel.querySelector(
        `[data-testid="stub-menu-seat:${HOST_ME}"] [data-testid="call-host-actions"]`
      )
    ).toBeNull();

    await fireEvent.click(menu.querySelector('[data-testid="call-mod-mute"]'));
    expect(moderateActiveCall).toHaveBeenCalledWith({ action: 'mute', identity: B });
    await vi.waitFor(() =>
      expect(media.showToast).toHaveBeenCalledWith('bbbbbbbb muted', 'success')
    );

    moderateActiveCall.mockRejectedValueOnce(new Error('a co-host cannot moderate the host'));
    await fireEvent.click(menu.querySelector('[data-testid="call-mod-stop-video"]'));
    await vi.waitFor(() =>
      expect(media.showToast).toHaveBeenCalledWith(
        'failed: a co-host cannot moderate the host',
        'error'
      )
    );
  });

  it('removing asks first (shared small dialog), then calls the relay; cancel does nothing', async () => {
    asHost();
    lk.remoteParticipants = [remote(B)];
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    const menu = panel.querySelector(`[data-testid="stub-menu-seat:${B}"]`);

    await fireEvent.click(menu.querySelector('[data-testid="call-mod-remove"]'));
    const dialog = screen.getByTestId('call-mod-remove-confirm');
    expect(dialog.querySelector('.modal-box').classList.contains('max-w-sm')).toBe(true);
    expect(dialog.textContent).toContain('bbbbbbbb will be disconnected.');
    expect(moderateActiveCall).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('call-mod-remove-cancel'));
    expect(screen.queryByTestId('call-mod-remove-confirm')).toBeNull();
    expect(moderateActiveCall).not.toHaveBeenCalled();

    await fireEvent.click(menu.querySelector('[data-testid="call-mod-remove"]'));
    await fireEvent.click(screen.getByTestId('call-mod-remove-action'));
    expect(screen.queryByTestId('call-mod-remove-confirm')).toBeNull();
    expect(moderateActiveCall).toHaveBeenCalledWith({ action: 'remove', identity: B });
    await vi.waitFor(() =>
      expect(media.showToast).toHaveBeenCalledWith('bbbbbbbb removed', 'success')
    );
  });

  it("co-host toggling is the host's alone and never offered for a guest", async () => {
    asHost();
    lk.remoteParticipants = [
      remote(B),
      remote(C, { metadata: '{"cohost":true}' }),
      remote(GUEST, { metadata: '{"guest":true,"pass":"p"}' })
    ];
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    const menu = (id) => panel.querySelector(`[data-testid="stub-menu-seat:${id}"]`);
    await fireEvent.click(menu(B).querySelector('[data-testid="call-mod-make-cohost"]'));
    expect(moderateActiveCall).toHaveBeenCalledWith({ action: 'make-cohost', identity: B });
    await fireEvent.click(menu(C).querySelector('[data-testid="call-mod-revoke-cohost"]'));
    expect(moderateActiveCall).toHaveBeenCalledWith({ action: 'revoke-cohost', identity: C });
    expect(menu(GUEST).querySelector('[data-testid="call-mod-make-cohost"]')).toBeNull();
    expect(menu(GUEST).querySelector('[data-testid="call-mod-mute"]')).toBeTruthy();
    expect(menu(GUEST).querySelector('[data-testid="call-mod-remove"]')).toBeTruthy();
  });

  it('a co-host may mute and remove but not change roles, and never touches the host', async () => {
    lk.localParticipant = {
      identity: HOST_ME,
      metadata: '{"cohost":true}',
      getTrackPublication: () => undefined
    };
    lk.remoteParticipants = [remote(B, { metadata: '{"host":true}' }), remote(C)];
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    const menu = (id) => panel.querySelector(`[data-testid="stub-menu-seat:${id}"]`);
    expect(menu(B).querySelector('[data-testid="call-host-actions"]')).toBeNull();
    expect(menu(C).querySelector('[data-testid="call-mod-mute"]')).toBeTruthy();
    expect(menu(C).querySelector('[data-testid="call-mod-remove"]')).toBeTruthy();
    expect(menu(C).querySelector('[data-testid="call-mod-make-cohost"]')).toBeNull();
  });

  it('reads the role afresh from the metadata the relay pushed (participantMetadataVersion)', async () => {
    // The stage's roles map depends on the connection service's metadata
    // version (the participant objects are not reactive); the fixture `lk`
    // is a plain object, so the re-derivation is exercised by a fresh render.
    const b = remote(B);
    lk.remoteParticipants = [b];
    const first = render(GroupCallStage, { props: baseProps });
    const tile = () =>
      document.querySelector(`[data-testid="participant-tile-stub"][data-identity="${B}"]`);
    expect(tile().dataset.role).toBe('');
    first.unmount();
    b.metadata = '{"cohost":true}';
    lk.participantMetadataVersion = 1;
    render(GroupCallStage, { props: baseProps });
    expect(tile().dataset.role).toBe('cohost');
  });
});

describe('breakout rooms', () => {
  const asHost = () => {
    lk.localParticipant = {
      identity: `${'a'.repeat(64)}:me`,
      metadata: '{"host":true}',
      getTrackPublication: () => undefined
    };
  };
  beforeEach(() => {
    Object.assign(breakout.state, {
      session: null,
      currentRoom: null,
      rooms: [],
      remaining: null,
      busy: false
    });
    breakout.returnToMain.mockClear();
  });
  const openPanel = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    return screen.findByTestId('call-participants-panel-stub', {}, { timeout: 4000 });
  };

  it('offers the "Breakout rooms" tab in the side column to a host, not to a plain seat', async () => {
    render(GroupCallStage, { props: baseProps });
    const panel = await openPanel();
    expect(screen.queryByTestId('group-call-column-tabs')).toBeNull();
    expect(screen.queryByTestId('group-call-breakout-open')).toBeNull();
    // No tab row: the list keeps its own title and close.
    expect(panel.dataset.compact).toBe('false');
    expect(screen.queryByTestId('group-call-column-close')).toBeNull();
  });

  it('shows the host the tabs: the rooms tab opens the dialog until a session runs', async () => {
    asHost();
    render(GroupCallStage, { props: baseProps });
    await openPanel();
    expect(breakout.ensureBreakoutListener).toHaveBeenCalled();
    const tabs = screen.getByTestId('group-call-column-tabs');
    expect(tabs.getAttribute('role')).toBe('tablist');
    const people = screen.getByTestId('group-call-column-tab-participants');
    expect(people.textContent).toContain('Participants 1');
    expect(people.getAttribute('aria-selected')).toBe('true');
    const open = screen.getByTestId('group-call-breakout-open');
    expect(open.textContent).toContain('Breakout rooms');
    expect(open.getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByTestId('group-call-breakout-tab-dot')).toBeNull();
    // Design 1d: one header for the drawer — the tabs name the list, the
    // close sits at their end, the panel renders no second title.
    expect(screen.getByTestId('call-participants-panel-stub').dataset.compact).toBe('true');
    await fireEvent.click(screen.getByTestId('group-call-column-close'));
    expect(screen.queryByTestId('group-call-participants-column')).toBeNull();
    await openPanel();
    await fireEvent.click(open);
    // no session: the dialog, the list stays
    expect(screen.getByTestId('call-participants-panel-stub')).toBeTruthy();
    expect(screen.queryByTestId('breakout-panel-stub')).toBeNull();
    expect(open.getAttribute('aria-selected')).toBe('false');
  });

  it('while hosting a session the tabs switch between the list and the panel; the list keeps its row menus', async () => {
    asHost();
    breakout.state.session = {
      main: { id: 'main', relay: 'wss://r.example/', title: 'Standup' },
      rooms: [{ id: 'r1', relay: 'wss://r.example/', name: 'Breakout 1', index: 1 }],
      until: null,
      hosting: true
    };
    breakout.state.rooms = breakout.state.session.rooms;
    render(GroupCallStage, { props: baseProps });
    await openPanel();
    // the list first, the rooms tab wearing the "running" dot
    expect(screen.getByTestId('group-call-breakout-tab-dot')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('group-call-breakout-open'));
    const panel = await screen.findByTestId('breakout-panel-stub', {}, { timeout: 4000 });
    expect(screen.getByTestId('group-call-breakout-open').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.queryByTestId('call-participants-panel-stub')).toBeNull();
    expect(screen.getByTestId('group-call-column-tabs')).toBeTruthy();
    // the panel's deadline controls reach the store
    await fireEvent.click(panel.querySelector('[data-testid="stub-breakout-set"]'));
    expect(breakout.setBreakoutDeadline).toHaveBeenCalledWith(10);
    await fireEvent.click(panel.querySelector('[data-testid="stub-breakout-clear"]'));
    expect(breakout.setBreakoutDeadline).toHaveBeenCalledWith(null);
    await fireEvent.click(panel.querySelector('[data-testid="stub-breakout-extend"]'));
    expect(breakout.extendBreakout).toHaveBeenCalledWith(5);
    // back to the people (a row menu lives there), the tab is remembered
    await fireEvent.click(screen.getByTestId('group-call-column-tab-participants'));
    expect(screen.getByTestId('call-participants-panel-stub')).toBeTruthy();
    expect(screen.queryByTestId('breakout-panel-stub')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-call-breakout-open'));
    await screen.findByTestId('breakout-panel-stub');
    // the stage's "Participants" button: from the rooms tab it switches, from the list it closes
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    expect(screen.getByTestId('call-participants-panel-stub')).toBeTruthy();
    expect(screen.getByTestId('group-call-participants-column')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    expect(screen.queryByTestId('group-call-participants-column')).toBeNull();
    // ... and the panel's close button closes the whole column
    await fireEvent.click(screen.getByTestId('group-call-show-participants'));
    await fireEvent.click(screen.getByTestId('group-call-breakout-open'));
    const again = await screen.findByTestId('breakout-panel-stub');
    await fireEvent.click(again.querySelector('[data-testid="stub-breakout-close"]'));
    expect(screen.queryByTestId('group-call-participants-column')).toBeNull();
  });

  it('in a breakout room: no host badge, a room chip with the countdown, and the way back', async () => {
    asHost();
    breakout.state.session = {
      main: { id: 'main', relay: 'wss://r.example/', title: 'Standup' },
      rooms: [],
      until: 1,
      hosting: false
    };
    breakout.state.currentRoom = {
      id: 'r2',
      relay: 'wss://r.example/',
      name: 'Breakout 2',
      index: 2
    };
    breakout.state.remaining = 125;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-my-role')).toBeNull();
    expect(
      screen.getByTestId('group-call-breakout-room').textContent.replace(/\s+/g, ' ').trim()
    ).toBe('Breakout room 2 · 2:05');
    await fireEvent.click(screen.getByTestId('group-call-breakout-back'));
    expect(breakout.returnToMain).toHaveBeenCalledTimes(1);
    // host controls are never offered inside a room
    await openPanel();
    expect(screen.queryByTestId('group-call-breakout-open')).toBeNull();
  });

  it('a seat in the main room during a session it is not part of sees the banner with the rooms to join, never a host', async () => {
    const session = {
      main: { id: 'main', relay: 'wss://r.example/', title: 'Standup' },
      rooms: [{ id: 'r1', relay: 'wss://r.example/', name: 'Breakout 1', index: 1 }],
      until: null,
      hosting: false
    };
    breakout.state.session = session;
    breakout.state.rooms = session.rooms;
    render(GroupCallStage, { props: baseProps });
    const banner = await screen.findByTestId('breakout-banner-stub', {}, { timeout: 4000 });
    await fireEvent.click(banner);
    expect(breakout.requestBreakoutRoom).toHaveBeenCalledWith(session.rooms[0]);
  });

  it('a guest seat gets the same banner (its pass opens the rooms) and it hides while the assignment prompt is up', async () => {
    lk.localParticipant = {
      identity: `${'a'.repeat(64)}:me`,
      metadata: '{"guest":true,"pass":"p"}',
      getTrackPublication: () => undefined
    };
    breakout.state.session = {
      main: { id: 'main', relay: 'wss://r.example/', title: 'Standup' },
      rooms: [],
      until: null,
      hosting: false
    };
    render(GroupCallStage, { props: baseProps });
    const banner = await screen.findByTestId('breakout-banner-stub', {}, { timeout: 4000 });
    expect(banner.dataset.rooms).toBe('0');
    // hosting: no banner (the panel is the host's view)
    breakout.state.session = { ...breakout.state.session, hosting: true };
    breakout.state.pending = { room: { id: 'r1' } };
    render(GroupCallStage, { props: baseProps });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getAllByTestId('breakout-banner-stub')).toHaveLength(1);
    breakout.state.pending = null;
  });

  it('hosting from the main room: the deadline chip opens the column on the rooms tab', async () => {
    asHost();
    breakout.state.session = {
      main: { id: 'main', relay: 'wss://r.example/', title: 'Standup' },
      rooms: [{ id: 'r1', relay: 'wss://r.example/', name: 'Breakout 1', index: 1 }],
      until: 1,
      hosting: true
    };
    breakout.state.rooms = breakout.state.session.rooms;
    breakout.state.remaining = 59;
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-breakout-deadline').textContent).toContain('0:59 left');
    expect(screen.queryByTestId('group-call-breakout-back')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(screen.getByTestId('group-call-breakout-deadline'));
    const panel = await screen.findByTestId('breakout-panel-stub', {}, { timeout: 4000 });
    expect(panel.dataset.remaining).toBe('59');
    expect(screen.getByTestId('group-call-breakout-open').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByTestId('group-call-breakout-tab-dot')).toBeTruthy();
  });
});
