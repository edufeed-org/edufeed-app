/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  canonicalPathFor,
  buildCrawlableContent,
  renderHeadExtras,
  serializeJsonLd
} from '$lib/server/geo/page-content.js';

const PK = 'd'.repeat(64);
const COMMUNITY = 'e'.repeat(64);
const HINT = 'wss://relay.example.com';
const ORIGIN = 'https://edufeed.example';

/** @param {number} kind @param {string[][]} tags @param {string} [content] */
const ev = (kind, tags, content = '') => ({
  id: 'f'.repeat(64),
  kind,
  pubkey: PK,
  created_at: 1760000000, // 09.10.2025
  tags,
  content,
  sig: ''
});

const naddrOf = (/** @type {number} */ kind, /** @type {string} */ d) =>
  nip19.naddrEncode({ kind, pubkey: PK, identifier: d, relays: [HINT] });

describe('canonicalPathFor', () => {
  it('uses a deterministic naddr with the deployment relay hint', () => {
    const e = ev(30023, [['d', 'a1']]);
    expect(canonicalPathFor(e, { relayHint: HINT })).toBe(`/${naddrOf(30023, 'a1')}`);
  });

  it('follows the community route for h-tagged content', () => {
    const e = ev(30023, [
      ['d', 'a1'],
      ['h', COMMUNITY]
    ]);
    expect(canonicalPathFor(e, { relayHint: HINT })).toBe(
      `/c/${nip19.npubEncode(COMMUNITY)}/article/${naddrOf(30023, 'a1')}`
    );
  });

  it('sends wiki articles to /wiki/<topic>, also when they belong to a community', () => {
    expect(canonicalPathFor(ev(30818, [['d', 'erste schritte']]), { relayHint: HINT })).toBe(
      '/wiki/erste%20schritte'
    );
    expect(
      canonicalPathFor(
        ev(30818, [
          ['d', 'erste schritte'],
          ['h', COMMUNITY]
        ]),
        { relayHint: HINT }
      )
    ).toBe('/wiki/erste%20schritte');
  });

  it('encodes regular events as nevent', () => {
    const path = canonicalPathFor(ev(1, []), { relayHint: HINT });
    expect(path?.startsWith('/nevent1')).toBe(true);
  });
});

describe('buildCrawlableContent — article (30023)', () => {
  const article = ev(
    30023,
    [
      ['d', 'a1'],
      ['title', 'Aktivierende Methoden'],
      ['summary', 'Kurz gesagt: so geht es.'],
      ['published_at', '1700000000'],
      ['image', 'https://img.example/a.png']
    ],
    '## Einstieg\n\nText mit [Link](https://ok.example/).\n\n<script>alert(1)</script><img src=x onerror=alert(1)>'
  );

  it('renders title, byline, summary and sanitized body', async () => {
    const out = await buildCrawlableContent(article, {
      origin: ORIGIN,
      appName: 'Edufeed',
      relayHint: HINT,
      authorName: 'Ada <Lovelace>'
    });
    expect(out.bodyHtml).toContain('<h1>Aktivierende Methoden</h1>');
    expect(out.bodyHtml).toContain('Ada &lt;Lovelace&gt;');
    expect(out.bodyHtml).toContain('14.11.2023');
    expect(out.bodyHtml).toContain('Kurz gesagt: so geht es.');
    expect(out.bodyHtml).toContain('<h2>Einstieg</h2>');
    expect(out.bodyHtml).toContain('<a href="https://ok.example/" rel="nofollow ugc">Link</a>');
    expect(out.bodyHtml).not.toMatch(/<script|onerror/i);
    expect(out.bodyHtml?.startsWith('<article id="geo-content"')).toBe(true);
  });

  it('builds a schema.org Article', async () => {
    const out = await buildCrawlableContent(article, {
      origin: ORIGIN,
      appName: 'Edufeed',
      relayHint: HINT,
      authorName: 'Ada'
    });
    expect(out.jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Aktivierende Methoden',
      description: 'Kurz gesagt: so geht es.',
      datePublished: '2023-11-14T22:13:20.000Z',
      image: 'https://img.example/a.png',
      url: `${ORIGIN}/${naddrOf(30023, 'a1')}`,
      author: { '@type': 'Person', name: 'Ada', url: `${ORIGIN}/p/${nip19.npubEncode(PK)}` }
    });
    expect(out.canonicalUrl).toBe(`${ORIGIN}/${naddrOf(30023, 'a1')}`);
  });

  it('falls back to a short npub when no author name is known', async () => {
    const out = await buildCrawlableContent(article, {
      origin: ORIGIN,
      appName: 'E',
      relayHint: HINT
    });
    expect(out.bodyHtml).toContain(nip19.npubEncode(PK).slice(0, 12));
  });
});

