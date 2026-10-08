// The one place a BackgroundProcessor is put on a local camera track. Shared
// by the live call (services/livekit-connection) and the pre-join preview
// (services/call-preview), so the lobby shows exactly the processor the
// call then publishes. Kept apart from call-background.js: that module is
// in call-prefs' static graph, this one pulls @livekit/track-processors
// (and MediaPipe) on first use — only ever from lazily loaded code.

import { getCustomBackground } from '$lib/services/call-prefs.js';
import { MEDIAPIPE_ASSET_PATHS, backgroundProcessorOptions } from './call-background.js';

/**
 * Apply `effect` to a local video track. "none" (or an effect with nothing
 * to draw) stops the track's processor; a change while the processor this
 * caller built last is still on the track is a switchTo (no MediaPipe
 * rebuild); otherwise a new processor is built and set. Throws when the
 * processor fails — the caller decides what the previous effect was.
 *
 * @param {any} track livekit LocalVideoTrack
 * @param {string} effect 'none' | 'blur' | 'custom' | 'preset:<id>'
 * @param {any} previous the processor this caller built last, if any
 * @returns {Promise<any>} the processor now on the track, or null
 */
export async function applyBackgroundToTrack(track, effect, previous) {
  const options = backgroundProcessorOptions(effect, getCustomBackground());
  const current = track.getProcessor?.();
  if (!options) {
    if (current) await track.stopProcessor();
    return null;
  }
  if (previous && current === previous) {
    await previous.switchTo(options);
    return previous;
  }
  const { BackgroundProcessor } = await import('@livekit/track-processors');
  const processor = BackgroundProcessor({ ...options, assetPaths: MEDIAPIPE_ASSET_PATHS });
  await track.setProcessor(processor);
  return processor;
}
