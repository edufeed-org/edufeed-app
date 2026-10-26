/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env = vi.hoisted(
  () =>
    /** @type {Record<string, string | undefined>} */ ({
      APP_NAME: 'TestApp',
      CLIENT_NAME: 'Edufeed',
      AMB_RELAYS: 'wss://amb.example.com',
      LONGFORM_CONTENT_RELAY: 'wss://long.example.com',
      COMMUNIKEY_RELAYS: 'wss://ck.example.com',
      FALLBACK_RELAYS: 'wss://fallback.example.com'
    })
);
vi.mock('$env/dynamic/private', () => ({ env }));

import { buildPageEntry, ogMetaHandle, ogCache } from '$lib/server/og.js';
import { geoGroup, geoContentKey, DEFAULT_GEO_SALT } from '$lib/server/geo/assignment.js';

const PK = '1'.repeat(64);
const CURATED = '9'.repeat(64);
const url = new URL('https://edufeed.example/naddr1abc');
const target = /** @type {const} */ ({ type: 'event', identifier: 'naddr1abc' });

/** Dependencies of a page whose author is curated and whose event is on our relays. */
const ok = {
  getCurated: async () => new Set([CURATED]),
  onOwnRelays: async () => true,
  mirrorOf: async () => null
};

/** @param {string} d @param {string[][]} [extra] */
const amb = (d, extra = [['client', 'Edufeed']]) => ({
  id: '2'.repeat(64),
  kind: 30142,
  pubkey: PK,
  created_at: 1760000000,
  content: '',
  sig: '',
  tags: [
    ['d', d],
    ['name', `Ressource ${d}`],
    ['description', 'Beschreibung einer Lernressource für den Religionsunterricht.'],
    ...extra
  ]
});

/** First d-tag whose key falls in the wanted group at share 0.5. */
function dIn(/** @type {'T' | 'V'} */ group) {
  for (let i = 0; i < 100; i++) {
    const d = `https://oer.example/${i}`;
    if (geoGroup(geoContentKey(amb(d)), 0.5, DEFAULT_GEO_SALT) === group) return d;
  }
  throw new Error('no key found');
}

describe('buildPageEntry — indexable content', () => {
  beforeEach(() => {
    delete env.GEO_SERVER_CONTENT_SHARE;
    delete env.GEO_ASSIGNMENT_SALT;
  });

  it('serves canonical, JSON-LD and body by default', async () => {
    const entry = await buildPageEntry(amb('https://oer.example/a'), target, url, ok);
    expect(entry.noindex).toBe(false);
    expect(entry.head).toContain('og:title');
    expect(entry.head).toContain('<link rel="canonical" href="https://edufeed.example/naddr1');
    expect(entry.head).toContain('application/ld+json');
    expect(entry.body).toContain('<h1>Ressource https://oer.example/a</h1>');
  });

  it('gives control-group pages only OG tags and the canonical link', async () => {
    env.GEO_SERVER_CONTENT_SHARE = '0.5';
    const entry = await buildPageEntry(amb(dIn('V')), target, url, ok);
    expect(entry.head).toContain('<link rel="canonical"');
    expect(entry.head).not.toContain('ld+json');
    expect(entry.body).toBe('');
    expect(entry.noindex).toBe(false);
  });

  it('gives treatment-group pages the full content at share 0.5', async () => {
    env.GEO_SERVER_CONTENT_SHARE = '0.5';
    const entry = await buildPageEntry(amb(dIn('T')), target, url, ok);
    expect(entry.head).toContain('ld+json');
    expect(entry.body).toContain('<article id="geo-content">');
  });

  it('indexes curated authors without a client tag', async () => {
    const entry = await buildPageEntry({ ...amb('x', []), pubkey: CURATED }, target, url, ok);
    expect(entry.noindex).toBe(false);
  });

  it('uses the deployment relay as the canonical naddr hint', async () => {
    const entry = await buildPageEntry(amb('x'), target, url, ok);
    const naddr = entry.head.match(
      /canonical" href="https:\/\/edufeed\.example\/(naddr1[a-z0-9]+)"/
    )?.[1];
    const { nip19 } = await import('nostr-tools');
    expect(/** @type {any} */ (nip19.decode(/** @type {string} */ (naddr))).data.relays).toEqual([
      'wss://amb.example.com'
    ]);
  });

  it('canonicalizes /wiki/<topic> to itself', async () => {
    const wiki = {
      ...amb('x'),
      kind: 30818,
      content: Array.from({ length: 200 }, () => 'wort').join(' '),
      tags: [
        ['d', 'Nostr Basics'],
        ['client', 'Edufeed']
      ]
    };
    env.GEO_SERVER_CONTENT_SHARE = '0';
    const entry = await buildPageEntry(
      wiki,
      { type: 'wiki-topic', topic: 'Nostr Basics' },
      url,
      ok
    );
    expect(entry.head).toContain('href="https://edufeed.example/wiki/Nostr%20Basics"');
  });
});

