// getUserMedia / getDisplayMedia failures → a sentence the user can act on.
// The DOMException names are the only stable signal across browsers.
import * as m from '$lib/paraglide/messages';

/**
 * @param {unknown} err
 * @param {'mic' | 'camera' | 'screen'} kind
 * @returns {string}
 */
export function callMediaErrorMessage(err, kind) {
  const name = /** @type {{name?: string}} */ (err ?? {}).name ?? '';
  if (name === 'NotReadableError' || name === 'AbortError')
    return m.groups_call_error_device_busy();
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    if (kind === 'mic') return m.groups_call_error_mic_denied();
    if (kind === 'camera') return m.groups_call_error_camera_denied();
    return m.groups_call_error_screen_denied();
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    if (kind === 'mic') return m.groups_call_error_mic_missing();
    if (kind === 'camera') return m.groups_call_error_camera_missing();
  }
  return m.groups_call_error_media_generic();
}
