/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(
  () =>
    /** @type {Record<string, string | undefined>} */ ({
      APP_NAME: 'TestApp',
      AMB_RELAYS: 'wss://amb.example.com',
      LONGFORM_CONTENT_RELAY: 'wss://long.example.com',
      COMMUNIKEY_RELAYS: 'wss://ck.example.com',
      FALLBACK_RELAYS: 'wss://fallback.example.com'
    })
);
vi.mock('$env/dynamic/private', () => ({ env }));

import { buildPageEntry } from '$lib/server/og.js';
import { geoGroup, geoContentKey, DEFAULT_GEO_SALT } from '$lib/server/geo/assignment.js';

const PK = '1'.repeat(64);
const url = new URL('https://edufeed.example/naddr1abc');
const target = /** @type {const} */ ({ type: 'event', identifier: 'naddr1abc' });

/** @param {string} d */
const amb = (d) => ({
  id: '2'.repeat(64),
  kind: 30142,
  pubkey: PK,
  created_at: 1760000000,
  content: '',
  sig: '',
  tags: [
    ['d', d],
    ['name', `Ressource ${d}`],
    ['description', 'Beschreibung']
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

describe('buildPageEntry', () => {
  beforeEach(() => {
    delete env.GEO_SERVER_CONTENT_SHARE;
    delete env.GEO_ASSIGNMENT_SALT;
  });

  it('serves canonical, JSON-LD and body to every page by default', async () => {
    const entry = await buildPageEntry(amb('https://oer.example/a'), target, url);
    expect(entry.head).toContain('og:title');
    expect(entry.head).toContain('<link rel="canonical" href="https://edufeed.example/naddr1');
    expect(entry.head).toContain('application/ld+json');
    expect(entry.body).toContain('<h1>Ressource https://oer.example/a</h1>');
  });

  it('gives control-group pages only OG tags and the canonical link', async () => {
    env.GEO_SERVER_CONTENT_SHARE = '0.5';
    const entry = await buildPageEntry(amb(dIn('V')), target, url);
    expect(entry.head).toContain('<link rel="canonical"');
    expect(entry.head).not.toContain('ld+json');
    expect(entry.body).toBe('');
  });

  it('gives treatment-group pages the full content at share 0.5', async () => {
    env.GEO_SERVER_CONTENT_SHARE = '0.5';
    const entry = await buildPageEntry(amb(dIn('T')), target, url);
    expect(entry.head).toContain('ld+json');
    expect(entry.body).toContain('<article id="geo-content">');
  });

  it('uses the deployment relay as the canonical naddr hint', async () => {
    const entry = await buildPageEntry(amb('x'), target, url);
    const naddr = entry.head.match(
      /canonical" href="https:\/\/edufeed\.example\/(naddr1[a-z0-9]+)"/
    )?.[1];
    const { nip19 } = await import('nostr-tools');
    expect(/** @type {any} */ (nip19.decode(/** @type {string} */ (naddr))).data.relays).toEqual([
      'wss://amb.example.com'
    ]);
  });

  it('canonicalizes /wiki/<topic> to itself', async () => {
    env.GEO_SERVER_CONTENT_SHARE = '0';
    const wiki = {
      ...amb('x'),
      kind: 30818,
      tags: [
        ['d', 'Nostr Basics'],
        ['h', '3'.repeat(64)]
      ]
    };
    const entry = await buildPageEntry(wiki, { type: 'wiki-topic', topic: 'Nostr Basics' }, url);
    expect(entry.head).toContain('href="https://edufeed.example/wiki/Nostr%20Basics"');
  });

  it('leaves profiles and non-content kinds untouched', async () => {
    const profile = { ...amb('x'), kind: 0, tags: [], content: '{"name":"Ada"}' };
    const entry = await buildPageEntry(profile, { type: 'profile', pubkey: PK }, url);
    expect(entry.head).not.toContain('canonical');
    expect(entry.body).toBe('');

    const note = { ...amb('x'), kind: 1, tags: [], content: 'hi' };
    const noteEntry = await buildPageEntry(note, target, url);
    expect(noteEntry.head).not.toContain('canonical');
  });
});