describe('buildCrawlableContent — wiki (30818)', () => {
  it('renders djot content under the topic canonical', async () => {
    const wiki = ev(
      30818,
      [
        ['d', 'nostr'],
        ['title', 'Nostr']
      ],
      '# Was ist Nostr?\n\nEin _offenes_ Protokoll.'
    );
    const out = await buildCrawlableContent(wiki, {
      origin: ORIGIN,
      appName: 'E',
      relayHint: HINT
    });
    expect(out.canonicalUrl).toBe(`${ORIGIN}/wiki/nostr`);
    expect(out.bodyHtml).toContain('<h1>Nostr</h1>');
    expect(out.bodyHtml).toContain('<em>offenes</em>');
    expect(out.jsonLd?.['@type']).toBe('Article');
  });
});

describe('buildCrawlableContent — learning resource (30142)', () => {
  const amb = ev(30142, [
    ['d', 'https://oer.example/m1'],
    ['type', 'LearningResource'],
    ['name', 'M1 Mein Jesusbild'],
    ['description', 'Arbeitsblatt über Jesus von Nazareth.'],
    ['inLanguage', 'de'],
    ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
    ['about:id', 'nostr:39738:x:religion'],
    ['about:prefLabel:de', 'Religion'],
    ['learningResourceType:id', 'https://edufeed.org/ns/ekw#lrt/arbeitsblatt'],
    ['learningResourceType:prefLabel:de', 'Arbeitsblatt'],
    ['keywords', 'Jesus'],
    ['ext:ekw:gradeLevel:id', 'nostr:39738:x:5-6'],
    ['ext:ekw:gradeLevel:prefLabel:de', '5–6'],
    ['ext:ekw:schoolType:id', 'nostr:39738:x:gymnasium'],
    ['ext:ekw:schoolType:prefLabel:de', 'Gymnasium'],
    ['datePublished', '2025-02-25']
  ]);

  it('renders the metadata and links the original resource', async () => {
    const out = await buildCrawlableContent(amb, { origin: ORIGIN, appName: 'E', relayHint: HINT });
    expect(out.bodyHtml).toContain('<h1>M1 Mein Jesusbild</h1>');
    expect(out.bodyHtml).toContain('Arbeitsblatt über Jesus von Nazareth.');
    expect(out.bodyHtml).toContain('CC BY 4.0');
    expect(out.bodyHtml).toContain('Religion');
    expect(out.bodyHtml).toContain('Arbeitsblatt');
    expect(out.bodyHtml).toContain('Jesus');
    expect(out.bodyHtml).toContain('<dt>Sprache</dt><dd>Deutsch</dd>');
    expect(out.bodyHtml).toContain('<dt>Klassenstufe</dt><dd>5–6</dd>');
    expect(out.bodyHtml).toContain('<dt>Schulart</dt><dd>Gymnasium</dd>');
    expect(out.bodyHtml).toContain('<dt>Veröffentlicht</dt><dd>25.02.2025</dd>');
    expect(out.bodyHtml).toContain('href="https://oer.example/m1"');
  });

  it('reuses the AMB JSON-LD builder', async () => {
    const out = await buildCrawlableContent(amb, { origin: ORIGIN, appName: 'E', relayHint: HINT });
    expect(out.jsonLd?.name).toBe('M1 Mein Jesusbild');
    expect(out.jsonLd?.id).toBe('https://oer.example/m1');
  });
});

describe('buildCrawlableContent — other kinds', () => {
  it('returns a canonical but no body or JSON-LD', async () => {
    const out = await buildCrawlableContent(ev(1, [], 'hi'), {
      origin: ORIGIN,
      appName: 'E',
      relayHint: HINT
    });
    expect(out.bodyHtml).toBeNull();
    expect(out.jsonLd).toBeNull();
    expect(out.canonicalUrl.startsWith(`${ORIGIN}/nevent1`)).toBe(true);
  });
});

describe('head extras', () => {
  it('escapes the canonical and keeps JSON-LD from breaking out of its script', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>', x: '\u2028' });
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('\u2028');
    expect(JSON.parse(json).name).toBe('</script><script>alert(1)</script>');

    const head = renderHeadExtras({ canonicalUrl: 'https://a.example/x?"', jsonLd: { a: 1 } });
    expect(head).toContain('<link rel="canonical" href="https://a.example/x?&quot;" />');
    expect(head).toContain('<script type="application/ld+json" id="geo-jsonld">{"a":1}</script>');
  });

  it('omits JSON-LD when there is none', () => {
    expect(renderHeadExtras({ canonicalUrl: 'https://a.example/', jsonLd: null })).not.toContain(
      'ld+json'
    );
  });
});
