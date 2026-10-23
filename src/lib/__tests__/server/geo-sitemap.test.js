/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  sitemapSources,
  resolveAuthors,
  buildSitemapEntries,
  renderSitemapXml,
  createSitemapCache
} from '$lib/server/geo/sitemap.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ORIGIN = 'https://edufeed.example';

/** @param {number} kind @param {string} pubkey @param {string} d @param {number} created_at @param {string[][]} [extra] */
const ev = (kind, pubkey, d, created_at, extra = []) => ({
  id: String(created_at).padStart(64, '0'),
  kind,
  pubkey,
  created_at,
  content: '',
  sig: '',
  tags: [['d', d], ...extra]
});

describe('sitemapSources', () => {
  it('maps content kinds to their relays and curation categories', () => {
    const sources = sitemapSources({
      LONGFORM_CONTENT_RELAY: 'wss://long.example',
      COMMUNIKEY_RELAYS: 'wss://ck.example',
      AMB_RELAYS: 'wss://amb.example,wss://oersi.example',
      CURATED_PUBKEYS_SETS_LONGFORM: 'naddr1set'
    });
    expect(sources).toEqual([
      {
        kind: 30023,
        relays: ['wss://long.example'],
        curated: { sets: ['naddr1set'], direct: [] },
        wotAnchors: []
      },
      { kind: 30818, relays: ['wss://ck.example'], curated: null, wotAnchors: [] },
      {
        kind: 30142,
        relays: ['wss://amb.example', 'wss://oersi.example'],
        curated: { sets: [], direct: [] },
        wotAnchors: []
      }
    ]);
  });

  it('lets SITEMAP_AMB_RELAYS narrow the resource relays', () => {
    const amb = sitemapSources({
      AMB_RELAYS: 'wss://amb.example,wss://oersi.example',
      SITEMAP_AMB_RELAYS: 'wss://amb.example'
    }).find((s) => s.kind === 30142);
    expect(amb?.relays).toEqual(['wss://amb.example']);
  });

  it('adds WoT anchors only when WoT is enabled', () => {
    const on = sitemapSources({ WOT_ENABLED: 'true', WOT_ANCHOR_PUBKEYS: A });
    expect(on.find((s) => s.kind === 30142)?.wotAnchors).toEqual([A]);
    const off = sitemapSources({ WOT_ANCHOR_PUBKEYS: A });
    expect(off.find((s) => s.kind === 30142)?.wotAnchors).toEqual([]);
  });
});

describe('resolveAuthors', () => {
  it('returns null (no restriction) when nothing is curated', async () => {
    expect(await resolveAuthors({ sets: [], direct: [] }, [], vi.fn())).toBeNull();
    expect(await resolveAuthors(null, [], vi.fn())).toBeNull();
  });

  it('unions set members, direct pubkeys (npub or hex) and WoT anchors', async () => {
    const set = nip19.naddrEncode({
      kind: 30000,
      pubkey: A,
      identifier: 'list',
      relays: ['wss://r.example']
    });
    const fetchFirst = vi.fn(async () => ({
      kind: 30000,
      pubkey: A,
      tags: [
        ['d', 'list'],
        ['p', B],
        ['p', 'junk']
      ]
    }));
    const authors = await resolveAuthors(
      { sets: [set], direct: [nip19.npubEncode(A)] },
      ['c'.repeat(64)],
      /** @type {any} */ (fetchFirst)
    );
    expect(authors?.sort()).toEqual([A, B, 'c'.repeat(64)].sort());
    expect(fetchFirst).toHaveBeenCalledWith(
      { kinds: [30000], authors: [A], '#d': ['list'], limit: 1 },
      expect.arrayContaining(['wss://r.example'])
    );
  });

  it('returns an empty list — never "everyone" — when curated sets cannot be resolved', async () => {
    const set = nip19.naddrEncode({ kind: 30000, pubkey: A, identifier: 'list', relays: [] });
    expect(
      await resolveAuthors(
        { sets: [set], direct: [] },
        [],
        vi.fn(async () => null)
      )
    ).toEqual([]);
  });
});

describe('buildSitemapEntries', () => {
  const hint = () => 'wss://hint.example';

  it('builds canonical URLs with lastmod, newest version per address', () => {
    const entries = buildSitemapEntries(
      [
        ev(30023, A, 'x', 1700000000),
        ev(30023, A, 'x', 1710000000),
        ev(30142, B, 'https://oer.example/1', 1720000000)
      ],
      { origin: ORIGIN, relayHintFor: hint }
    );
    expect(entries).toHaveLength(2);
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: A,
      identifier: 'x',
      relays: ['wss://hint.example']
    });
    expect(entries).toContainEqual({ loc: `${ORIGIN}/${naddr}`, lastmod: '2024-03-09' });
  });

  it('lists one /wiki/<topic> URL per topic with the latest lastmod', () => {
    const entries = buildSitemapEntries(
      [ev(30818, A, 'nostr', 1700000000), ev(30818, B, 'nostr', 1720000000)],
      { origin: ORIGIN, relayHintFor: hint }
    );
    expect(entries).toEqual([{ loc: `${ORIGIN}/wiki/nostr`, lastmod: '2024-07-03' }]);
  });

  it('skips events without a d-tag value', () => {
    const entries = buildSitemapEntries([ev(30023, A, '', 1700000000)], {
      origin: ORIGIN,
      relayHintFor: hint
    });
    expect(entries).toEqual([]);
  });
});

describe('renderSitemapXml', () => {
  it('renders an escaped urlset', () => {
    const xml = renderSitemapXml([
      { loc: 'https://a.example/wiki/a%26b?x=1&y=2', lastmod: '2024-01-01' }
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(
      '<loc>https://a.example/wiki/a%26b?x=1&amp;y=2</loc><lastmod>2024-01-01</lastmod>'
    );
  });
});

describe('createSitemapCache', () => {
  it('builds once, serves the cache, and refreshes stale entries in the background', async () => {
    let now = 0;
    let n = 0;
    const build = vi.fn(async () => `xml${++n}`);
    const cache = createSitemapCache({ ttlMs: 1000, now: () => now });

    expect(await cache.get('o', build)).toBe('xml1');
    expect(await cache.get('o', build)).toBe('xml1');
    expect(build).toHaveBeenCalledTimes(1);

    now = 2000;
    expect(await cache.get('o', build)).toBe('xml1'); // stale served at once
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    expect(await cache.get('o', build)).toBe('xml2');
  });

  it('shares one in-flight build between concurrent requests', async () => {
    const build = vi.fn(async () => 'x');
    const cache = createSitemapCache({ ttlMs: 1000, now: () => 0 });
    await Promise.all([cache.get('o', build), cache.get('o', build), cache.get('o', build)]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the last good sitemap when a refresh fails', async () => {
    let now = 0;
    const cache = createSitemapCache({ ttlMs: 1000, now: () => now });
    await cache.get('o', async () => 'good');
    now = 2000;
    const failing = vi.fn(async () => {
      throw new Error('relay down');
    });
    expect(await cache.get('o', failing)).toBe('good');
    await vi.waitFor(() => expect(failing).toHaveBeenCalled());
    expect(await cache.get('o', failing)).toBe('good');
  });
});
