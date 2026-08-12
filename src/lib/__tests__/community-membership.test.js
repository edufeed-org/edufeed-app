/** @vitest-environment node */
// src/lib/__tests__/community-membership.test.js
import { describe, it, expect } from 'vitest';
import {
  parseMembershipPointer,
  buildMembershipTag,
  withMembershipPointer,
  withoutMembershipPointer,
  parseApplicationRef,
  buildApplicationTag,
  withApplicationRef,
  withoutApplicationRef,
  deriveCommunityType
} from '$lib/groups/community-membership.js';

const RELAY = 'wss://groups.example.com';
const PK = 'a'.repeat(64);
/** @param {string[][]} tags */
const event = (tags) => ({ kind: 10222, pubkey: PK, tags });

describe('parseMembershipPointer', () => {
  it('parses a valid membership tag', () => {
    expect(parseMembershipPointer(event([['membership', 'root1', RELAY]]))).toEqual({
      id: 'root1',
      relay: RELAY
    });
  });
  it('returns null without a membership tag, without event, or without tags', () => {
    expect(parseMembershipPointer(event([['r', RELAY]]))).toBeNull();
    expect(parseMembershipPointer(null)).toBeNull();
    expect(parseMembershipPointer({})).toBeNull();
  });
  it('skips tags with empty id or invalid relay (fail open, first valid wins)', () => {
    expect(parseMembershipPointer(event([['membership', '', RELAY]]))).toBeNull();
    expect(parseMembershipPointer(event([['membership', 'root1', 'not-a-url']]))).toBeNull();
    expect(parseMembershipPointer(event([['membership', 'root1']]))).toBeNull();
    expect(
      parseMembershipPointer(
        event([
          ['membership', 'bad', 'http://x'],
          ['membership', 'good', RELAY],
          ['membership', 'second', RELAY]
        ])
      )
    ).toEqual({ id: 'good', relay: RELAY });
  });
});

describe('membership tag writers', () => {
  it('builds the tag', () => {
    expect(buildMembershipTag({ id: 'root1', relay: RELAY })).toEqual([
      'membership',
      'root1',
      RELAY
    ]);
  });
  it('withMembershipPointer replaces any existing membership tags (singular)', () => {
    const tags = [
      ['r', RELAY],
      ['membership', 'old', RELAY],
      ['membership', 'older', RELAY]
    ];
    const out = withMembershipPointer(tags, { id: 'new', relay: RELAY });
    expect(out.filter((t) => t[0] === 'membership')).toEqual([['membership', 'new', RELAY]]);
    expect(out).toContainEqual(['r', RELAY]);
    expect(tags).toHaveLength(3); // input untouched
  });
  it('withoutMembershipPointer strips all membership tags, leaves siblings', () => {
    const out = withoutMembershipPointer([
      ['membership', 'x', RELAY],
      ['group', 'chan', RELAY]
    ]);
    expect(out).toEqual([['group', 'chan', RELAY]]);
  });
});

describe('application ref', () => {
  const ADDR = `30168:${PK}:edufeed-membership`;
  it('parses address and optional relay hint', () => {
    expect(parseApplicationRef(event([['application', ADDR, RELAY]]))).toEqual({
      address: ADDR,
      relay: RELAY
    });
    expect(parseApplicationRef(event([['application', ADDR]]))).toEqual({
      address: ADDR,
      relay: null
    });
  });
  it('rejects non-30168 or malformed addresses', () => {
    expect(parseApplicationRef(event([['application', `30000:${PK}:x`]]))).toBeNull();
    expect(parseApplicationRef(event([['application', '30168:notenoughparts']]))).toBeNull();
    expect(parseApplicationRef(event([]))).toBeNull();
  });
  it('build/with/without round-trip', () => {
    const ref = { address: ADDR, relay: RELAY };
    expect(buildApplicationTag(ref)).toEqual(['application', ADDR, RELAY]);
    expect(buildApplicationTag({ address: ADDR })).toEqual(['application', ADDR]);
    const out = withApplicationRef([['application', `30168:${PK}:old`]], ref);
    expect(out.filter((t) => t[0] === 'application')).toEqual([['application', ADDR, RELAY]]);
    expect(withoutApplicationRef(out)).toEqual([]);
  });
});

describe('deriveCommunityType', () => {
  const CONCORD_ID = 'b'.repeat(64);
  it('is open without pointers, for null, and for events without tags', () => {
    expect(deriveCommunityType(event([['r', RELAY]]))).toBe('open');
    expect(deriveCommunityType(null)).toBe('open');
    expect(deriveCommunityType({})).toBe('open');
  });
  it('is moderated with a membership pointer', () => {
    expect(deriveCommunityType(event([['membership', 'root1', RELAY]]))).toBe('moderated');
  });
  it('is closed with a concord pointer', () => {
    expect(deriveCommunityType(event([['concord', CONCORD_ID, RELAY]]))).toBe('closed');
  });
  it('falls back to open on XOR violation (both pointers)', () => {
    expect(
      deriveCommunityType(
        event([
          ['concord', CONCORD_ID, RELAY],
          ['membership', 'root1', RELAY]
        ])
      )
    ).toBe('open');
  });
  it('an invalid membership tag does not make the community moderated', () => {
    expect(deriveCommunityType(event([['membership', 'root1', 'garbage']]))).toBe('open');
  });
  it('never throws on malformed tag entries (untrusted network input)', () => {
    expect(deriveCommunityType({ tags: [null] })).toBe('open');
    expect(deriveCommunityType({ tags: [null, ['concord', CONCORD_ID, RELAY]] })).toBe('closed');
  });
});
