// @ts-nocheck
/**
 * callMediaErrorMessage — turns getUserMedia / getDisplayMedia failures into
 * a sentence the user can act on, per device kind.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_error_mic_denied: () => 'mic-denied',
  groups_call_error_mic_missing: () => 'mic-missing',
  groups_call_error_camera_denied: () => 'camera-denied',
  groups_call_error_camera_missing: () => 'camera-missing',
  groups_call_error_device_busy: () => 'device-busy',
  groups_call_error_screen_denied: () => 'screen-denied',
  groups_call_error_media_generic: () => 'media-generic'
}));

const { callMediaErrorMessage } = await import('$lib/groups/call-media-errors.js');

/** @param {string} name @param {string} [message] */
const err = (name, message = '') => Object.assign(new Error(message), { name });

describe('callMediaErrorMessage', () => {
  it.each([
    ['mic', 'NotAllowedError', 'mic-denied'],
    ['mic', 'NotFoundError', 'mic-missing'],
    ['mic', 'OverconstrainedError', 'mic-missing'],
    ['mic', 'NotReadableError', 'device-busy'],
    ['camera', 'NotAllowedError', 'camera-denied'],
    ['camera', 'NotFoundError', 'camera-missing'],
    ['camera', 'NotReadableError', 'device-busy'],
    ['screen', 'NotAllowedError', 'screen-denied'],
    ['screen', 'NotReadableError', 'device-busy']
  ])('%s + %s → %s', (kind, name, expected) => {
    expect(callMediaErrorMessage(err(name), kind)).toBe(expected);
  });

  it('falls back to a generic message for anything else', () => {
    expect(callMediaErrorMessage(new Error('boom'), 'mic')).toBe('media-generic');
    expect(callMediaErrorMessage('weird', 'camera')).toBe('media-generic');
  });
});
