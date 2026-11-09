// Turns a dropped file into plain text for Termi's calendar import. Routes
// by extension first, then MIME type, then (for zip-shaped files with
// neither) a byte sniff — never parses structured calendar data itself: one
// LLM call downstream turns the text into candidate events (see events.js).
import { readZipEntries, zipToText } from './zip-text.js';

const ZIP_EXTENSIONS = new Set(['.docx', '.xlsx', '.odt', '.ods']);
const ZIP_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/zip'
]);
const BLOCK_TAGS =
  /<\/?(p|div|br|li|ul|ol|tr|table|h[1-6]|section|article|header|footer)\b[^>]*>/gi;

/** @param {string} name */
function extensionOf(name) {
  const match = /\.[^./\\]+$/.exec(name || '');
  return match ? match[0].toLowerCase() : '';
}

/** @param {Blob} file */
async function sniffsAsZip(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** @param {string} text */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * @param {File} file
 * @param {string} ext
 */
async function readPlainText(file, ext) {
  const isHtml = ext === '.html' || ext === '.htm' || file.type === 'text/html';
  let raw = stripBom(await file.text());
  if (isHtml) raw = stripHtml(raw);
  return /�/.test(raw.slice(0, 1000)) ? '' : raw;
}

/** @param {string} html */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Dynamically imports pdfjs-dist the way PdfPage.svelte does, so no caller
 * pays for it unless a PDF is actually dropped (and tests never load it —
 * they inject a stub `loadPdf` instead).
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pages: string[] }>}
 */
export async function defaultLoadPdf(bytes) {
  const pdfjsLib = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return { pages };
}

/**
 * @param {File} file
 * @param {{ loadPdf?: typeof defaultLoadPdf, maxChars?: number }} [options]
 * @returns {Promise<{ text: string, kind: 'text'|'pdf'|'zip', truncated: boolean }>}
 */
export async function extractText(file, { loadPdf = defaultLoadPdf, maxChars = 60_000 } = {}) {
  const ext = extensionOf(file.name);
  const looksLikeZipFormat = ZIP_EXTENSIONS.has(ext) || ZIP_MIME_TYPES.has(file.type);

  /** @type {'text'|'pdf'|'zip'} */
  let kind;
  if (ext === '.pdf' || file.type === 'application/pdf') kind = 'pdf';
  else if (looksLikeZipFormat) kind = 'zip';
  else if (await sniffsAsZip(file)) kind = 'zip';
  else kind = 'text';

  let text;
  if (kind === 'pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { pages } = await loadPdf(bytes);
    text = pages.join('\n\n');
  } else if (kind === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const entries = await readZipEntries(bytes);
      text = zipToText(entries);
    } catch {
      // Corrupt zip, an over-the-limit entry (zip-bomb guard), or a
      // false-positive PK sniff on a file whose name/MIME never claimed to
      // be an Office doc — a read failure never reaches the caller.
      if (looksLikeZipFormat) {
        text = '';
      } else {
        kind = 'text';
        text = await readPlainText(file, ext);
      }
    }
  } else {
    text = await readPlainText(file, ext);
  }

  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  return { text, kind, truncated };
}
