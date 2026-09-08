/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildTulluCitation,
  getCitationOrigin,
  escapeHtml
} from '$lib/helpers/educational/citation.js';

const LICENSE = { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' };
const ORIGIN = { url: 'https://edufeed.org/naddr1abc', label: 'Edufeed' };

describe('buildTulluCitation', () => {
  it('renders all five TULLU parts as plain text with written-out URLs', () => {
    const { text } = buildTulluCitation({
      title: 'Briefe',
      creators: ['Jane Doe'],
      license: LICENSE,
      origin: ORIGIN
    });
    expect(text).toBe(
      '„Briefe“ von Jane Doe unter der Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) via Edufeed (https://edufeed.org/naddr1abc)'
    );
  });

  it('links license and origin in the HTML variant', () => {
    const { html } = buildTulluCitation({
      title: 'Briefe',
      creators: ['Jane Doe'],
      license: LICENSE,
      origin: ORIGIN
    });
    expect(html).toContain(
      '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer license">CC BY 4.0</a>'
    );
    expect(html).toContain(
      '<a href="https://edufeed.org/naddr1abc" target="_blank" rel="noopener noreferrer">Edufeed</a>'
    );
    expect(html).not.toContain('(https://');
  });

  it('names every creator exactly as given, comma separated', () => {
    const { text } = buildTulluCitation({
      title: 'T',
      creators: ['Dr. Jane Doe', 'ACME e.V.', 'nostr:npub…'],
      license: LICENSE,
      origin: ORIGIN
    });
    expect(text).toContain('von Dr. Jane Doe, ACME e.V., nostr:npub… unter');
  });

  it('escapes HTML in user-supplied values but not in the template', () => {
    const { html, text } = buildTulluCitation({
      title: '<b>Bold</b> & "quoted"',
      creators: ['A <script>'],
      license: { id: 'https://x.example/?a=1&b=2', label: 'X & Y' },
      origin: { url: 'https://o.example/?q="1"', label: 'O<' }
    });
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).toContain('href="https://o.example/?q=&quot;1&quot;"');
    // plain text is untouched
    expect(text).toContain('<b>Bold</b> & "quoted"');
  });

  it('uses the supplied locale template for both variants', () => {
    const format = (/** @type {any} */ s) =>
      `“${s.title}” by ${s.creator}, licensed under ${s.license}, via ${s.origin}`;
    const { text, html } = buildTulluCitation(
      { title: 'Letters', creators: ['Jane'], license: LICENSE, origin: ORIGIN },
      format
    );
    expect(text).toBe(
      '“Letters” by Jane, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Edufeed (https://edufeed.org/naddr1abc)'
    );
    expect(html.startsWith('“Letters” by Jane, licensed under <a ')).toBe(true);
  });

  it('collapses whitespace in the title and drops empty creator names', () => {
    const { text } = buildTulluCitation({
      title: '  Two\n lines  ',
      creators: ['', '  ', 'Jane'],
      license: LICENSE,
      origin: ORIGIN
    });
    expect(text.startsWith('„Two lines“ von Jane ')).toBe(true);
  });
});

describe('getCitationOrigin', () => {
  const app = { pageUrl: 'https://edufeed.org/naddr1abc?x=1', appName: 'Edufeed' };

  it('points at the primary external URL, labelled by its host', () => {
    const origin = getCitationOrigin(
      { primaryURL: 'https://www.example.org/material/1', identifier: 'abc' },
      app
    );
    expect(origin).toEqual({ url: 'https://www.example.org/material/1', label: 'example.org' });
  });

  it('falls back to a URL-shaped d-tag identifier', () => {
    const origin = getCitationOrigin(
      { primaryURL: null, identifier: 'https://oerf-journal.eu/article/605' },
      app
    );
    expect(origin).toEqual({
      url: 'https://oerf-journal.eu/article/605',
      label: 'oerf-journal.eu'
    });
  });

  it('falls back to the app page for Nostr-native resources', () => {
    const origin = getCitationOrigin({ primaryURL: null, identifier: 'abc' }, app);
    expect(origin).toEqual({ url: 'https://edufeed.org/naddr1abc?x=1', label: 'Edufeed' });
  });

  it('labels the app page by host when no app name is configured', () => {
    const origin = getCitationOrigin(
      { primaryURL: null, identifier: 'abc' },
      { pageUrl: 'https://dev.edufeed.org/naddr1abc', appName: '' }
    );
    expect(origin.label).toBe('dev.edufeed.org');
  });

  it('ignores malformed primary URLs', () => {
    const origin = getCitationOrigin({ primaryURL: 'not a url', identifier: 'abc' }, app);
    expect(origin.label).toBe('Edufeed');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });
});
