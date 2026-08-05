/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { metadataRequestsByRelay } from '$lib/groups/channel-metadata-requests.js';

const A = 'wss://a.example';
const B = 'wss://b.example';
// What the planner dials with: relay URLs come back normalised (see the last
// case), so look results up by the normalised form, never by the input.
const An = 'wss://a.example/';
const Bn = 'wss://b.example/';

const ptr = (/** @type {string} */ id, /** @type {string} */ relay = A) => ({ id, relay });

describe('metadataRequestsByRelay', () => {
  it('is empty for no pointers', () => {
    expect(metadataRequestsByRelay([])).toEqual([]);
    expect(metadataRequestsByRelay(/** @type {any} */ (undefined))).toEqual([]);
  });

  // One REQ per relay, not one per channel: a community with eight channels on
  // our relay should open one subscription, not eight.
  it('asks each relay once, for all of its channels', () => {
    const out = metadataRequestsByRelay([ptr('a'), ptr('b'), ptr('c', B)]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.relay === An)?.filter['#d']).toEqual(['a', 'b']);
    expect(out.find((r) => r.relay === Bn)?.filter['#d']).toEqual(['c']);
  });

  it('asks only for group metadata', () => {
    const [req] = metadataRequestsByRelay([ptr('a')]);
    expect(req.filter.kinds).toEqual([39000]);
  });

  it('folds relay URLs that normalise equal into one request', () => {
    const out = metadataRequestsByRelay([
      ptr('a', 'wss://a.example'),
      ptr('b', 'wss://A.Example/')
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].filter['#d']).toEqual(['a', 'b']);
  });

  it('does not ask twice for the same channel', () => {
    const out = metadataRequestsByRelay([ptr('a'), ptr('a')]);
    expect(out[0].filter['#d']).toEqual(['a']);
  });

  it('skips pointers that are not addressable', () => {
    const out = metadataRequestsByRelay([
      /** @type {any} */ ({ id: 'x', relay: 'not a url' }),
      ptr('ok')
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].filter['#d']).toEqual(['ok']);
  });

  // The row builder looks metadata up by channelKey, so the request has to
  // carry the same keys back — otherwise every row stays "pending" forever.
  it('carries the channel keys the row builder will look up', () => {
    const [req] = metadataRequestsByRelay([ptr('a'), ptr('b')]);
    expect(req.keys).toEqual(['a@wss://a.example/', 'b@wss://a.example/']);
  });

  it('uses the normalised relay URL for dialling', () => {
    const [req] = metadataRequestsByRelay([ptr('a', 'wss://A.Example')]);
    expect(req.relay).toBe('wss://a.example/');
  });
});
