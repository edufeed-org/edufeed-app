/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  groupAttachCandidates,
  parseGroupAddress,
  attachAccessQuestion
} from '$lib/groups/attach-candidates.js';

const COMMUNITY = 'c'.repeat(64);
/** A 10222 already carrying one group channel. */
const communikeyEvent = {
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [['group', 'linked1', 'wss://host.example/']]
};
const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'x'], ['name', 'Lesekreis'], ...extra]
});

describe('groupAttachCandidates', () => {
  const groups = [
    { id: 'linked1', relay: 'wss://host.example' }, // already a channel here (slash-variant!)
    { id: 'open1', relay: 'wss://host.example/' },
    { id: 'closed1', relay: 'wss://other.example/' }
  ];

  it('excludes groups already linked to THIS community, across slash spellings', () => {
    const rows = groupAttachCandidates({ groups, communikeyEvent, metadataByKey: {} });
    // sorted by display name — with no metadata that is the id
    expect(rows.map((r) => r.pointer.id)).toEqual(['closed1', 'open1']);
  });

  it('categorizes world-readable vs closed from the 39000, unknown counts as closed', () => {
    const metadataByKey = {
      'open1@wss://host.example/': meta(), // no `private` tag -> world
      'closed1@wss://other.example/': meta([['private']])
    };
    const rows = groupAttachCandidates({ groups, communikeyEvent, metadataByKey });
    const open = rows.find((r) => r.pointer.id === 'open1');
    const closed = rows.find((r) => r.pointer.id === 'closed1');
    expect(open).toMatchObject({ category: 'world', worldReadable: true, name: 'Lesekreis' });
    expect(closed).toMatchObject({ category: 'closed', worldReadable: false });
    // no metadata at all -> closed, and the id stands in for the name
    const bare = groupAttachCandidates({ groups, communikeyEvent, metadataByKey: {} });
    expect(bare.find((r) => r.pointer.id === 'open1')).toMatchObject({
      category: 'closed',
      name: 'open1'
    });
  });

  it('handles empty and null inputs', () => {
    expect(groupAttachCandidates({ groups: [], communikeyEvent, metadataByKey: {} })).toEqual([]);
    expect(
      groupAttachCandidates({ groups: null, communikeyEvent: null, metadataByKey: {} })
    ).toEqual([]);
  });
});

describe('parseGroupAddress', () => {
  it("accepts host'id, wss://host'id, and http(s)/ws mapped to wss", () => {
    for (const input of [
      "groups.example'book",
      "wss://groups.example'book",
      "https://groups.example'book",
      "  http://groups.example'book  ",
      // ws:// is on the scheme whitelist but must not survive into the
      // written pointer — everything ends up wss:// (see fix-wave report).
      "ws://groups.example'book"
    ]) {
      expect(parseGroupAddress(input)).toEqual({ relay: 'wss://groups.example/', id: 'book' });
    }
  });

  it('rejects everything else', () => {
    expect(parseGroupAddress('')).toBeNull();
    // verified against decodeGroupPointer: a pasted page URL parses as the
    // host's ROOT group `_` (relay keeps the path) — acceptable, the preview
    // step is the gate that keeps a wrong parse from attaching anything.
    expect(parseGroupAddress('https://example.com/some/page')).toEqual({
      relay: 'wss://example.com/some/page',
      id: '_'
    });
    expect(parseGroupAddress("ftp://x'y")).toBeNull();
    expect(parseGroupAddress('not a url at all')).toBeNull();
  });
});

describe('attachAccessQuestion', () => {
  it('only a private NIP-29 target asks', () => {
    expect(attachAccessQuestion({ kind: 'concord', worldReadable: false })).toBe(false);
    expect(attachAccessQuestion({ kind: 'group', worldReadable: true })).toBe(false);
    expect(attachAccessQuestion({ kind: 'group', worldReadable: false })).toBe(true);
  });
});
