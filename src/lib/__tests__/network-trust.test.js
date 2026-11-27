/** @vitest-environment node */
/**
 * network-trust — who counts as "in the viewer's network". Strangers' follow
 * notifications are collapsed and their profile media blurred (a porn account
 * following someone must not land them on explicit pictures with one click).
 */
import { describe, it, expect } from 'vitest';
import {
  isInNetworkOf,
  MIN_FOLLOWS_FOLLOWING,
  splitStrangers
} from '$lib/helpers/network-trust.js';

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

describe('splitStrangers', () => {
  const ev = (/** @type {number} */ kind, /** @type {string} */ pubkey, guarded = false) => ({
    id: `${kind}-${pubkey[0]}-${guarded}`,
    kind,
    pubkey,
    guarded
  });
  const inNetwork = (/** @type {string} */ pk) => pk === A;
  const onGuardedRelay = (/** @type {any} */ e) => e.guarded;
  const split = (/** @type {any[]} */ events) => splitStrangers(events, inNetwork, onGuardedRelay);

  it('folds a stranger reply, reaction, comment and mention', () => {
    const events = [1, 7, 1111, 11, 30023, 30818].map((k) => ev(k, STRANGER));
    expect(split(events)).toEqual({ known: [], strangers: events });
  });

  it('keeps the same kinds from someone in the network', () => {
    const events = [ev(1, A), ev(7, A)];
    expect(split(events)).toEqual({ known: events, strangers: [] });
  });

  it('keeps a stranger whose event came through a guarded deployment relay (new app users)', () => {
    const e = ev(1111, STRANGER, true);
    expect(split([e])).toEqual({ known: [e], strangers: [] });
  });

  it('never folds kinds that come from strangers by design', () => {
    const events = [1069, 1070, 8, 9, 9000, 31925, 1018].map((k) => ev(k, STRANGER));
    expect(split(events).strangers).toEqual([]);
  });

  it('keeps the input order in both halves', () => {
    const events = [ev(1, STRANGER), ev(1, A), ev(7, STRANGER)];
    const { known, strangers } = split(events);
    expect(known).toEqual([events[1]]);
    expect(strangers).toEqual([events[0], events[2]]);
  });
});
