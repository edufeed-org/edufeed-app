/** @vitest-environment node */
/**
 * Kind 39004 — "livekit participants": an addressable event the relay
 * publishes (and re-signs on every join/leave) listing who is live in a
 * group's AV room, one `participant` tag per hex pubkey, `d` = group id.
 * Clients only READ it; the relay's LiveKit webhook writes it.
 */
import { describe, it, expect } from 'vitest';
import {
  CALL_PRESENCE_KIND,
  callPresenceFilter,
  parseCallParticipants
} from '$lib/groups/call-presence.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const RELAY_KEY = 'c'.repeat(64);

describe('CALL_PRESENCE_KIND', () => {
  it('is 39004', () => {
    expect(CALL_PRESENCE_KIND).toBe(39004);
  });
});

describe('callPresenceFilter', () => {
  it('asks for kind 39004 by group id, pinned to the relay key when one is known', () => {
    expect(callPresenceFilter('g1', [RELAY_KEY])).toEqual({
      kinds: [39004],
      '#d': ['g1'],
      authors: [RELAY_KEY]
    });
  });
  it('leaves out authors when the relay names no key', () => {
    expect(callPresenceFilter('g1', [])).toEqual({ kinds: [39004], '#d': ['g1'] });
    expect(callPresenceFilter('g1', undefined)).toEqual({ kinds: [39004], '#d': ['g1'] });
  });
});

describe('parseCallParticipants', () => {
  it('collects the participant tags as lowercase hex pubkeys', () => {
    const event = {
      kind: 39004,
      tags: [
        ['d', 'g1'],
        ['participant', A],
        ['participant', B.toUpperCase()]
      ]
    };
    expect(parseCallParticipants(event)).toEqual([A, B]);
  });
  it('dedupes repeats and drops malformed values (keyed {#each} safety)', () => {
    const event = {
      kind: 39004,
      tags: [
        ['participant', A],
        ['participant', A],
        ['participant', 'nope'],
        ['participant'],
        ['p', B]
      ]
    };
    expect(parseCallParticipants(event)).toEqual([A]);
  });
  it('returns [] for null, other kinds, and an empty room', () => {
    expect(parseCallParticipants(null)).toEqual([]);
    expect(parseCallParticipants({ kind: 39000, tags: [['participant', A]] })).toEqual([]);
    expect(parseCallParticipants({ kind: 39004, tags: [['d', 'g1']] })).toEqual([]);
  });
});
