/**
 * Tests for media-devices helpers — dedupe of enumerateDevices() results
 * before they feed a keyed {#each} in the call device pickers.
 *
 * Firefox (and some audiooutput setups) list several devices of one kind
 * all with deviceId "" before a capture permission has been granted; a
 * duplicate key in a keyed {#each} throws each_key_duplicate and kills the
 * whole call route.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { dedupeDevices } from '../helpers/media-devices.js';

/**
 * @param {string} deviceId
 * @param {string} [label]
 * @param {string} [groupId]
 */
function device(deviceId, label = '', groupId = '') {
  return /** @type {MediaDeviceInfo} */ ({ kind: 'audioinput', deviceId, label, groupId });
}

describe('dedupeDevices', () => {
  it('keeps the first entry per empty deviceId (Firefox before permission)', () => {
    const firefox = [device('', '', 'g1'), device('', '', 'g2'), device('', '', 'g3')];
    const out = dedupeDevices(firefox);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(firefox[0]);
  });

  it('keeps the first entry per non-empty deviceId and drops repeats', () => {
    const list = [
      device('', 'placeholder a'),
      device('', 'placeholder b'),
      device('', 'placeholder c'),
      device('abc', 'Headset'),
      device('abc', 'Headset again'),
      device('def', 'Webcam mic')
    ];
    const out = dedupeDevices(list);
    expect(out.map((d) => d.deviceId)).toEqual(['', 'abc', 'def']);
    expect(out.map((d) => d.label)).toEqual(['placeholder a', 'Headset', 'Webcam mic']);
  });

  it('preserves order and leaves deviceIds untouched', () => {
    const list = [device('default', 'Default'), device('', 'unnamed'), device('x', 'X')];
    const out = dedupeDevices(list);
    expect(out.map((d) => d.deviceId)).toEqual(['default', '', 'x']);
    expect(out[1].deviceId).toBe('');
  });

  it('returns a fresh array and tolerates missing deviceId', () => {
    const list = [device('a'), /** @type {any} */ ({ kind: 'audioinput', label: 'no id' })];
    const out = dedupeDevices(list);
    expect(out).not.toBe(list);
    expect(out).toHaveLength(2);
    expect(dedupeDevices(dedupeDevices(list))).toEqual(out);
  });

  it('returns an empty array for null/undefined/empty input', () => {
    expect(dedupeDevices(null)).toEqual([]);
    expect(dedupeDevices(undefined)).toEqual([]);
    expect(dedupeDevices([])).toEqual([]);
  });
});
