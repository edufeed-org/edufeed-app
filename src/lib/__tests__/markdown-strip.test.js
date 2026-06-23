/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '$lib/helpers/markdown.js';

describe('stripMarkdown', () => {
  it('returns empty string for nullish or non-string input', () => {
    expect(stripMarkdown(undefined)).toBe('');
    expect(stripMarkdown(null)).toBe('');
    expect(stripMarkdown(/** @type {any} */ (42))).toBe('');
    expect(stripMarkdown('')).toBe('');
  });

  it('keeps link text and drops the URL', () => {
    expect(stripMarkdown('[Handout zur Veranstaltung](https://nextcloud.comenius.de/s/x)')).toBe(
      'Handout zur Veranstaltung'
    );
  });

  it('drops image markup but keeps alt text', () => {
    expect(stripMarkdown('![a cat](https://example.com/cat.png)')).toBe('a cat');
  });

  it('removes bold and italic markers', () => {
    expect(stripMarkdown('**Modul 1:** some *emphasis* and __strong__ and _em_')).toBe(
      'Modul 1: some emphasis and strong and em'
    );
  });

  it('strips heading, blockquote and list markers', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('> a quote')).toBe('a quote');
    expect(stripMarkdown('- one\n- two')).toBe('one two');
    expect(stripMarkdown('1. first\n2. second')).toBe('first second');
  });

  it('removes inline code and strikethrough markers', () => {
    expect(stripMarkdown('use `npm run dev` here')).toBe('use npm run dev here');
    expect(stripMarkdown('~~gone~~ kept')).toBe('gone kept');
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(stripMarkdown('line one\n\n\nline two   with   gaps')).toBe(
      'line one line two with gaps'
    );
  });

  it('flattens a realistic event description into clean prose', () => {
    const input =
      '[Serienformat](https://relilab.org/pilgernru/) * **Modul 1:** P**ilgern mit Kindern** > ' +
      '„Pilgern macht Glauben erfahrbar.“ [Handout zur Veranstaltung](https://nextcloud.comenius.de/s/x)';
    const out = stripMarkdown(input);
    expect(out).toContain('Serienformat');
    expect(out).toContain('Modul 1:');
    expect(out).toContain('Pilgern mit Kindern');
    expect(out).toContain('Handout zur Veranstaltung');
    expect(out).not.toContain('http');
    expect(out).not.toContain('**');
    expect(out).not.toContain('](');
  });
});
