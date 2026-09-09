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

  // 1a (LANE-1): pin kind:39000 to the relay's own key, same rule
  // relay-directory.js already applies to the directory read.
  describe('author pin', () => {
    const RELAY_KEY = 'a'.repeat(64);

    it('has no authors key in the filter when the relay key is unknown — same shape as before', () => {
      const [req] = metadataRequestsByRelay([ptr('a')]);
      expect(req.filter).not.toHaveProperty('authors');
      expect(req.authors).toEqual([]);
    });

    it('has no authors key when getAuthorsForRelay is simply omitted', () => {
      const [req] = metadataRequestsByRelay([ptr('a')], undefined);
      expect(req.filter).not.toHaveProperty('authors');
    });

    it('pins the filter to the resolved key for that relay', () => {
      const [req] = metadataRequestsByRelay([ptr('a')], () => [RELAY_KEY]);
      expect(req.filter.authors).toEqual([RELAY_KEY]);
      expect(req.authors).toEqual([RELAY_KEY]);
    });

    it('resolves authors PER RELAY, not globally', () => {
      const KEY_B = 'b'.repeat(64);
      const out = metadataRequestsByRelay([ptr('x', A), ptr('y', B)], (relay) =>
        relay === An ? [RELAY_KEY] : relay === Bn ? [KEY_B] : []
      );
      expect(out.find((r) => r.relay === An)?.filter.authors).toEqual([RELAY_KEY]);
      expect(out.find((r) => r.relay === Bn)?.filter.authors).toEqual([KEY_B]);
    });

    it('leaves the filter unpinned when the callback returns nothing for that relay', () => {
      const [req] = metadataRequestsByRelay([ptr('a')], () => undefined);
      expect(req.filter).not.toHaveProperty('authors');
      expect(req.authors).toEqual([]);
    });
  });
});