describe('buildPageEntry — not indexable', () => {
  it('marks bulk-imported metadata (no client tag, not curated) noindex, without body or canonical', async () => {
    const entry = await buildPageEntry(amb('https://oer.example/import', []), target, url, ok);
    expect(entry.noindex).toBe(true);
    expect(entry.body).toBe('');
    expect(entry.head).not.toContain('canonical');
    expect(entry.head).toContain('og:title');
  });

  it('treats an unanswered own-relay check as provisional, not as noindex', async () => {
    const entry = await buildPageEntry(amb('x'), target, url, {
      ...ok,
      onOwnRelays: async () => null
    });
    expect(entry).toMatchObject({ noindex: false, provisional: true, body: '' });
    expect(entry.head).not.toContain('canonical');
  });

  it('marks content missing from our own relays noindex (forged client tag)', async () => {
    const entry = await buildPageEntry(amb('x'), target, url, {
      ...ok,
      onOwnRelays: async () => false
    });
    expect(entry.noindex).toBe(true);
  });

  it('marks other kinds and profiles noindex, leaves community pages alone', async () => {
    const note = { ...amb('x'), kind: 1, tags: [['client', 'Edufeed']], content: 'hi' };
    expect((await buildPageEntry(note, target, url, ok)).noindex).toBe(true);
    const profile = { ...amb('x'), kind: 0, tags: [], content: '{"name":"Ada"}' };
    expect((await buildPageEntry(profile, { type: 'profile', pubkey: PK }, url, ok)).noindex).toBe(
      true
    );
    expect(
      (await buildPageEntry(profile, { type: 'community', pubkey: PK }, url, ok)).noindex
    ).toBe(false);
  });

  it('is provisional while curation is still unknown', async () => {
    const entry = await buildPageEntry(amb('x', []), target, url, {
      ...ok,
      getCurated: async () => null
    });
    // Unknown ≠ "not indexable": no noindex for a verdict we couldn't reach.
    expect(entry).toMatchObject({ noindex: false, provisional: true, body: '' });
    expect(entry.head).not.toContain('canonical');
  });
});

describe('ogMetaHandle robots meta', () => {
  /** @param {string} path */
  async function run(path) {
    /** @type {any} */
    const captured = {};
    const event = { url: new URL(`https://app.example.com${path}`) };
    const resolve = vi.fn((_e, opts) => {
      captured.html = opts.transformPageChunk({ html: '<html><head></head><body></body></html>' });
      return new Response(captured.html);
    });
    await ogMetaHandle(/** @type {any} */ ({ event, resolve }));
    return captured.html;
  }

  it('adds noindex to app functions and discover variants, not to entry pages', async () => {
    expect(await run('/settings')).toContain('<meta name="robots" content="noindex" />');
    expect(await run('/discover?q=x')).toContain('noindex');
    expect(await run('/discover')).not.toContain('noindex');
    expect(await run('/')).not.toContain('noindex');
  });

  it('adds noindex for unresolvable content and noindex entries', async () => {
    ogCache.clear();
    ogCache.set('wiki:gone', { head: '', body: '', noindex: true }, 60000);
    expect(await run('/wiki/gone')).toContain('noindex');
    ogCache.set(
      'wiki:ok',
      { head: '<meta property="og:title" content="W" />', body: '', noindex: false },
      60000
    );
    expect(await run('/wiki/ok')).not.toContain('noindex');
  });
});

