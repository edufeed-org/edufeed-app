/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  sitemapSources,
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

const hint = () => 'wss://hint.example';
const all = () => true;

describe('sitemapSources', () => {
  it('scans articles, wiki and learning resources on the deployment relays', () => {
    expect(
      sitemapSources({
        LONGFORM_CONTENT_RELAY: 'wss://long.example',
        COMMUNIKEY_RELAYS: 'wss://ck.example',
        AMB_RELAYS: 'wss://amb.example,wss://oersi.example'
      })
    ).toEqual([
      { kind: 30023, relays: ['wss://long.example'] },
      { kind: 30818, relays: ['wss://ck.example'] },
      { kind: 30142, relays: ['wss://amb.example', 'wss://oersi.example'] }
    ]);
  });

  it('lets SITEMAP_AMB_RELAYS narrow the resource relays', () => {
    const amb = sitemapSources({
      AMB_RELAYS: 'wss://amb.example,wss://oersi.example',
      SITEMAP_AMB_RELAYS: 'wss://amb.example'
    }).find((s) => s.kind === 30142);
    expect(amb?.relays).toEqual(['wss://amb.example']);
  });
});

describe('buildSitemapEntries', () => {
  it('builds canonical URLs with lastmod from the latest version per address', () => {
    const entries = buildSitemapEntries(
      [
        ev(30023, A, 'x', 1700000000),
        ev(30023, A, 'x', 1710000000),
        ev(30142, B, 'https://oer.example/1', 1720000000)
      ],
      { origin: ORIGIN, relayHintFor: hint, isIndexable: all }
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

  it('judges indexability on the latest version only', () => {
    const older = ev(30023, A, 'x', 1700000000, [['client', 'Edufeed']]);
    const newer = ev(30023, A, 'x', 1710000000);
    const isIndexable = (/** @type {any} */ e) =>
      e.tags.some((/** @type {string[]} */ t) => t[0] === 'client');
    expect(
      buildSitemapEntries([older, newer], { origin: ORIGIN, relayHintFor: hint, isIndexable })
    ).toEqual([]);
  });

  it('leaves out events the rule rejects', () => {
    const entries = buildSitemapEntries(
      [ev(30142, A, 'keep', 1700000000), ev(30142, A, 'drop', 1700000000)],
      { origin: ORIGIN, relayHintFor: hint, isIndexable: (e) => e.tags[0][1] === 'keep' }
    );
    expect(entries).toHaveLength(1);
  });

  it('lists one /wiki/<topic> URL per topic with the latest lastmod', () => {
    const entries = buildSitemapEntries(
      [ev(30818, A, 'nostr', 1700000000), ev(30818, B, 'nostr', 1720000000)],
      { origin: ORIGIN, relayHintFor: hint, isIndexable: all }
    );
    expect(entries).toEqual([{ loc: `${ORIGIN}/wiki/nostr`, lastmod: '2024-07-03' }]);
  });

  it('skips events without a d-tag value', () => {
    expect(
      buildSitemapEntries([ev(30023, A, '', 1700000000)], {
        origin: ORIGIN,
        relayHintFor: hint,
        isIndexable: all
      })
    ).toEqual([]);
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
  const xmlWith = (/** @type {number} */ n) =>
    renderSitemapXml(
      Array.from({ length: n }, (_, i) => ({
        loc: `https://a.example/${i}`,
        lastmod: '2024-01-01'
      }))
    );

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

  it('rejects a rebuild that lost more than half of the URLs and retries after retryMs', async () => {
    let now = 0;
    const cache = createSitemapCache({ ttlMs: 1000, now: () => now, retryMs: 100 });
    await cache.get('o', async () => xmlWith(10));

    now = 2000;
    const shrunk = vi.fn(async () => xmlWith(3));
    await cache.get('o', shrunk);
    await vi.waitFor(() => expect(shrunk).toHaveBeenCalledTimes(1));
    expect(await cache.get('o', shrunk)).toBe(xmlWith(10));
    expect(shrunk).toHaveBeenCalledTimes(1); // not retried before retryMs

    now = 2150;
    const recovered = vi.fn(async () => xmlWith(9));
    await cache.get('o', recovered);
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    expect(await cache.get('o', recovered)).toBe(xmlWith(9));
  });
});
