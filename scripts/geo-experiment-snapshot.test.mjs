/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { keyForUrl, snapshotRows } from './geo-experiment-snapshot.mjs';
import { geoContentKey, geoGroup } from '../src/lib/server/geo/assignment.js';

const PK = '9'.repeat(64);

describe('geo experiment snapshot', () => {
  it('derives the same key as the server for naddr and community URLs', () => {
    const event = { kind: 30142, pubkey: PK, tags: [['d', 'https://oer.example/1']] };
    const naddr = nip19.naddrEncode({
      kind: 30142,
      pubkey: PK,
      identifier: 'https://oer.example/1',
      relays: ['wss://r.example']
    });
    expect(keyForUrl(`https://e.example/${naddr}`)?.key).toBe(geoContentKey(event));
    expect(keyForUrl(`https://e.example/c/npub1x/r/${naddr}`)?.key).toBe(geoContentKey(event));
  });

  it('keys wiki topics like the server', () => {
    expect(keyForUrl('https://e.example/wiki/erste%20schritte')).toEqual({
      kind: 30818,
      key: geoContentKey({ kind: 30818, pubkey: PK, tags: [['d', 'erste schritte']] })
    });
  });

  it('writes one CSV row per sitemap URL with its group', () => {
    const xml =
      '<urlset><url><loc>https://e.example/wiki/a</loc><lastmod>2026-01-01</lastmod></url>' +
      '<url><loc>https://e.example/discover</loc><lastmod>2026-01-01</lastmod></url></urlset>';
    const rows = snapshotRows(xml, 0.5, 'salt');
    expect(rows).toEqual([
      'url,kind,key,group,lastmod',
      `https://e.example/wiki/a,30818,wiki:a,${geoGroup('wiki:a', 0.5, 'salt')},2026-01-01`
    ]);
  });
});
