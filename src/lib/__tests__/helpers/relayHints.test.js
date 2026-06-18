/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { prioritizeRelayHints } from '$lib/helpers/relayHints.js';

const RPI = 'wss://relay-rpi.edufeed.org';
const NOS = 'wss://nos.lol';
const DAMUS = 'wss://relay.damus.io';

describe('prioritizeRelayHints', () => {
  it('orders durable (app-managed) relays ahead of transient ones', () => {
    const result = prioritizeRelayHints([NOS, RPI, DAMUS], [RPI]);
    expect(result[0]).toBe(RPI);
    expect(result).toEqual(expect.arrayContaining([NOS, RPI, DAMUS]));
  });

  it('never invents a durable relay that the event was not seen on', () => {
    // The app relay holds nothing we observed → it must not become a hint.
    const result = prioritizeRelayHints([NOS], ['wss://relay.edufeed.org']);
    expect(result).toEqual([NOS]);
  });

  it('caps to the limit while keeping the durable relay', () => {
    const result = prioritizeRelayHints([NOS, DAMUS, 'wss://nostr.wine', RPI], [RPI], 3);
    expect(result).toHaveLength(3);
    expect(result).toContain(RPI);
    expect(result[0]).toBe(RPI);
  });

  it('returns an empty array when nothing was seen', () => {
    expect(prioritizeRelayHints(undefined, [RPI])).toEqual([]);
    expect(prioritizeRelayHints(new Set(), [RPI])).toEqual([]);
  });

  it('matches durable relays regardless of a trailing slash', () => {
    const result = prioritizeRelayHints([NOS, `${RPI}/`], [RPI]);
    expect(result[0]).toBe(`${RPI}/`);
  });

  it('accepts a Set for the seen relays', () => {
    const result = prioritizeRelayHints(new Set([NOS, RPI]), [RPI]);
    expect(result[0]).toBe(RPI);
  });
});
