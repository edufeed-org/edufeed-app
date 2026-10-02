// @ts-nocheck
/**
 * CallDock — the running call while no call stage is on screen (another
 * channel, another page, or the user stepped back to the chat). Shows what
 * call it is and who is in it, and offers mute, "back to call" and leave.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { lk, call, fns } = vi.hoisted(() => ({
  lk: {
    isConnected: true,
    isMuted: true,
    canPublish: true,
    connectionState: 'connected',
    localParticipant: { identity: 'me' },
    remoteParticipants: [],
    speakingParticipantIds: new Set()
  },
  call: { phase: 'ready', title: 'Standup', href: '/groups/abc?x=1', error: null },
  fns: {
    toggleMute: vi.fn(async () => {}),
    leaveGroupCall: vi.fn(async () => {}),
    showCallStage: vi.fn(),
    goto: vi.fn(async () => {}),
    playLeaveSound: vi.fn(),
    showToast: vi.fn()
  }
}));

vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  getLiveKitState: () => lk,
  toggleMute: (...a) => fns.toggleMute(...a)
}));
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => call,
  leaveGroupCall: (...a) => fns.leaveGroupCall(...a),
  showCallStage: (...a) => fns.showCallStage(...a),
  callErrorMessage: () => 'call failed'
}));
vi.mock('$app/navigation', () => ({ goto: (...a) => fns.goto(...a) }));
vi.mock('$lib/services/call-sounds.js', () => ({ playLeaveSound: fns.playLeaveSound }));
vi.mock('$lib/helpers/toast', () => ({ showToast: fns.showToast }));
function Stub() {}
vi.mock('$lib/components/icons', () => ({ MeetIcon: Stub, MicIcon: Stub, MicOffIcon: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_in_call: () => 'In call',
  groups_call_people_in_call: (p) => `${p.count} in the call`,
  groups_call_return: () => 'Back to call',
  groups_call_leave: () => 'Leave call',
  groups_call_mute: () => 'Mute',
  groups_call_unmute: () => 'Unmute',
  groups_call_reconnecting: () => 'Reconnecting…',
  groups_call_connecting: () => 'Connecting…',
  groups_call_error_mic_denied: () => 'Microphone access denied',
  groups_call_error_mic_missing: () => 'No microphone',
  groups_call_error_camera_denied: () => 'x',
  groups_call_error_camera_missing: () => 'x',
  groups_call_error_device_busy: () => 'Device busy',
  groups_call_error_screen_denied: () => 'x',
  groups_call_error_media_generic: () => 'Media failed'
}));

const { default: CallDock } = await import('$lib/components/groups/call/CallDock.svelte');

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(call, { phase: 'ready', title: 'Standup', href: '/groups/abc?x=1', error: null });
  Object.assign(lk, {
    isConnected: true,
    isMuted: true,
    canPublish: true,
    connectionState: 'connected',
    remoteParticipants: [{ identity: 'b' }, { identity: 'c' }]
  });
});

describe('CallDock', () => {
  // QA 2026-10-02 B4/C2: floating (position:fixed) it covered the
  // breadcrumb / channel title / page heading; it is a strip in the flow.
  it('is a strip in the page flow, never floating over the page', () => {
    render(CallDock);
    const dock = screen.getByTestId('call-dock');
    expect(dock.className.split(/\s+/)).not.toContain('fixed');
    expect(dock.className.split(/\s+/)).toContain('shrink-0');
  });

  it('names the call and counts everyone in it', () => {
    render(CallDock);
    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByText('3 in the call')).toBeTruthy();
  });

  it('back to call brings the stage back and opens the call page', async () => {
    render(CallDock);
    await fireEvent.click(screen.getByRole('button', { name: 'Back to call' }));
    expect(fns.showCallStage).toHaveBeenCalledTimes(1);
    expect(fns.goto).toHaveBeenCalledWith('/groups/abc?x=1');
  });

  it('mutes and unmutes, explaining a mic failure', async () => {
    fns.toggleMute.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    );
    render(CallDock);
    await fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await Promise.resolve();
    expect(fns.showToast).toHaveBeenCalledWith('Microphone access denied', 'error');
  });

  it('no mic button for a listen-only token', () => {
    lk.canPublish = false;
    render(CallDock);
    expect(screen.queryByRole('button', { name: 'Unmute' })).toBeNull();
  });

  it('leave ends the call with the cue', async () => {
    render(CallDock);
    await fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(fns.playLeaveSound).toHaveBeenCalledTimes(1);
    expect(fns.leaveGroupCall).toHaveBeenCalledTimes(1);
  });

  // The server ended the seat (removed / dropped): no live dock for a
  // call that is over — the channel itself says what happened.
  it('renders nothing for an ended call', () => {
    call.phase = 'ended';
    render(CallDock);
    expect(screen.queryByTestId('call-dock')).toBeNull();
  });

  it('shows reconnecting and failed states', async () => {
    lk.connectionState = 'reconnecting';
    const { unmount } = render(CallDock);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    unmount();
    call.phase = 'error';
    call.error = new Error('x');
    render(CallDock);
    expect(screen.getByText('call failed')).toBeTruthy();
  });
});
