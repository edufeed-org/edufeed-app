import { getDocumentProxy, getMeta } from 'unpdf';

/**
 * Detect if a fetch response is a PDF.
 * @param {Headers} headers - Response headers
 * @param {string} url - The fetched URL
 * @returns {boolean}
 */
export function isPdfResponse(headers, url) {
  const contentType = headers.get('Content-Type') || '';
  if (contentType.includes('application/pdf')) return true;

  try {
    const pathname = new URL(url).pathname;
    return pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

/**
 * Extract text content from a PDF buffer and convert to semantic HTML.
 * Uses pdf.js page.getTextContent() for font size/name data to detect
 * headings, lists, bold, and italic formatting.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ title: string, content: string, textContent: string, byline: string | null, siteName: string | null }>}
 */
export async function extractPdfContent(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const meta = await getMeta(pdf);

  // Phase 1: Extract raw text items per page
  const allPageData = [];
  /** @type {TextItem[]} */
  const allItems = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { items, styles } = await page.getTextContent();
    const textItems = /** @type {TextItem[]} */ (
      items.filter((item) => 'str' in item && typeof item.str === 'string')
    );
    allPageData.push({ items: textItems, styles });
    allItems.push(...textItems);
  }

  if (allItems.every((item) => !item.str.trim())) {
    return { title: '', content: '', textContent: '', byline: null, siteName: null };
  }

  // Phase 2: Compute body font size
  const bodyHeight = computeBodyHeight(allItems);

  // Phase 3: Classify fonts
  const fontClassification = new Map();
  for (const { styles } of allPageData) {
    for (const [fontName, style] of Object.entries(styles)) {
      if (!fontClassification.has(fontName)) {
        fontClassification.set(fontName, classifyFont(fontName, style));
      }
    }
  }

  // Phase 3b: Detect repeated page headers/footers
  const headerFooterPatterns = detectHeaderFooterPatterns(allPageData, bodyHeight);

  // Phase 4-7: Process each page
  const pageHtmls = [];
  const pageTexts = [];

  for (const { items } of allPageData) {
    const lines = groupItemsIntoLines(items, bodyHeight);
    if (lines.length === 0) continue;

    const filteredLines = filterHeaderFooterLines(lines, headerFooterPatterns);
    if (filteredLines.length === 0) continue;

    const classifiedLines = filteredLines.map((line) => classifyLine(line, bodyHeight));
    const blocks = groupLinesIntoBlocks(classifiedLines, bodyHeight);
    const html = renderBlocksToHtml(blocks, fontClassification);
    const text = buildPlainText(filteredLines, bodyHeight);

    if (html.trim()) pageHtmls.push(html);
    if (text.trim()) pageTexts.push(text.trim());
  }

  const content = pageHtmls.join('\n<hr>\n');
  const textContent = pageTexts.join('\n\n');

  // Title from metadata or first text line
  const metaTitle = meta?.info?.Title || meta?.metadata?.Title;
  const firstLine =
    textContent
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() || '';
  const title = metaTitle || firstLine;
  const byline = meta?.info?.Author || meta?.metadata?.Author || null;

  return { title, content, textContent, byline, siteName: null };
}

/**
 * @typedef {{ str: string, transform: number[], height: number, fontName: string, hasEOL?: boolean }} TextItem
 * @typedef {{ fontFamily: string, ascent?: number, descent?: number }} FontStyle
 * @typedef {{ items: TextItem[], y: number }} Line
 * @typedef {{ type: 'heading' | 'bullet-list' | 'number-list' | 'body', line: Line, headingLevel?: number }} ClassifiedLine
 * @typedef {{ type: 'heading' | 'paragraph' | 'ul' | 'ol', lines: ClassifiedLine[], headingLevel?: number }} Block
 */

/**
 * Normalize a line's text for header/footer comparison.
 * Strips leading/trailing digits and whitespace so "12 Title" and "Title 13" both become "Title".
 * @param {string} text
 * @returns {string}
 */
function normalizeEdgeText(text) {
  return text
    .replace(/^\s*\d+\s*/, '')
    .replace(/\s*\d+\s*$/, '')
    .trim();
}

/**
 * Detect repeated header/footer text patterns across pages.
 * @param {{ items: TextItem[], styles: object }[]} allPageData
 * @param {number} bodyHeight
 * @returns {Set<string>} Normalized patterns that appear on ≥40% of pages (min 3 pages)
 */
function detectHeaderFooterPatterns(allPageData, bodyHeight) {
  if (allPageData.length < 3) return new Set();

  /** @type {Map<string, number>} */
  const freq = new Map();
  const threshold = Math.max(3, Math.ceil(allPageData.length * 0.4));

  for (const { items } of allPageData) {
    const lines = groupItemsIntoLines(items, bodyHeight);
    if (lines.length < 2) continue;

    // Collect edge lines: first and last line on the page
    const edgeLines = new Set();
    edgeLines.add(lines[0]);
    edgeLines.add(lines[lines.length - 1]);

    // Deduplicate per page
    const seen = new Set();
    for (const line of edgeLines) {
      const text = line.items.map((i) => i.str).join('');
      const normalized = normalizeEdgeText(text);
      if (normalized.length < 3 || seen.has(normalized)) continue;
      seen.add(normalized);
      freq.set(normalized, (freq.get(normalized) || 0) + 1);
    }
  }

  const patterns = new Set();
  for (const [text, count] of freq) {
    if (count >= threshold) patterns.add(text);
  }
  return patterns;
}

/**
 * Remove header/footer lines from a page's line array.
 * Only checks the first and last 1-2 lines.
 * @param {Line[]} lines
 * @param {Set<string>} patterns
 * @returns {Line[]}
 */
function filterHeaderFooterLines(lines, patterns) {
  if (patterns.size === 0 || lines.length < 2) return lines;

  const isHeaderFooter = (/** @type {Line} */ line) => {
    const text = line.items.map((i) => i.str).join('');
    return patterns.has(normalizeEdgeText(text));
  };

  // Check first and last line only
  const toRemove = new Set();
  if (isHeaderFooter(lines[0])) toRemove.add(0);
  if (isHeaderFooter(lines[lines.length - 1])) toRemove.add(lines.length - 1);

  if (toRemove.size === 0) return lines;
  return lines.filter((_, i) => !toRemove.has(i));
}

/**
 * Find the most common font height by character count.
 * @param {TextItem[]} items
 * @returns {number}
 */
function computeBodyHeight(items) {
  /** @type {Map<number, number>} */
  const charCounts = new Map();

  for (const item of items) {
    if (!item.str.trim()) continue;
    const h = Math.round(item.height * 10) / 10;
    charCounts.set(h, (charCounts.get(h) || 0) + item.str.length);
  }

  let maxCount = 0;
  let bodyH = 12; // fallback
  for (const [h, count] of charCounts) {
    if (count > maxCount) {
      maxCount = count;
      bodyH = h;
    }
  }
  return bodyH;
}

/**
 * Classify a font as bold/italic based on its name and style.
 * @param {string} fontName
 * @param {FontStyle} style
 * @returns {{ isBold: boolean, isItalic: boolean }}
 */
function classifyFont(fontName, style) {
  const combined = `${fontName} ${style?.fontFamily || ''}`;
  return {
    isBold: /bold/i.test(combined),
    isItalic: /italic|oblique/i.test(combined)
  };
}

/**
 * Group text items into lines by Y-proximity, sorted in reading order.
 * @param {TextItem[]} items
 * @param {number} bodyHeight
 * @returns {Line[]}
 */
function groupItemsIntoLines(items, bodyHeight) {
  if (items.length === 0) return [];

  const threshold = bodyHeight * 0.5;
  // Sort by Y descending (PDF Y increases upward), then X ascending
  // Sort by Y descending (higher Y = higher on page = first in reading order)
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > threshold) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  /** @type {Line[]} */
  const lines = [];
  let currentLine = { items: [sorted[0]], y: sorted[0].transform[5] };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const yDiff = Math.abs(item.transform[5] - currentLine.y);

    if (yDiff < threshold) {
      currentLine.items.push(item);
    } else {
      // Sort items within line by X
      currentLine.items.sort((a, b) => a.transform[4] - b.transform[4]);
      lines.push(currentLine);
      currentLine = { items: [item], y: item.transform[5] };
    }
  }
  currentLine.items.sort((a, b) => a.transform[4] - b.transform[4]);
  lines.push(currentLine);

  return lines;
}

