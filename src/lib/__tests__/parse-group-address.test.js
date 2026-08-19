/** @vitest-environment node */
// parseGroupAddress — the forgiving group-address parser behind the /groups
// page's "open by address" input. Lived in attach-candidates.js until the
// group-channel attach feature was removed (YAGNI, laoc 2026-08-19); the
// parser moved to groups.js with the /groups page as its only consumer.
import { describe, it, expect } from 'vitest';
import { parseGroupAddress } from '$lib/groups/groups.js';

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
    // step is the gate that keeps a wrong parse from doing anything.
    expect(parseGroupAddress('https://example.com/some/page')).toEqual({
      relay: 'wss://example.com/some/page',
      id: '_'
    });
    expect(parseGroupAddress("ftp://x'y")).toBeNull();
    expect(parseGroupAddress('not a url at all')).toBeNull();
  });
});
