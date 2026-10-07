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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { lk, svc, media, bg } = vi.hoisted(() => ({
  lk: {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    isCameraOff: true,
    isScreenSharing: false,
    canPublish: true,
    canSignal: true,
    connectionState: 'connected',
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
vi.mock('$lib/services/call-sounds.js', () => ({ playLeaveSound: media.playLeaveSound }));
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
vi.mock('$lib/components/icons', () => ({
  MeetIcon: Stub,
  ChevronDownIcon: Stub,
  MicIcon: Stub,
  MicOffIcon: Stub,
  VideoIcon: Stub,
  ScreenShareIcon: Stub,
  HandIcon: Stub,
  SmilePlusIcon: Stub,
  ChatIcon: Stub,
  ExternalLinkIcon: Stub,
  LinkIcon: Stub,
  MoreIcon: Stub,
  PeopleIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_chat_unread: () => 'New messages in the call chat',
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
  groups_call_background_store_failed: () => 'Image not saved'
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

  it('offers the pop-out window only when the parent can open one', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-pop-out')).toBeNull();
    unmount();
    const onPopOut = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopOut } });
    await fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    expect(onPopOut).toHaveBeenCalledTimes(1);
  });

  it('inside the pop-out: a way back to the tab', async () => {
    const onPopIn = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopIn } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back to tab' }));
    expect(onPopIn).toHaveBeenCalledTimes(1);
  });

  it('offers Einladungslink only when the parent passes onInvite', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-invite')).toBeNull();
    unmount();
    const onInvite = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onInvite } });
    await fireEvent.click(screen.getByTestId('group-call-invite'));
    expect(onInvite).toHaveBeenCalled();
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

  it('the control bar never shrinks away: the video area gives way instead', () => {
    render(GroupCallStage, { props: baseProps });
    const controls = screen.getByTestId('group-call-controls');
    expect(controls.classList.contains('shrink-0')).toBe(true);
    const videoArea = screen.getByTestId('group-call-grid').parentElement.parentElement;
    expect(videoArea.classList.contains('min-h-0')).toBe(true);
    expect(videoArea.classList.contains('flex-1')).toBe(true);
  });

  it('the header shrinks with the stage, not the viewport: labels collapse to icons', () => {
    // laoc 2026-10-02: beside the chat column the stage is narrow even on a
    // wide window; the header's fixed button row widened the page. The stage
    // is a size container and the labels answer to ITS width.
    render(GroupCallStage, {
      props: { ...baseProps, onShowChat: vi.fn(), onInvite: vi.fn(), onPopOut: vi.fn() }
    });
    const stage = screen.getByTestId('group-call-stage');
    expect(stage.classList.contains('@container')).toBe(true);
    for (const id of ['group-call-invite', 'group-call-show-chat']) {
      const label = screen.getByTestId(id).querySelector('span');
      expect(label.classList.contains('hidden')).toBe(true);
      expect(label.classList.contains('@lg:inline')).toBe(true);
    }
    // The title side gives way (truncates) before the buttons do.
    const title = stage.querySelector('h2');
    expect(title.classList.contains('truncate')).toBe(true);
    expect(title.parentElement.classList.contains('min-w-0')).toBe(true);
    expect(title.parentElement.classList.contains('flex-1')).toBe(true);
    // QA K4: the title itself takes the free space before it truncates.
    expect(title.classList.contains('min-w-0')).toBe(true);
    expect(title.classList.contains('flex-1')).toBe(true);
    // QA K1: icon-only at narrow stage widths, so it needs its own name.
    expect(screen.getByTestId('group-call-show-chat').getAttribute('aria-label')).toBe('Chat');
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
    expect(button.textContent).toContain('3');
    // Icon-only below the stage's @lg, like the chat button.
    const label = button.querySelector('span');
    expect(label.classList.contains('hidden')).toBe(true);
    expect(label.classList.contains('@lg:inline')).toBe(true);
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
    const tiles = screen.getByTestId('group-call-tiles');
    expect(tiles.classList.contains('hidden')).toBe(true);
    expect(tiles.classList.contains('@2xl:flex')).toBe(true);
    await fireEvent.click(screen.getByTestId('stub-close'));
    expect(screen.getByTestId('group-call-tiles').classList.contains('hidden')).toBe(false);
  });
});