const BULLET_RE = /^[•\u2022\u2023\u25AA\u25B8\u25BA\u25CF\u2013\u2014\-*]\s/;
const NUMBER_RE = /^(\d{1,3}[.)]\s|[a-z][.)]\s)/i;

/**
 * Classify a line as heading, bullet-list, number-list, or body.
 * @param {Line} line
 * @param {number} bodyHeight
 * @returns {ClassifiedLine}
 */
function classifyLine(line, bodyHeight) {
  const lineText = line.items.map((i) => i.str).join('');
  const trimmedText = lineText.trim();

  // Check for heading: predominant height > body * 1.2, at least 2 non-ws chars
  if (trimmedText.length >= 2) {
    let totalChars = 0;
    let largeChars = 0;
    for (const item of line.items) {
      if (!item.str.trim()) continue;
      const chars = item.str.length;
      totalChars += chars;
      if (item.height > bodyHeight * 1.2) {
        largeChars += chars;
      }
    }
    if (totalChars > 0 && largeChars / totalChars > 0.5) {
      // Find max height for heading level
      const maxH = Math.max(...line.items.filter((i) => i.str.trim()).map((i) => i.height));
      const level = maxH > bodyHeight * 1.8 ? 2 : 3;
      return { type: 'heading', line, headingLevel: level };
    }
  }

  // Check for bullet list
  if (BULLET_RE.test(trimmedText)) {
    return { type: 'bullet-list', line };
  }

  // Check for numbered list
  if (NUMBER_RE.test(trimmedText)) {
    return { type: 'number-list', line };
  }

  return { type: 'body', line };
}

