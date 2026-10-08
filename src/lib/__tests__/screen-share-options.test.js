// @ts-nocheck
/**
 * Screen share capture options ("Ton teilen") and the silent-share check.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  screenShareCaptureOptions,
  screenShareAudioMissing
} from '$lib/groups/screen-share-options.js';

const res = { width: 1920, height: 1080, frameRate: 30 };

describe('screenShareCaptureOptions', () => {
  it('without sound: the picker behaves as before (no audio, detail hint, the preset)', () => {
    expect(screenShareCaptureOptions({ resolution: res, audio: false })).toEqual({
      audio: false,
      resolution: res,
      contentHint: 'detail'
    });
  });

  it('with sound: asks for system/tab audio and keeps our own tab out of the picker', () => {
    expect(screenShareCaptureOptions({ resolution: res, audio: true })).toEqual({
      audio: true,
      resolution: res,
      contentHint: 'detail',
      selfBrowserSurface: 'exclude',
      systemAudio: 'include'
    });
  });
});

describe('screenShareAudioMissing', () => {
  const pubs = (...sources) => sources.map((source) => ({ source }));

  it('is never missing when no sound was asked for', () => {
    expect(screenShareAudioMissing(false, pubs('screen_share'), 'screen_share_audio')).toBe(false);
  });

  it('is missing when sound was asked for and no screen share audio track exists', () => {
    expect(
      screenShareAudioMissing(
        true,
        pubs('microphone', 'camera', 'screen_share'),
        'screen_share_audio'
      )
    ).toBe(true);
    expect(screenShareAudioMissing(true, [], 'screen_share_audio')).toBe(true);
  });

  it('is fine when the browser delivered the audio track', () => {
    expect(
      screenShareAudioMissing(
        true,
        pubs('screen_share', 'screen_share_audio'),
        'screen_share_audio'
      )
    ).toBe(false);
  });

  it("accepts any iterable of publications (a Map's values)", () => {
    const map = new Map([['a', { source: 'screen_share_audio' }]]);
    expect(screenShareAudioMissing(true, map.values(), 'screen_share_audio')).toBe(false);
  });
});
