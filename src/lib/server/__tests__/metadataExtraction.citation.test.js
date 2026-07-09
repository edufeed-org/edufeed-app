/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { extractMetadataFromHtml } from '$lib/server/metadataExtraction.js';

/** Minimal OJS-style article page (mirrors oerf-journal.eu head structure). */
const OJS_HTML = `<!DOCTYPE html><html><head>
<meta name="citation_journal_title" content="Österreichisches Religionspädagogisches Forum"/>
<meta name="citation_issn" content="1018-1539"/>
<meta name="citation_author" content="Lars Wosnitza"/>
<meta name="citation_author_institution" content="Universität Bonn"/>
<meta name="citation_author" content="Ada Zweite"/>
<meta name="citation_title" content="Religionsunterricht als Studium der Religion(en)"/>
<meta name="citation_language" content="de"/>
<meta name="citation_date" content="2026/05/18"/>
<meta name="citation_doi" content="10.25364/10.34:2026.1.2"/>
<meta name="citation_keywords" xml:lang="de" content="Forschendes Lernen "/>
<meta name="citation_keywords" xml:lang="de" content="Kompetenzorientierung"/>
<meta name="citation_pdf_url" content="https://oerf-journal.eu/index.php/oerf/article/download/569/493"/>
<meta name="DC.Description" content="Der Beitrag profiliert Forschendes Lernen."/>
<meta property="og:title" content="OG Title"/>
<meta property="og:description" content="OG description"/>
</head><body></body></html>`;

describe('extractMetadataFromHtml — citation meta (Highwire/OJS)', () => {
  it('extracts citation metadata alongside the opengraph source', () => {
    const result = extractMetadataFromHtml(OJS_HTML);
    expect(result.source).toBe('opengraph'); // existing discrimination unchanged
    expect(result.og?.title).toBe('OG Title');
    expect(result.citation).toEqual({
      title: 'Religionsunterricht als Studium der Religion(en)',
      authors: [{ name: 'Lars Wosnitza', institution: 'Universität Bonn' }, { name: 'Ada Zweite' }],
      doi: '10.25364/10.34:2026.1.2',
      date: '2026-05-18',
      journal: 'Österreichisches Religionspädagogisches Forum',
      language: 'de',
      keywords: ['Forschendes Lernen', 'Kompetenzorientierung'],
      abstract: 'Der Beitrag profiliert Forschendes Lernen.',
      pdfUrl: 'https://oerf-journal.eu/index.php/oerf/article/download/569/493'
    });
  });

  it('returns citation even when neither AMB JSON-LD nor OG exist', () => {
    const html = `<html><head>
      <meta name="citation_title" content="Solo"/>
      <meta name="citation_author" content="A"/>
    </head><body></body></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('none');
    expect(result.citation?.title).toBe('Solo');
    expect(result.citation?.authors).toEqual([{ name: 'A' }]);
  });

  it('omits citation entirely when no citation tags exist (regression guard)', () => {
    const html = `<html><head><meta property="og:title" content="T"/></head><body></body></html>`;
    const result = extractMetadataFromHtml(html);
    expect(result.source).toBe('opengraph');
    expect(result.citation).toBeUndefined();
  });

  it('accepts citation_publication_date and ISO dates', () => {
    const html = `<html><head>
      <meta name="citation_title" content="T"/>
      <meta name="citation_publication_date" content="2025-01-02"/>
    </head></html>`;
    expect(extractMetadataFromHtml(html).citation?.date).toBe('2025-01-02');
  });
});
