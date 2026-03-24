/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(),
  getMeta: vi.fn()
}));

import { extractPdfContent, isPdfResponse } from '$lib/helpers/pdfExtractor.js';
import { getDocumentProxy, getMeta } from 'unpdf';

// Helper to create a TextItem
function makeItem(str, { height = 12, fontName = 'Times', x = 0, y = 700 } = {}) {
  return { str, height, fontName, transform: [height, 0, 0, height, x, y], hasEOL: false };
}

// Helper to create a mock PDF with pages of items
function mockPdf(pages, { styles = {}, meta = {} } = {}) {
  const defaultStyles = { Times: { fontFamily: 'Times' }, ...styles };
  const pdfProxy = {
    numPages: pages.length,
    getPage: vi.fn((pageNum) =>
      Promise.resolve({
        getTextContent: () => Promise.resolve({ items: pages[pageNum - 1], styles: defaultStyles })
      })
    )
  };
  getDocumentProxy.mockResolvedValue(pdfProxy);
  getMeta.mockResolvedValue({ info: meta.info || {}, metadata: meta.metadata || {} });
}

describe('isPdfResponse', () => {
  it('detects PDF from Content-Type header', () => {
    const headers = new Headers({ 'Content-Type': 'application/pdf' });
    expect(isPdfResponse(headers, 'https://example.com/file')).toBe(true);
  });

  it('detects PDF from Content-Type with charset', () => {
    const headers = new Headers({ 'Content-Type': 'application/pdf; charset=utf-8' });
    expect(isPdfResponse(headers, 'https://example.com/file')).toBe(true);
  });

  it('detects PDF from .pdf URL extension', () => {
    const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
    expect(isPdfResponse(headers, 'https://example.com/paper.pdf')).toBe(true);
  });

  it('detects PDF from .pdf URL with query params', () => {
    const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
    expect(isPdfResponse(headers, 'https://example.com/paper.pdf?dl=1')).toBe(true);
  });

  it('returns false for HTML content', () => {
    const headers = new Headers({ 'Content-Type': 'text/html' });
    expect(isPdfResponse(headers, 'https://example.com/page.html')).toBe(false);
  });

  it('returns false for non-PDF URL without PDF content type', () => {
    const headers = new Headers({ 'Content-Type': 'text/plain' });
    expect(isPdfResponse(headers, 'https://example.com/readme.txt')).toBe(false);
  });
});

