/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { extractMetadataFromHtml } from '$lib/server/metadataExtraction.js';

const ambJsonLd = {
  '@context': 'https://w3id.org/kim/amb/context.jsonld',
  '@type': ['LearningResource', 'CreativeWork'],
  id: 'https://example.org/lesson/42',
  name: 'Photosynthesis',
  description: 'A short lesson about photosynthesis',
  inLanguage: ['de'],
  learningResourceType: [
    { id: 'https://w3id.org/kim/hcrt/text', prefLabel: { de: 'Text', en: 'Text' } }
  ]
};

/** @param {any} amb */
function htmlWithAmb(amb) {
  return `<!doctype html><html><head>
    <meta property="og:title" content="OG title (should be ignored when AMB is present)" />
    <script type="application/ld+json">${JSON.stringify(amb)}</script>
  </head><body></body></html>`;
}

function htmlWithOg() {
  return `<!doctype html><html><head>
    <meta property="og:title" content="A page title" />
    <meta property="og:description" content="A page description" />
    <meta property="og:image" content="https://example.org/img.png" />
    <meta property="og:site_name" content="Example" />
    <meta property="og:locale" content="de_DE" />
  </head><body></body></html>`;
}

describe('extractMetadataFromHtml', () => {
  it('returns source=amb-jsonld when an AMB JSON-LD script is present', () => {
    const result = extractMetadataFromHtml(htmlWithAmb(ambJsonLd));
    expect(result.source).toBe('amb-jsonld');
    expect(result.amb).toEqual(ambJsonLd);
    expect(result.og).toBeUndefined();
  });

  it('AMB takes precedence over OG when both are present', () => {
    const result = extractMetadataFromHtml(htmlWithAmb(ambJsonLd));
    expect(result.source).toBe('amb-jsonld');
  });

  it('skips ld+json blocks that are not AMB', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: 'Ada'
      })}</script>
      <meta property="og:title" content="Ada's page" />
    </head></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('opengraph');
    expect(result.og?.title).toBe("Ada's page");
  });

  it('finds AMB inside an array-typed ld+json block', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify([
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Example' },
        ambJsonLd
      ])}</script>
    </head></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('amb-jsonld');
    expect(result.amb).toEqual(ambJsonLd);
  });

  it('returns source=opengraph when only OG tags are present', () => {
    const result = extractMetadataFromHtml(htmlWithOg());
    expect(result.source).toBe('opengraph');
    expect(result.og).toEqual({
      title: 'A page title',
      description: 'A page description',
      image: 'https://example.org/img.png',
      siteName: 'Example',
      locale: 'de_DE'
    });
    expect(result.amb).toBeUndefined();
  });

  it('falls back to twitter:* meta tags when og:* are missing', () => {
    const html = `<!doctype html><html><head>
      <meta name="twitter:title" content="Twitter title" />
      <meta name="twitter:description" content="Twitter description" />
      <meta name="twitter:image" content="https://example.org/t.png" />
    </head></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('opengraph');
    expect(result.og?.title).toBe('Twitter title');
    expect(result.og?.description).toBe('Twitter description');
    expect(result.og?.image).toBe('https://example.org/t.png');
  });

  it('og:* takes precedence over twitter:* when both are present', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="OG wins" />
      <meta name="twitter:title" content="Twitter loses" />
    </head></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.og?.title).toBe('OG wins');
  });

  it('returns source=none for plain HTML with no metadata', () => {
    const result = extractMetadataFromHtml(
      '<!doctype html><html><head></head><body>hi</body></html>'
    );
    expect(result.source).toBe('none');
    expect(result.amb).toBeUndefined();
    expect(result.og).toBeUndefined();
  });

  it('tolerates malformed JSON in ld+json blocks (skips them)', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ this is not json }</script>
      <meta property="og:title" content="OG fallback" />
    </head></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('opengraph');
    expect(result.og?.title).toBe('OG fallback');
  });
});
