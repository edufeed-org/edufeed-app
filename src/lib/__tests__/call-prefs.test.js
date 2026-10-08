// @ts-nocheck
/**
 * call-prefs — per-device call preferences (localStorage): remembered
 * mic/speaker/camera, audio processing flags, per-person volume and screen
 * share quality. Every read/write survives a throwing storage (private mode,
 * blocked site data) by falling back to defaults.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getPreferredDevice,
  rememberDevice,
  getAudioProcessing,
  setAudioProcessing,
  micCaptureOptions,
  cameraCaptureOptions,
  getParticipantVolume,
  setParticipantVolume,
  getScreenShareQuality,
  setScreenShareQuality,
  SCREEN_SHARE_QUALITIES,
  getChatBeside,
  setChatBeside,
  getCallLayout,
  setCallLayout,
  getTileCap,
  setTileCap,
  TILE_CAPS,
  getScreenShareAudio,
  setScreenShareAudio,
  getBackgroundEffect,
  setBackgroundEffect,
  getCustomBackground,
  setCustomBackground,
  getJoinMedia,
  setJoinMedia
} from '$lib/services/call-prefs.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('devices', () => {
  it('remembers a device per kind and returns null when none is stored', () => {
    expect(getPreferredDevice('audioinput')).toBeNull();
    rememberDevice('audioinput', 'mic-1');
    rememberDevice('videoinput', 'cam-2');
    expect(getPreferredDevice('audioinput')).toBe('mic-1');
    expect(getPreferredDevice('videoinput')).toBe('cam-2');
    expect(getPreferredDevice('audiooutput')).toBeNull();
  });

  it('forgets a device when remembered as empty', () => {
    rememberDevice('audioinput', 'mic-1');
    rememberDevice('audioinput', '');
    expect(getPreferredDevice('audioinput')).toBeNull();
  });

  it('falls back to null when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getPreferredDevice('audioinput')).toBeNull();
  });
});

describe('audio processing', () => {
  it('defaults every browser processing flag to on', () => {
    expect(getAudioProcessing()).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    });
  });

  it('merges a partial update and persists it', () => {
    setAudioProcessing({ noiseSuppression: false });
    expect(getAudioProcessing()).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true
    });
  });

  it('builds mono mic capture options with the remembered device', () => {
    rememberDevice('audioinput', 'mic-1');
    setAudioProcessing({ autoGainControl: false });
    expect(micCaptureOptions()).toEqual({
      deviceId: 'mic-1',
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: false,
      channelCount: 1
    });
  });

  it('leaves the device out of the capture options when none is remembered', () => {
    expect(micCaptureOptions().deviceId).toBeUndefined();
    expect(cameraCaptureOptions()).toEqual({});
    rememberDevice('videoinput', 'cam-2');
    expect(cameraCaptureOptions()).toEqual({ deviceId: 'cam-2' });
  });
});

describe('per-person volume', () => {
  const PK = 'a'.repeat(64);

  it('defaults to 1 and clamps stored values to 0..2', () => {
    expect(getParticipantVolume(PK)).toBe(1);
    setParticipantVolume(PK, 1.5);
    expect(getParticipantVolume(PK)).toBe(1.5);
    setParticipantVolume(PK, 7);
    expect(getParticipantVolume(PK)).toBe(2);
    setParticipantVolume(PK, -1);
    expect(getParticipantVolume(PK)).toBe(0);
  });

  it('drops the entry when set back to 1, keeping storage small', () => {
    setParticipantVolume(PK, 0.5);
    setParticipantVolume(PK, 1);
    expect(localStorage.getItem('edufeed:call:volumes')).toBe('{}');
  });
});

describe('screen share quality', () => {
  it('defaults to 1080p at 30 fps and only accepts known presets', () => {
    expect(getScreenShareQuality()).toBe('1080p30');
    setScreenShareQuality('720p15');
    expect(getScreenShareQuality()).toBe('720p15');
    setScreenShareQuality('8k240');
    expect(getScreenShareQuality()).toBe('720p15');
    expect(Object.keys(SCREEN_SHARE_QUALITIES)).toContain('1440p30');
  });
});

describe('stage layout and tile cap', () => {
  it('defaults to the grid and remembers a known layout only', () => {
    expect(getCallLayout()).toBe('grid');
    setCallLayout('side');
    expect(getCallLayout()).toBe('side');
    setCallLayout('cinema');
    expect(getCallLayout()).toBe('side');
    localStorage.setItem('edufeed:call:layout', 'bogus');
    expect(getCallLayout()).toBe('grid');
  });

  it('defaults to 16 tiles per page and accepts 9, 16 and 25 only', () => {
    expect(TILE_CAPS).toEqual([9, 16, 25]);
    expect(getTileCap()).toBe(16);
    setTileCap(9);
    expect(getTileCap()).toBe(9);
    setTileCap(12);
    expect(getTileCap()).toBe(9);
    localStorage.setItem('edufeed:call:tileCap', '100');
    expect(getTileCap()).toBe(16);
  });
});

describe('screen share sound ("Ton teilen")', () => {
  it('is off by default and remembers an explicit choice either way', () => {
    expect(getScreenShareAudio()).toBe(false);
    setScreenShareAudio(true);
    expect(getScreenShareAudio()).toBe(true);
    setScreenShareAudio(false);
    expect(getScreenShareAudio()).toBe(false);
    localStorage.setItem('edufeed:call:screenShareAudio', 'yes');
    expect(getScreenShareAudio()).toBe(false);
  });
});

describe('chat beside the call', () => {
  it('defaults to open (QA C3) and remembers an explicit choice either way', () => {
    expect(getChatBeside()).toBe(true);
    setChatBeside(false);
    expect(getChatBeside()).toBe(false);
    expect(localStorage.getItem('edufeed:call:chatBeside')).toBe('0');
    setChatBeside(true);
    expect(getChatBeside()).toBe(true);
  });
});

describe('camera background effect', () => {
  it('defaults to none and remembers a valid effect', () => {
    expect(getBackgroundEffect()).toBe('none');
    setBackgroundEffect('blur');
    expect(getBackgroundEffect()).toBe('blur');
    expect(localStorage.getItem('edufeed:call:background')).toBe('blur');
  });

  it('ignores an unknown stored effect', () => {
    localStorage.setItem('edufeed:call:background', 'sparkles');
    expect(getBackgroundEffect()).toBe('none');
  });

  it('keeps the own image on this device and reports whether storing worked', () => {
    expect(getCustomBackground()).toBeNull();
    expect(setCustomBackground('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(getCustomBackground()).toBe('data:image/jpeg;base64,AAAA');
  });

  it('reports a full or blocked storage instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(setCustomBackground('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(() => setBackgroundEffect('blur')).not.toThrow();
  });
});

// Pre-join lobby: "join with camera / mic on", remembered on this device.
describe('join media', () => {
  it('defaults to mic on, camera off, and remembers an explicit choice', () => {
    expect(getJoinMedia()).toEqual({ audio: true, video: false });
    setJoinMedia({ audio: false, video: true });
    expect(getJoinMedia()).toEqual({ audio: false, video: true });
  });

  it('ignores a malformed stored value', () => {
    localStorage.setItem('edufeed:call:joinMedia', '{"audio":"yes"}');
    expect(getJoinMedia()).toEqual({ audio: true, video: false });
    localStorage.setItem('edufeed:call:joinMedia', 'nope');
    expect(getJoinMedia()).toEqual({ audio: true, video: false });
  });

  it('survives a throwing storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setJoinMedia({ audio: true, video: true })).not.toThrow();
    expect(getJoinMedia()).toEqual({ audio: true, video: false });
  });
});
