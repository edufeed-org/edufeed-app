/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseConcordPointer,
  buildConcordPointerTag,
  withConcordPointer
} from '$lib/concord/pointer.js';

const CID = 'a'.repeat(64);

describe('buildConcordPointerTag', () => {
  it('builds ["concord", id, relay]', () => {
    expect(buildConcordPointerTag(CID, 'wss://c.example')).toEqual([
      'concord',
      CID,
      'wss://c.example'
    ]);
  });
  it('omits relay when not given', () => {
    expect(buildConcordPointerTag(CID)).toEqual(['concord', CID]);
  });
});

describe('parseConcordPointer', () => {
  it('parses a valid pointer', () => {
    const event = {
      kind: 10222,
      tags: [
        ['r', 'wss://x'],
        ['concord', CID, 'wss://c.example']
      ]
    };
    expect(parseConcordPointer(event)).toEqual({ communityId: CID, relay: 'wss://c.example' });
  });
  it('returns undefined without a pointer tag', () => {
    expect(parseConcordPointer({ kind: 10222, tags: [] })).toBeUndefined();
  });
  it('rejects malformed community ids (network input!)', () => {
    for (const bad of ['xyz', 'A'.repeat(64), 'a'.repeat(63), '']) {
      expect(parseConcordPointer({ kind: 10222, tags: [['concord', bad]] })).toBeUndefined();
    }
  });
  it('tolerates missing relay', () => {
    expect(parseConcordPointer({ kind: 10222, tags: [['concord', CID]] })).toEqual({
      communityId: CID,
      relay: undefined
    });
  });
  it('handles null/undefined event', () => {
    expect(parseConcordPointer(null)).toBeUndefined();
    expect(parseConcordPointer(undefined)).toBeUndefined();
  });
});

describe('withConcordPointer', () => {
  it('appends when absent, preserving other tags', () => {
    const tags = [
      ['d', ''],
      ['r', 'wss://x']
    ];
    const out = withConcordPointer(tags, CID, 'wss://c.example');
    expect(out).toEqual([
      ['d', ''],
      ['r', 'wss://x'],
      ['concord', CID, 'wss://c.example']
    ]);
    expect(tags).toHaveLength(2); // input untouched
  });
  it('replaces an existing concord tag', () => {
    const out = withConcordPointer([['concord', 'b'.repeat(64)]], CID);
    expect(out).toEqual([['concord', CID]]);
  });
});
