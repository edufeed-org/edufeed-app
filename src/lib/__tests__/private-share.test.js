/**
 * Private in-group sharing pure helpers. The rule under test: private-share
 * availability is the VIEWER's own membership (their decrypted area list) —
 * never a roster lookup, which E2E forbids.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { nostrShareUri, memberAreaIdFor, shareableChannels } from '$lib/concord/private-share.js';

const PK = 'a'.repeat(64);
const AREA = 'c'.repeat(64);

describe('nostrShareUri', () => {
  it('encodes addressables as naddr (d-tag identity), others as nevent', () => {
    const uri = nostrShareUri({ kind: 30142, pubkey: PK, tags: [['d', 'res-1']] });
    expect(uri?.startsWith('nostr:naddr1')).toBe(true);
    const decoded = nip19.decode(/** @type {string} */ (uri).slice(6));
    expect(decoded.data).toMatchObject({ kind: 30142, pubkey: PK, identifier: 'res-1' });

    const nevent = nostrShareUri({ kind: 1, id: 'b'.repeat(64) });
    expect(nevent?.startsWith('nostr:nevent1')).toBe(true);
    expect(nostrShareUri(null)).toBeNull();
  });
});

describe('memberAreaIdFor', () => {
  const communikey = { tags: [['concord', AREA, 'wss://concord.example']] };

  it('resolves only when the viewer holds the pointed-at area', () => {
    expect(memberAreaIdFor(communikey, [{ material: { community_id: AREA } }])).toBe(AREA);
    expect(
      memberAreaIdFor(communikey, [{ material: { community_id: 'd'.repeat(64) } }])
    ).toBeNull();
    expect(memberAreaIdFor(communikey, [])).toBeNull();
    expect(memberAreaIdFor({ tags: [] }, [{ material: { community_id: AREA } }])).toBeNull();
  });

  it('a dissolved area offers no share target', () => {
    expect(
      memberAreaIdFor(communikey, [{ material: { community_id: AREA }, dissolved: true }])
    ).toBeNull();
  });
});

describe('shareableChannels', () => {
  it('keeps readable channels, drops tombstones and locked ones', () => {
    const channels = [
      { channel_id: 'c1', name: 'general', accessible: true },
      { channel_id: 'c2', name: 'gone', deleted: true },
      { channel_id: 'c3', name: 'sealed', accessible: false },
      { channel_id: 'c4', name: 'open' } // accessible undefined = readable
    ];
    expect(shareableChannels(channels).map((c) => c.channel_id)).toEqual(['c1', 'c4']);
    expect(shareableChannels(/** @type {any} */ (null))).toEqual([]);
  });
});
