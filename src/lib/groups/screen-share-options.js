// Screen share capture options and the "no sound arrived" check — pure, so
// the browser rules live in one testable place.

/**
 * What to ask the browser for. With `audio` on, the share may carry the
 * tab's or the system's sound: `systemAudio: 'include'` offers it in the
 * picker, `selfBrowserSurface: 'exclude'` keeps our own tab out of the
 * picker — capturing the tab that plays the call would feed the call back
 * into itself (the echo the old `audio: false` comment warned about).
 * Without audio nothing else changes, so the picker behaves as before.
 *
 * @param {{resolution: {width: number, height: number, frameRate: number}, audio: boolean}} input
 * @returns {import('livekit-client').ScreenShareCaptureOptions}
 */
export function screenShareCaptureOptions({ resolution, audio }) {
  /** @type {import('livekit-client').ScreenShareCaptureOptions} */
  const options = { audio: !!audio, resolution, contentHint: 'detail' };
  if (audio) {
    options.selfBrowserSurface = 'exclude';
    options.systemAudio = 'include';
  }
  return options;
}

/**
 * Whether a share that asked for sound came back without it. Firefox and
 * Safari never deliver audio with display capture, Chrome only when the
 * user ticks "share audio" in the picker: in both cases the share is fine,
 * just silent — a hint, not an error.
 *
 * @param {boolean} audioWanted
 * @param {Iterable<{source?: string}>} publications the local participant's track publications
 * @param {string} audioSource Track.Source.ScreenShareAudio
 */
export function screenShareAudioMissing(audioWanted, publications, audioSource) {
  if (!audioWanted) return false;
  for (const pub of publications) {
    if (pub?.source === audioSource) return false;
  }
  return true;
}
