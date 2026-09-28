// Short synthesized call cues — no audio files, no dependencies. One shared
// AudioContext, created lazily on first use (browsers only allow it after a
// user gesture, which joining a call is). Every cue is best effort: without
// Web Audio, or when the audio device is gone, it silently does nothing.

/** @type {AudioContext | null} */
let context = null;
let broken = false;

function getContext() {
  if (broken) return null;
  if (context) return context;
  const Ctor =
    typeof window !== 'undefined'
      ? /** @type {any} */ (window).AudioContext || /** @type {any} */ (window).webkitAudioContext
      : undefined;
  if (typeof Ctor !== 'function') return null;
  try {
    context = new Ctor();
  } catch {
    broken = true;
    return null;
  }
  return context;
}

/**
 * One tone: a sine sweep from `from` to `to` Hz with a short fade, `delay`
 * seconds after now.
 * @param {number} from
 * @param {number} to
 * @param {number} duration seconds
 * @param {number} [delay] seconds
 * @param {number} [peak] gain 0..1
 */
function tone(from, to, duration, delay = 0, peak = 0.12) {
  const ctx = getContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch {
    // the audio graph is gone (device unplugged, context closed) — no cue
  }
}

/** Someone (or you) joined: a rising chirp. */
export function playJoinSound() {
  tone(520, 880, 0.18);
}

/** Someone left: a falling chirp. */
export function playLeaveSound() {
  tone(740, 420, 0.2);
}

/** You muted yourself: a quiet low blip. */
export function playMuteSound() {
  tone(420, 360, 0.09, 0, 0.07);
}

/** You unmuted yourself: a quiet high blip. */
export function playUnmuteSound() {
  tone(620, 700, 0.09, 0, 0.07);
}

/** A screen share started: a short rising three-note figure. */
export function playScreenShareSound() {
  tone(523, 523, 0.1, 0, 0.09);
  tone(659, 659, 0.1, 0.11, 0.09);
  tone(784, 784, 0.14, 0.22, 0.09);
}
