// @ts-nocheck
/**
 * LiveKit Connection Service — Screen Share Tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock livekit-client before importing the service
vi.mock('livekit-client', () => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    Disconnected: 'disconnected'
  };

  const Track = {
    Source: {
      Camera: 'camera',
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio'
    }
  };

  class MockRoom {
    /** @type {Record<string, Function[]>} */
    _handlers = {};
    localParticipant = {
      setMicrophoneEnabled: vi.fn(),
      setCameraEnabled: vi.fn(),
      setScreenShareEnabled: vi.fn(),
      activeDeviceMap: new Map(),
      identity: 'local-user',
      trackPublications: new Map()
    };
    remoteParticipants = new Map();

    on(event, handler) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(handler);
      return this;
    }

    emit(event, ...args) {
      for (const h of this._handlers[event] || []) h(...args);
    }

    async connect() {}
    async disconnect() {}

    static getLocalDevices = vi.fn(async () => []);
  }

  return { Room: MockRoom, RoomEvent, Track };
});

const { RoomEvent, Track } = await import('livekit-client');

// call-prefs reads localStorage (none in node): a tiny stand-in for the
// "Ton teilen" preference.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

// Dynamic import so mocks are in place
const { connectToRoom, disconnectFromRoom, toggleScreenShare, getLiveKitState } = await import(
  '$lib/services/livekit-connection.svelte.js'
);

describe('screen sharing', () => {
  beforeEach(async () => {
    // Ensure clean state
    await disconnectFromRoom();
    store.clear();
  });

  async function connectTestRoom() {
    await connectToRoom('token', 'wss://lk', { audio: true });
  }

  it('toggleScreenShare enables screen sharing and sets isScreenSharing = true', async () => {
    await connectTestRoom();
    const lk = getLiveKitState();
    expect(lk.isScreenSharing).toBe(false);

    await toggleScreenShare();

    expect(lk.isScreenSharing).toBe(true);
    expect(lk.room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ audio: false })
    );
  });

  // Issue "share tab/system audio with the screen share": sound only on
  // request, with our own tab kept out of the picker.
  describe('"Ton teilen"', () => {
    it('asks for system/tab audio and excludes the own tab when the preference is on', async () => {
      store.set('edufeed:call:screenShareAudio', '1');
      await connectTestRoom();
      const lk = getLiveKitState();
      await toggleScreenShare();
      expect(lk.room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          audio: true,
          selfBrowserSurface: 'exclude',
          systemAudio: 'include',
          contentHint: 'detail'
        })
      );
    });

    it('flags a share that came back without sound, and clears the flag on stop', async () => {
      store.set('edufeed:call:screenShareAudio', '1');
      await connectTestRoom();
      const lk = getLiveKitState();
      lk.room.localParticipant.trackPublications.set('v', { source: Track.Source.ScreenShare });
      await toggleScreenShare();
      expect(lk.isScreenSharing).toBe(true);
      expect(lk.screenShareAudioMissing).toBe(true);
      await toggleScreenShare();
      expect(lk.screenShareAudioMissing).toBe(false);
    });

    it('no flag when the browser delivered the audio track, or when no sound was asked for', async () => {
      store.set('edufeed:call:screenShareAudio', '1');
      await connectTestRoom();
      const lk = getLiveKitState();
      lk.room.localParticipant.trackPublications.set('v', { source: Track.Source.ScreenShare });
      lk.room.localParticipant.trackPublications.set('a', {
        source: Track.Source.ScreenShareAudio
      });
      await toggleScreenShare();
      expect(lk.screenShareAudioMissing).toBe(false);
      await toggleScreenShare();
      store.set('edufeed:call:screenShareAudio', '0');
      lk.room.localParticipant.trackPublications.clear();
      await toggleScreenShare();
      expect(lk.screenShareAudioMissing).toBe(false);
    });

    it('the browser stopping the share clears the flag too', async () => {
      store.set('edufeed:call:screenShareAudio', '1');
      await connectTestRoom();
      const lk = getLiveKitState();
      await toggleScreenShare();
      expect(lk.screenShareAudioMissing).toBe(true);
      lk.room.emit(RoomEvent.LocalTrackUnpublished, { source: Track.Source.ScreenShare });
      expect(lk.screenShareAudioMissing).toBe(false);
    });
  });

  it('toggleScreenShare again disables screen sharing', async () => {
    await connectTestRoom();
    const lk = getLiveKitState();

    await toggleScreenShare(); // enable
    expect(lk.isScreenSharing).toBe(true);

    await toggleScreenShare(); // disable
    expect(lk.isScreenSharing).toBe(false);
    expect(lk.room.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(false);
  });

  it('toggleScreenShare swallows error when user cancels browser picker', async () => {
    await connectTestRoom();
    const lk = getLiveKitState();

    // What Chromium/Firefox raise when the user closes the picker.
    lk.room.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    );

    // Should not throw
    await toggleScreenShare();
    expect(lk.isScreenSharing).toBe(false);
  });

  it('toggleScreenShare is a no-op when not connected', async () => {
    const lk = getLiveKitState();
    expect(lk.room).toBeNull();

    // Should not throw
    await toggleScreenShare();
    expect(lk.isScreenSharing).toBe(false);
  });

  it('disconnectFromRoom resets isScreenSharing to false', async () => {
    await connectTestRoom();

    await toggleScreenShare();
    expect(getLiveKitState().isScreenSharing).toBe(true);

    await disconnectFromRoom();
    expect(getLiveKitState().isScreenSharing).toBe(false);
  });

  it('LocalTrackUnpublished with ScreenShare source sets isScreenSharing = false', async () => {
    await connectTestRoom();
    const lk = getLiveKitState();

    await toggleScreenShare();
    expect(lk.isScreenSharing).toBe(true);

    // Simulate browser stop — fires LocalTrackUnpublished with screen share source
    lk.room.emit(RoomEvent.LocalTrackUnpublished, {
      source: Track.Source.ScreenShare
    });

    expect(lk.isScreenSharing).toBe(false);
  });

  it('LocalTrackUnpublished with non-ScreenShare source does not reset isScreenSharing', async () => {
    await connectTestRoom();
    const lk = getLiveKitState();

    await toggleScreenShare();
    expect(lk.isScreenSharing).toBe(true);

    // Camera track unpublished — should NOT affect screen sharing state
    lk.room.emit(RoomEvent.LocalTrackUnpublished, {
      source: Track.Source.Camera
    });

    expect(lk.isScreenSharing).toBe(true);
  });
});
