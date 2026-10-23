/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { geoContentKey, geoGroup, parseShare } from '$lib/server/geo/assignment.js';

const PK = 'c'.repeat(64);

describe('geoContentKey', () => {
  it('keys wiki articles by topic so /wiki/<topic> and the naddr page share a group', () => {
    expect(geoContentKey({ kind: 30818, pubkey: PK, tags: [['d', 'nostr']] })).toBe('wiki:nostr');
  });

  it('keys other addressables by coordinate', () => {
    expect(geoContentKey({ kind: 30142, pubkey: PK, tags: [['d', 'https://x.example/']] })).toBe(
      `30142:${PK}:https://x.example/`
    );
  });

  it('keys regular events by id', () => {
    expect(geoContentKey({ kind: 1, pubkey: PK, id: 'e'.repeat(64), tags: [] })).toBe(
      'e'.repeat(64)
    );
  });
});

describe('geoGroup', () => {
  it('is deterministic', () => {
    expect(geoGroup('wiki:nostr', 0.5, 's')).toBe(geoGroup('wiki:nostr', 0.5, 's'));
  });

  it('puts everything in T at share 1 and in V at share 0', () => {
    for (const key of ['a', 'b', 'c', 'wiki:x']) {
      expect(geoGroup(key, 1, 's')).toBe('T');
      expect(geoGroup(key, 0, 's')).toBe('V');
    }
  });

  it('splits roughly in half at share 0.5', () => {
    let t = 0;
    for (let i = 0; i < 2000; i++) if (geoGroup(`30023:${PK}:${i}`, 0.5, 's') === 'T') t++;
    expect(t).toBeGreaterThan(900);
    expect(t).toBeLessThan(1100);
  });

  it('changes the split when the salt changes', () => {
    const keys = Array.from({ length: 200 }, (_, i) => `k${i}`);
    const a = keys.map((k) => geoGroup(k, 0.5, 'one')).join('');
    const b = keys.map((k) => geoGroup(k, 0.5, 'two')).join('');
    expect(a).not.toBe(b);
  });
});

describe('parseShare', () => {
  it('defaults to 1 (all pages served with content)', () => {
    expect(parseShare(undefined)).toBe(1);
    expect(parseShare('')).toBe(1);
    expect(parseShare('abc')).toBe(1);
  });

  it('parses and clamps numbers', () => {
    expect(parseShare('0.5')).toBe(0.5);
    expect(parseShare('0')).toBe(0);
    expect(parseShare('2')).toBe(1);
    expect(parseShare('-1')).toBe(0);
  });
});
