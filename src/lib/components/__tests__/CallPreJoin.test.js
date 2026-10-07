// @ts-nocheck
/**
 * CallPreJoin — the lobby before a call (issue "pre-join preview"): a
 * self-preview of the camera, a microphone level meter, device pickers and
 * the "join with camera / mic on" toggles. Local tracks only, through the
 * preview service; no Room, no token — joining is the parent's business
 * (onJoin), called only when the user presses join.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const { pv, svc } = vi.hoisted(() => ({
  pv: {
    videoTrack: null,
    audioTrack: null,
    level: 0,
    cameraError: null,
    micError: null,
    cameraStarting: false,
    micStarting: false,
    audioInputDevices: [],
    audioOutputDevices: [],
    videoInputDevices: [],
    activeAudioDeviceId: '',
    activeAudioOutputDeviceId: '',
    activeVideoDeviceId: ''
  },
  svc: {
    setPreviewCamera: vi.fn(async () => {}),
    setPreviewMic: vi.fn(async () => {}),
    switchPreviewDevice: vi.fn(async () => {}),
    refreshPreviewDevices: vi.fn(async () => {}),
    stopPreview: vi.fn()
  }
}));
vi.mock('$lib/services/call-preview.svelte.js', () => ({
  getCallPreviewState: () => pv,
  setPreviewCamera: (...a) => svc.setPreviewCamera(...a),
  setPreviewMic: (...a) => svc.setPreviewMic(...a),
  switchPreviewDevice: (...a) => svc.switchPreviewDevice(...a),
  refreshPreviewDevices: (...a) => svc.refreshPreviewDevices(...a),
  stopPreview: (...a) => svc.stopPreview(...a)
}));

const m = await import('$lib/paraglide/messages');
const { getJoinMedia, setJoinMedia } = await import('$lib/services/call-prefs.js');
const { default: CallPreJoin } = await import('$lib/components/groups/call/CallPreJoin.svelte');

const baseProps = { joinLabel: 'Beitreten', onJoin: vi.fn(async () => {}) };

function fakeTrack() {
  return { attach: vi.fn(), detach: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(pv, {
    videoTrack: null,
    audioTrack: null,
    level: 0,
    cameraError: null,
    micError: null,
    cameraStarting: false,
    micStarting: false,
    audioInputDevices: [],
    audioOutputDevices: [],
    videoInputDevices: [],
    activeAudioDeviceId: '',
    activeAudioOutputDeviceId: '',
    activeVideoDeviceId: ''
  });
});

describe('CallPreJoin — preview lifecycle', () => {
  it('starts the preview from the remembered toggles (first visit: mic on, camera off)', async () => {
    render(CallPreJoin, { props: baseProps });
    await waitFor(() => expect(svc.setPreviewMic).toHaveBeenCalledWith(true));
    expect(svc.setPreviewCamera).toHaveBeenCalledWith(false);
    expect(svc.refreshPreviewDevices).toHaveBeenCalled();
    expect(screen.getByTestId('call-prejoin-mic').checked).toBe(true);
    expect(screen.getByTestId('call-prejoin-camera').checked).toBe(false);
  });

  it('honours a remembered choice', async () => {
    setJoinMedia({ audio: false, video: true });
    render(CallPreJoin, { props: baseProps });
    await waitFor(() => expect(svc.setPreviewCamera).toHaveBeenCalledWith(true));
    expect(svc.setPreviewMic).toHaveBeenCalledWith(false);
  });

  it('toggling the camera opens / releases the preview camera', async () => {
    render(CallPreJoin, { props: baseProps });
    await fireEvent.click(screen.getByTestId('call-prejoin-camera'));
    await waitFor(() => expect(svc.setPreviewCamera).toHaveBeenLastCalledWith(true));
    await fireEvent.click(screen.getByTestId('call-prejoin-camera'));
    await waitFor(() => expect(svc.setPreviewCamera).toHaveBeenLastCalledWith(false));
  });

  it('shows the camera track mirrored in a muted video element, else a "camera off" placeholder', () => {
    const off = render(CallPreJoin, { props: baseProps });
    expect(screen.getByText(m.groups_call_prejoin_camera_off())).toBeTruthy();
    expect(screen.queryByTestId('call-prejoin-video')).toBeNull();
    off.unmount();

    const track = fakeTrack();
    pv.videoTrack = track;
    render(CallPreJoin, { props: baseProps });
    flushSync();
    const video = screen.getByTestId('call-prejoin-video');
    expect(video.muted).toBe(true);
    expect(video.className).toContain('-scale-x-100');
    expect(track.attach).toHaveBeenCalledWith(video);
  });

  it('releases both captures on unmount', () => {
    const view = render(CallPreJoin, { props: baseProps });
    view.unmount();
    expect(svc.stopPreview).toHaveBeenCalled();
  });
});

describe('CallPreJoin — microphone meter and errors', () => {
  it('the meter follows the level while the mic toggle is on', () => {
    pv.level = 0.2;
    render(CallPreJoin, { props: baseProps });
    const meter = screen.getByTestId('call-prejoin-level');
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
    expect(meter.firstElementChild.getAttribute('style')).toContain('width: 60%');
  });

  it('a refused camera shows why and flips its toggle off', async () => {
    setJoinMedia({ audio: true, video: true });
    pv.cameraError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    render(CallPreJoin, { props: baseProps });
    expect(await screen.findByTestId('call-prejoin-camera-error')).toBeTruthy();
    expect(screen.getByTestId('call-prejoin-camera-error').textContent).toContain(
      m.groups_call_error_camera_denied()
    );
    await waitFor(() => expect(screen.getByTestId('call-prejoin-camera').checked).toBe(false));
  });

  it('a missing microphone shows why and flips its toggle off', async () => {
    pv.micError = Object.assign(new Error('none'), { name: 'NotFoundError' });
    render(CallPreJoin, { props: baseProps });
    expect((await screen.findByTestId('call-prejoin-mic-error')).textContent).toContain(
      m.groups_call_error_mic_missing()
    );
    await waitFor(() => expect(screen.getByTestId('call-prejoin-mic').checked).toBe(false));
  });
});

describe('CallPreJoin — devices', () => {
  it('lists microphones and cameras and switches through the preview service', async () => {
    pv.audioInputDevices = [
      { deviceId: 'm1', label: 'Headset' },
      { deviceId: 'm2', label: 'Webcam mic' }
    ];
    pv.videoInputDevices = [{ deviceId: 'c1', label: 'Webcam' }];
    pv.activeAudioDeviceId = 'm1';
    pv.activeVideoDeviceId = 'c1';
    render(CallPreJoin, { props: baseProps });
    const mic = screen.getByTestId('call-prejoin-mic-device');
    expect(mic.value).toBe('m1');
    expect(mic.querySelectorAll('option').length).toBe(2);
    await fireEvent.change(mic, { target: { value: 'm2' } });
    expect(svc.switchPreviewDevice).toHaveBeenCalledWith('audioinput', 'm2');
    await fireEvent.change(screen.getByTestId('call-prejoin-camera-device'), {
      target: { value: 'c1' }
    });
    expect(svc.switchPreviewDevice).toHaveBeenCalledWith('videoinput', 'c1');
  });

  it('offers the speaker only where the output can be chosen (AudioContext.setSinkId)', () => {
    pv.audioOutputDevices = [{ deviceId: 's1', label: 'Speakers' }];
    const Ctor = globalThis.AudioContext;
    globalThis.AudioContext = class {
      setSinkId() {}
    };
    try {
      const view = render(CallPreJoin, { props: baseProps });
      expect(screen.getByTestId('call-prejoin-speaker-device')).toBeTruthy();
      view.unmount();
    } finally {
      globalThis.AudioContext = Ctor;
    }
    delete globalThis.AudioContext;
    render(CallPreJoin, { props: baseProps });
    expect(screen.queryByTestId('call-prejoin-speaker-device')).toBeNull();
  });

  it('a device without a label falls back to the unknown-device copy', () => {
    pv.audioInputDevices = [{ deviceId: 'm1', label: '' }];
    render(CallPreJoin, { props: baseProps });
    expect(screen.getByTestId('call-prejoin-mic-device').textContent).toContain(
      m.groups_call_unknown_device()
    );
  });
});

describe('CallPreJoin — joining', () => {
  it('join remembers the toggles, releases the preview first, then hands the media to the parent', async () => {
    const order = [];
    svc.stopPreview.mockImplementation(() => order.push('stop'));
    const onJoin = vi.fn(async () => {
      order.push('join');
    });
    render(CallPreJoin, { props: { ...baseProps, onJoin } });
    await fireEvent.click(screen.getByTestId('call-prejoin-camera'));
    await fireEvent.click(screen.getByTestId('call-prejoin-join'));
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith({ audio: true, video: true }));
    expect(order).toEqual(['stop', 'join']);
    expect(getJoinMedia()).toEqual({ audio: true, video: true });
  });

  it('Enter in a field the parent adds submits the join (the guest name)', async () => {
    const onJoin = vi.fn(async () => {});
    render(CallPreJoin, {
      props: { ...baseProps, onJoin }
      // no snippet API in the test helper: a plain input inside the form
    });
    const form = screen.getByTestId('call-prejoin');
    await fireEvent.submit(form);
    await waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
  });

  it('a failed join brings the preview back', async () => {
    const onJoin = vi.fn(async () => {
      throw new Error('refused');
    });
    render(CallPreJoin, { props: { ...baseProps, onJoin } });
    await fireEvent.click(screen.getByTestId('call-prejoin-join')).catch(() => {});
    await waitFor(() => expect(svc.stopPreview).toHaveBeenCalled());
    await waitFor(() => expect(svc.setPreviewMic).toHaveBeenLastCalledWith(true));
  });

  it('the join button carries the parent-chosen test id and disables while busy', () => {
    render(CallPreJoin, { props: { ...baseProps, busy: true, testid: 'call-landing-join' } });
    const button = screen.getByTestId('call-landing-join');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Beitreten');
  });

  it('offers cancel only when the parent can cancel; shows the parent error', async () => {
    const { unmount } = render(CallPreJoin, { props: baseProps });
    expect(screen.queryByTestId('call-prejoin-cancel')).toBeNull();
    unmount();
    const onCancel = vi.fn();
    render(CallPreJoin, { props: { ...baseProps, onCancel, error: 'Name fehlt' } });
    expect(screen.getByTestId('call-prejoin-error').textContent).toContain('Name fehlt');
    await fireEvent.click(screen.getByTestId('call-prejoin-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