/**
 * Group classified lines into blocks (paragraphs, headings, lists).
 * @param {ClassifiedLine[]} classifiedLines
 * @param {number} bodyHeight
 * @returns {Block[]}
 */
function groupLinesIntoBlocks(classifiedLines, bodyHeight) {
  /** @type {Block[]} */
  const blocks = [];
  /** @type {Block | null} */
  let current = null;

  const largeGap = bodyHeight * 1.8;

  for (let i = 0; i < classifiedLines.length; i++) {
    const cl = classifiedLines[i];
    const prevCl = i > 0 ? classifiedLines[i - 1] : null;

    // Y gap between this line and previous
    const yGap = prevCl ? Math.abs(cl.line.y - prevCl.line.y) : 0;

    if (cl.type === 'heading') {
      if (current) blocks.push(current);
      blocks.push({ type: 'heading', lines: [cl], headingLevel: cl.headingLevel });
      current = null;
    } else if (cl.type === 'bullet-list') {
      if (current && current.type !== 'ul') {
        blocks.push(current);
        current = null;
      }
      if (!current) current = { type: 'ul', lines: [] };
      current.lines.push(cl);
    } else if (cl.type === 'number-list') {
      if (current && current.type !== 'ol') {
        blocks.push(current);
        current = null;
      }
      if (!current) current = { type: 'ol', lines: [] };
      current.lines.push(cl);
    } else {
      // Body line
      // Check if this is a list continuation (indented body after list item)
      if (current && (current.type === 'ul' || current.type === 'ol')) {
        const prevLine = current.lines[current.lines.length - 1].line;
        const prevX = Math.min(...prevLine.items.map((i) => i.transform[4]));
        const thisX = Math.min(...cl.line.items.map((i) => i.transform[4]));
        if (thisX > prevX + bodyHeight * 0.5) {
          // Indented continuation — append to last list item
          current.lines.push(cl);
          continue;
        }
        // Not indented — end the list
        blocks.push(current);
        current = null;
      }

      if (!current) {
        current = { type: 'paragraph', lines: [cl] };
      } else if (current.type === 'paragraph') {
        // Large Y gap → new paragraph
        if (yGap > largeGap) {
          blocks.push(current);
          current = { type: 'paragraph', lines: [cl] };
        } else {
          current.lines.push(cl);
        }
      }
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

/**
 * Render blocks to HTML.
 * @param {Block[]} blocks
 * @param {Map<string, {isBold: boolean, isItalic: boolean}>} fontClassification
 * @returns {string}
 */
function renderBlocksToHtml(blocks, fontClassification) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const tag = block.headingLevel === 2 ? 'h2' : 'h3';
        const items = block.lines.flatMap((l) => l.line.items);
        const text = renderInlineItems(items, fontClassification);
        return `<${tag}>${text}</${tag}>`;
      }

      if (block.type === 'paragraph') {
        const lineTexts = block.lines.map((cl) =>
          renderInlineItems(cl.line.items, fontClassification)
        );
        return `<p>${joinLinesWithHyphenRejoining(lineTexts)}</p>`;
      }

      if (block.type === 'ul' || block.type === 'ol') {
        const listItems = [];
        let currentLi = null;

        for (const cl of block.lines) {
          if (cl.type === 'bullet-list' || cl.type === 'number-list') {
            if (currentLi) listItems.push(currentLi);
            // Strip the bullet/number prefix
            const items = [...cl.line.items];
            const text = stripListPrefix(items, cl.type);
            currentLi = text;
          } else {
            // Continuation line
            const text = renderInlineItems(cl.line.items, fontClassification);
            if (currentLi) {
              currentLi += ' ' + text;
            }
          }
        }
        if (currentLi) listItems.push(currentLi);

        const tag = block.type;
        const lis = listItems.map((li) => `<li>${li}</li>`).join('');
        return `<${tag}>${lis}</${tag}>`;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Strip bullet/number prefix from list item text items and render inline.
 * @param {TextItem[]} items
 * @param {'bullet-list' | 'number-list'} type
 * @returns {string}
 */
function stripListPrefix(items, type) {
  // Join all text and strip the prefix
  const fullText = items.map((i) => i.str).join('');
  const re = type === 'bullet-list' ? BULLET_RE : NUMBER_RE;
  const stripped = fullText.replace(re, '');
  return escapeHtml(stripped);
}

/**
 * Render text items with inline bold/italic formatting.
 * @param {TextItem[]} items
 * @param {Map<string, {isBold: boolean, isItalic: boolean}>} fontClassification
 * @returns {string}
 */
function renderInlineItems(items, fontClassification) {
  if (items.length === 0) return '';

  /** @type {{ text: string, isBold: boolean, isItalic: boolean }[]} */
  const runs = [];

  for (const item of items) {
    if (!item.str) continue;
    const fc = fontClassification.get(item.fontName) || { isBold: false, isItalic: false };
    const lastRun = runs[runs.length - 1];

    if (lastRun && lastRun.isBold === fc.isBold && lastRun.isItalic === fc.isItalic) {
      lastRun.text += item.str;
    } else {
      runs.push({ text: item.str, isBold: fc.isBold, isItalic: fc.isItalic });
    }
  }

  return runs
    .map((run) => {
      let text = escapeHtml(run.text);
      if (run.isBold) text = `<strong>${text}</strong>`;
      if (run.isItalic) text = `<em>${text}</em>`;
      return text;
    })
    .join('');
}

/**
 * Build plain text from lines for textContent, rejoining hyphenated words.
 * @param {Line[]} lines
 * @param {number} bodyHeight
 * @returns {string}
 */
function buildPlainText(lines, bodyHeight) {
  if (lines.length === 0) return '';
  const largeGap = bodyHeight * 1.8;
  const paragraphs = [];
  let currentLines = [lines[0].items.map((i) => i.str).join('')];

  for (let i = 1; i < lines.length; i++) {
    const yGap = Math.abs(lines[i].y - lines[i - 1].y);
    const lineText = lines[i].items.map((i) => i.str).join('');
    if (yGap > largeGap) {
      paragraphs.push(joinLinesWithHyphenRejoining(currentLines));
      currentLines = [lineText];
    } else {
      currentLines.push(lineText);
    }
  }
  paragraphs.push(joinLinesWithHyphenRejoining(currentLines));
  return paragraphs.join('\n');
}

/**
 * Join line texts, rejoining hyphenated words at line breaks.
 * If a line ends with `-` and the next line starts with a lowercase letter,
 * removes the hyphen and joins without space (soft hyphen / word wrap).
 * @param {string[]} lineTexts
 * @returns {string}
 */
function joinLinesWithHyphenRejoining(lineTexts) {
  if (lineTexts.length === 0) return '';
  let result = lineTexts[0];
  for (let i = 1; i < lineTexts.length; i++) {
    const next = lineTexts[i];
    if (
      result.endsWith('-') &&
      next.length > 0 &&
      next[0] === next[0].toLowerCase() &&
      next[0] !== next[0].toUpperCase()
    ) {
      result = result.slice(0, -1) + next;
    } else {
      result += ' ' + next;
    }
  }
  return result;
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
