/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseConcordPointer,
  buildConcordPointerTag,
  withConcordPointer,
  withoutConcordPointer,
  isConcordCommunityId
} from '$lib/concord/pointer.js';

const CID = 'a'.repeat(64);

describe('isConcordCommunityId', () => {
  it('accepts 64-char lowercase hex', () => {
    expect(isConcordCommunityId(CID)).toBe(true);
  });
  it('rejects malformed or non-string values', () => {
    for (const bad of ['xyz', 'A'.repeat(64), 'a'.repeat(63), '', null, undefined, 123]) {
      expect(isConcordCommunityId(bad)).toBe(false);
    }
  });
});

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
  it('never throws on malformed tag entries (untrusted network input)', () => {
    expect(parseConcordPointer({ tags: /** @type {any} */ ([null]) })).toBeUndefined();
    expect(
      parseConcordPointer({
        tags: /** @type {any} */ ([null, ['concord', CID, 'wss://c.example']])
      })
    ).toEqual({
      communityId: CID,
      relay: 'wss://c.example'
    });
    expect(
      parseConcordPointer({ tags: /** @type {any} */ (['invalid', ['concord', CID]]) })
    ).toEqual({
      communityId: CID,
      relay: undefined
    });
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
  it('handles malformed tag entries without throwing', () => {
    const tagsWithNull = /** @type {any} */ ([null, ['d', ''], ['concord', 'b'.repeat(64)]]);
    const out = withConcordPointer(tagsWithNull, CID);
    expect(out).toContainEqual(['concord', CID]);
    expect(out).toContainEqual(['d', '']);
    // null should be filtered out by the guard
    expect(out.filter((t) => t === null)).toHaveLength(0);
  });
});

describe('withoutConcordPointer', () => {
  it('removes every concord tag, preserving other tags and the input array', () => {
    const tags = [
      ['d', ''],
      ['concord', CID, 'wss://c.example'],
      ['r', 'wss://x'],
      ['concord', 'b'.repeat(64)]
    ];
    const out = withoutConcordPointer(tags);
    expect(out).toEqual([
      ['d', ''],
      ['r', 'wss://x']
    ]);
    expect(tags).toHaveLength(4); // input untouched
  });
  it('is a no-op copy when no pointer is present', () => {
    const tags = [['r', 'wss://x']];
    const out = withoutConcordPointer(tags);
    expect(out).toEqual(tags);
    expect(out).not.toBe(tags);
  });
  it('handles malformed tag entries without throwing', () => {
    const tagsWithNull = /** @type {any} */ ([null, ['d', ''], ['concord', CID], ['r', 'wss://x']]);
    const out = withoutConcordPointer(tagsWithNull);
    expect(out).toEqual([
      ['d', ''],
      ['r', 'wss://x']
    ]);
    expect(out.filter((t) => t === null)).toHaveLength(0);
  });
});