describe('extractPdfContent', () => {
  it('extracts text and wraps paragraphs in <p> tags', async () => {
    mockPdf([
      [makeItem('First paragraph.', { y: 700 }), makeItem('Second paragraph.', { y: 660 })]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<p>');
    expect(result.textContent).toContain('First paragraph.');
    expect(result.textContent).toContain('Second paragraph.');
  });

  it('separates pages with <hr>', async () => {
    mockPdf([
      [makeItem('Page one content.', { y: 700 })],
      [makeItem('Page two content.', { y: 700 })]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('Page one content.');
    expect(result.content).toContain('<hr>');
    expect(result.content).toContain('Page two content.');
  });

  it('extracts title from PDF info metadata', async () => {
    mockPdf([[makeItem('Some body text here.', { y: 700 })]], {
      meta: { info: { Title: 'My PDF Title', Author: 'Jane Doe' } }
    });

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.title).toBe('My PDF Title');
    expect(result.byline).toBe('Jane Doe');
  });

  it('falls back to first text line when no metadata title', async () => {
    mockPdf([
      [
        makeItem('Introduction to Machine Learning', { y: 700 }),
        makeItem('This paper explores...', { y: 660 })
      ]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.title).toBe('Introduction to Machine Learning');
  });

  it('returns empty textContent for image-only PDFs', async () => {
    mockPdf([[makeItem('', { y: 700 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.textContent).toBe('');
    expect(result.content).toBe('');
  });

  it('escapes HTML in extracted text', async () => {
    mockPdf([[makeItem('x < y & z > w', { y: 700 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('&lt;');
    expect(result.content).toContain('&amp;');
    expect(result.content).toContain('&gt;');
    expect(result.content).not.toContain('<script');
  });

  // --- New semantic HTML tests ---

  it('detects headings from larger font size → <h2>', async () => {
    // Body text at height 12, heading at height 24 (> 1.8x)
    mockPdf([
      [
        makeItem('Big Heading', { height: 24, y: 750 }),
        makeItem('Body text that is longer than the heading for body detection.', {
          height: 12,
          y: 700
        })
      ]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<h2>Big Heading</h2>');
  });

  it('detects headings from larger font size → <h3>', async () => {
    // Body text at height 12, heading at height 16 (> 1.2x but < 1.8x)
    mockPdf([
      [
        makeItem('Sub Heading', { height: 16, y: 750 }),
        makeItem('Body text that is longer than the heading for body detection purposes.', {
          height: 12,
          y: 700
        })
      ]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<h3>Sub Heading</h3>');
  });

  it('detects bold text → <strong>', async () => {
    const boldFont = 'TimesNewRoman-Bold';
    mockPdf(
      [
        [
          makeItem('Normal text ', { fontName: 'Times', y: 700, x: 0 }),
          makeItem('bold text', { fontName: boldFont, y: 700, x: 100 }),
          makeItem(' more normal.', { fontName: 'Times', y: 700, x: 200 })
        ]
      ],
      {
        styles: {
          Times: { fontFamily: 'Times' },
          [boldFont]: { fontFamily: 'TimesNewRoman-Bold' }
        }
      }
    );

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<strong>bold text</strong>');
  });

  it('detects italic text → <em>', async () => {
    const italicFont = 'Times-Italic';
    mockPdf(
      [
        [
          makeItem('Normal ', { fontName: 'Times', y: 700, x: 0 }),
          makeItem('italic text', { fontName: italicFont, y: 700, x: 80 })
        ]
      ],
      {
        styles: {
          Times: { fontFamily: 'Times' },
          [italicFont]: { fontFamily: 'Times-Italic' }
        }
      }
    );

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<em>italic text</em>');
  });

  it('detects unordered lists → <ul><li>', async () => {
    mockPdf([[makeItem('• First item', { y: 700 }), makeItem('• Second item', { y: 685 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<ul>');
    expect(result.content).toContain('<li>First item</li>');
    expect(result.content).toContain('<li>Second item</li>');
    expect(result.content).toContain('</ul>');
  });

  it('detects ordered lists → <ol><li>', async () => {
    mockPdf([[makeItem('1. First step', { y: 700 }), makeItem('2. Second step', { y: 685 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<ol>');
    expect(result.content).toContain('<li>First step</li>');
    expect(result.content).toContain('<li>Second step</li>');
    expect(result.content).toContain('</ol>');
  });

  it('groups closely-spaced lines into single <p>', async () => {
    // Lines 15px apart (gap/bodyHeight = 1.25, < 1.8 threshold) → same paragraph
    mockPdf([
      [
        makeItem('Line one of a paragraph that', { y: 700 }),
        makeItem('continues on a second line.', { y: 685 })
      ]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    // Should be one <p> containing both lines
    const pMatches = result.content.match(/<p>/g);
    expect(pMatches).toHaveLength(1);
    expect(result.content).toContain('Line one of a paragraph that');
    expect(result.content).toContain('continues on a second line.');
  });

  it('splits paragraphs on large Y gaps', async () => {
    // Lines 30px apart (gap/bodyHeight = 2.5, > 1.8 threshold) → separate paragraphs
    mockPdf([
      [makeItem('First paragraph.', { y: 700 }), makeItem('Second paragraph.', { y: 670 })]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    const pMatches = result.content.match(/<p>/g);
    expect(pMatches).toHaveLength(2);
  });

  it('rejoins hyphenated words across line breaks', async () => {
    mockPdf([
      [makeItem('Selbstwirksam-', { y: 700 }), makeItem('keit im Unterricht.', { y: 685 })]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('Selbstwirksamkeit im Unterricht.');
    expect(result.textContent).toContain('Selbstwirksamkeit im Unterricht.');
  });

  it('preserves hyphens when next line starts with uppercase', async () => {
    mockPdf([[makeItem('Kinder-', { y: 700 }), makeItem('Forscherzentrum ist toll.', { y: 685 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('Kinder- Forscherzentrum');
    expect(result.textContent).toContain('Kinder- Forscherzentrum');
  });

  it('handles list item continuation on indented lines', async () => {
    mockPdf([
      [
        makeItem('• A list item that', { y: 700, x: 50 }),
        makeItem('continues on the next line', { y: 688, x: 65 })
      ]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('<ul>');
    // Should be a single list item
    const liMatches = result.content.match(/<li>/g);
    expect(liMatches).toHaveLength(1);
  });

  it('detects and removes repeated page headers', async () => {
    // 4 pages, each with same header text at top but distinct body text
    const bodyTexts = [
      'The fundamentals of quantum computing explained clearly.',
      'Advanced algorithms for optimization in machine learning.',
      'Practical applications of neural networks in healthcare.',
      'Future directions and open research questions remain.'
    ];
    const pages = [];
    for (let i = 0; i < 4; i++) {
      pages.push([
        makeItem('Recurring Header Text', { y: 780 }),
        makeItem(bodyTexts[i], { y: 700 })
      ]);
    }
    mockPdf(pages);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).not.toContain('Recurring Header Text');
    expect(result.content).toContain(bodyTexts[0]);
    expect(result.content).toContain(bodyTexts[3]);
  });

  it('detects and removes repeated page footers with page numbers', async () => {
    // Footer text varies only by page number: "Document Title 1", "Document Title 2", etc.
    const bodyTexts = [
      'Introduction to the research methodology used in this study.',
      'The participants were selected from various demographic groups.',
      'Results showed a significant correlation between the variables.',
      'Discussion of findings in the context of previous literature.',
      'Conclusions and recommendations for future research directions.'
    ];
    const pages = [];
    for (let i = 0; i < 5; i++) {
      pages.push([
        makeItem(bodyTexts[i], { y: 700 }),
        makeItem('Document Title ' + (i + 1), { y: 50 })
      ]);
    }
    mockPdf(pages);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).not.toContain('Document Title');
    expect(result.content).toContain(bodyTexts[0]);
    expect(result.content).toContain(bodyTexts[4]);
  });

  it('preserves headers that only appear once', async () => {
    mockPdf([
      [makeItem('Unique Title', { y: 780 }), makeItem('Body text.', { y: 700 })],
      [makeItem('Different Title', { y: 780 }), makeItem('More body.', { y: 700 })],
      [makeItem('Another Title', { y: 780 }), makeItem('Even more body.', { y: 700 })]
    ]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('Unique Title');
    expect(result.content).toContain('Different Title');
    expect(result.content).toContain('Another Title');
  });

  it('preserves content on single-page PDFs', async () => {
    mockPdf([[makeItem('Only Header', { y: 780 }), makeItem('Body content.', { y: 700 })]]);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).toContain('Only Header');
    expect(result.content).toContain('Body content.');
  });

  it('removes headers/footers from both HTML and plain text', async () => {
    const bodyTexts = [
      'Alpha content with unique text for first page.',
      'Beta discussion exploring different aspects of the topic.',
      'Gamma analysis of the collected experimental data.',
      'Delta summary wrapping up all findings from the study.'
    ];
    const pages = [];
    for (let i = 0; i < 4; i++) {
      pages.push([
        makeItem(i + 1 + ' Repeated Header', { y: 780 }),
        makeItem(bodyTexts[i], { y: 700 })
      ]);
    }
    mockPdf(pages);

    const result = await extractPdfContent(new ArrayBuffer(8));

    expect(result.content).not.toContain('Repeated Header');
    expect(result.textContent).not.toContain('Repeated Header');
    expect(result.textContent).toContain(bodyTexts[0]);
  });
});
