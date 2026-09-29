// @ts-nocheck
/**
 * call-sounds — short synthesized cues (no audio files): join, leave,
 * mute, unmute, screen share. They must never throw, with or without Web
 * Audio, and must reuse one AudioContext.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function fakeAudioContext() {
  const created = { contexts: 0, oscillators: [] };
  class FakeParam {
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
  }
  class FakeNode {
    connect() {
      return this;
    }
  }
  class FakeContext {
    state = 'running';
    currentTime = 0;
    destination = new FakeNode();
    constructor() {
      created.contexts++;
    }
    createOscillator() {
      const osc = new FakeNode();
      osc.frequency = new FakeParam();
      osc.type = 'sine';
      osc.start = vi.fn();
      osc.stop = vi.fn();
      created.oscillators.push(osc);
      return osc;
    }
    createGain() {
      const gain = new FakeNode();
      gain.gain = new FakeParam();
      return gain;
    }
    resume() {
      return Promise.resolve();
    }
  }
  return { FakeContext, created };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('call sounds', () => {
  it('play oscillator cues through one shared AudioContext', async () => {
    const { FakeContext, created } = fakeAudioContext();
    vi.stubGlobal('AudioContext', FakeContext);
    const sounds = await import('$lib/services/call-sounds.js');

    sounds.playJoinSound();
    sounds.playLeaveSound();
    sounds.playMuteSound();
    sounds.playUnmuteSound();
    sounds.playScreenShareSound();

    expect(created.contexts).toBe(1);
    expect(created.oscillators.length).toBeGreaterThanOrEqual(5);
    for (const osc of created.oscillators) {
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    }
  });

  it('are silent no-ops without Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const sounds = await import('$lib/services/call-sounds.js');
    expect(() => {
      sounds.playJoinSound();
      sounds.playLeaveSound();
      sounds.playScreenShareSound();
    }).not.toThrow();
  });

  it('swallow errors thrown by the audio graph', async () => {
    class Broken {
      constructor() {
        throw new Error('no audio device');
      }
    }
    vi.stubGlobal('AudioContext', Broken);
    const sounds = await import('$lib/services/call-sounds.js');
    expect(() => sounds.playJoinSound()).not.toThrow();
  });
});
