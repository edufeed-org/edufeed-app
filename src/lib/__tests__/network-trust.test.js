/** @vitest-environment node */
/**
 * network-trust — who counts as "in the viewer's network". Strangers' follow
 * notifications are collapsed and their profile media blurred (a porn account
 * following someone must not land them on explicit pictures with one click).
 */
import { describe, it, expect } from 'vitest';
import { isInNetworkOf, MIN_FOLLOWS_FOLLOWING } from '$lib/helpers/network-trust.js';

const ME = 'f'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

const base = {
  self: ME,
  follows: [A],
  trusted: [B],
  followedByFollows: (/** @type {string} */ pk) =>
    pk === 'd'.repeat(64) ? MIN_FOLLOWS_FOLLOWING : pk === 'e'.repeat(64) ? 1 : 0
};

describe('isInNetworkOf', () => {
  it('counts self, follows, trusted and people several follows follow', () => {
    expect(isInNetworkOf(ME, base)).toBe(true);
    expect(isInNetworkOf(A, base)).toBe(true);
    expect(isInNetworkOf(B, base)).toBe(true);
    expect(isInNetworkOf('d'.repeat(64), base)).toBe(true);
  });

  it('a stranger is not in the network', () => {
    expect(isInNetworkOf(STRANGER, base)).toBe(false);
  });

  it('one follow following them is not enough: mass-follow accounts follow spam too', () => {
    expect(isInNetworkOf('e'.repeat(64), base)).toBe(false);
  });

  it('logged out: only trusted authors count', () => {
    const anon = { self: undefined, follows: [], trusted: [B], followedByFollows: () => 0 };
    expect(isInNetworkOf(B, anon)).toBe(true);
    expect(isInNetworkOf(STRANGER, anon)).toBe(false);
    expect(isInNetworkOf('', anon)).toBe(false);
  });
});