describe('SEARCH_INDEXING=false', () => {
  beforeEach(() => {
    env.SEARCH_INDEXING = 'false';
  });
  afterEach(() => {
    delete env.SEARCH_INDEXING;
  });

  it('marks even indexable content noindex, without body, JSON-LD or canonical', async () => {
    const entry = await buildPageEntry(amb('https://oer.example/a'), target, url, ok);
    expect(entry.noindex).toBe(true);
    expect(entry.body).toBe('');
    expect(entry.head).not.toContain('canonical');
    expect(entry.head).not.toContain('ld+json');
    expect(entry.head).toContain('og:title'); // link previews keep working
  });

  it('adds noindex to every page, also the home page', async () => {
    /** @type {any} */
    const captured = {};
    const event = { url: new URL('https://dev.example/') };
    const resolve = vi.fn((_e, opts) => {
      captured.html = opts.transformPageChunk({ html: '<html><head></head><body></body></html>' });
      return new Response(captured.html);
    });
    await ogMetaHandle(/** @type {any} */ ({ event, resolve }));
    expect(captured.html).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('ogMetaHandle — relay trouble', () => {
  it('serves no noindex for a provisional (transient) entry', async () => {
    ogCache.clear();
    ogCache.set('wiki:slow', { head: '', body: '', noindex: false, provisional: true }, 60000);
    /** @type {any} */
    const captured = {};
    const event = { url: new URL('https://app.example.com/wiki/slow') };
    const resolve = vi.fn((_e, opts) => {
      captured.html = opts.transformPageChunk({ html: '<html><head></head><body></body></html>' });
      return new Response(captured.html);
    });
    await ogMetaHandle(/** @type {any} */ ({ event, resolve }));
    expect(captured.html).not.toContain('noindex');
    expect(captured.html).toContain('og:title'); // default tags
  });
});

describe('buildPageEntry — mirrors of partner content', () => {
  it('gives a mirror noindex and no body or canonical', async () => {
    const entry = await buildPageEntry(amb('https://oer.example/a'), target, url, {
      ...ok,
      mirrorOf: async () => 'https://oer.example/a'
    });
    expect(entry.noindex).toBe(true);
    expect(entry.body).toBe('');
    expect(entry.head).not.toContain('rel="canonical"');
    expect(entry.head).toContain('og:title');
  });

  it('is provisional (no noindex) when the partner site did not answer', async () => {
    const entry = await buildPageEntry(amb('x'), target, url, {
      ...ok,
      mirrorOf: async () => undefined
    });
    expect(entry).toMatchObject({ noindex: false, provisional: true, body: '' });
  });

  it('does not check for mirrors when the rule already rejects the event', async () => {
    const mirrorOf = vi.fn(async () => null);
    const entry = await buildPageEntry(amb('x', []), target, url, { ...ok, mirrorOf });
    expect(entry.noindex).toBe(true);
    expect(mirrorOf).not.toHaveBeenCalled();
  });

  it('treats a learning resource with an external URL d-tag as a mirror by default', async () => {
    const { onOwnRelays, getCurated } = ok;
    const entry = await buildPageEntry(amb('https://partner.example/m.pdf'), target, url, {
      onOwnRelays,
      getCurated
    });
    expect(entry.noindex).toBe(true);
  });
});
