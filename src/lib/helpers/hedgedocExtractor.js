/**
 * Extract HedgeDoc-rendered markdown documents into article-shaped data.
 *
 * HedgeDoc serves the raw markdown source as the text content of
 * `<div id="doc" class="container markdown-body">` and relies on its own
 * client-side JS to render it. Mozilla Readability sees this as a single
 * blob of text and the markdown reaches the user un-rendered.
 *
 * This helper detects HedgeDoc pages and renders their markdown to HTML
 * server-side so the reader view shows it correctly.
 */
import { Marked } from 'marked';

const hedgedocMarked = new Marked({ breaks: true, gfm: true });

/**
 * @param {Document} document - parsed via linkedom
 * @returns {boolean}
 */
export function isHedgedocPage(document) {
  const appName =
    document.querySelector('meta[name="application-name"]')?.getAttribute('content') || '';
  if (appName.startsWith('HedgeDoc')) return true;

  return Boolean(document.querySelector('#doc.markdown-body'));
}

/**
 * @param {Document} document - parsed via linkedom
 * @param {URL} parsedUrl
 * @returns {{
 *   title: string,
 *   content: string,
 *   textContent: string,
 *   byline: string|undefined,
 *   siteName: string
 * } | null}
 */
export function extractHedgedocArticle(document, parsedUrl) {
  const docEl = document.querySelector('#doc.markdown-body');
  if (!docEl) return null;

  const markdown = (docEl.textContent || '').trim();
  if (!markdown) return null;

  const html = /** @type {string} */ (hedgedocMarked.parse(markdown, { async: false }));

  let title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  if (!title) {
    title = document.querySelector('title')?.textContent || '';
  }
  title = title.replace(/\s*-\s*HedgeDoc\s*$/i, '').trim();
  if (!title) {
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }
  if (!title) title = parsedUrl.hostname + parsedUrl.pathname;

  return {
    title,
    content: html,
    textContent: markdown,
    byline: undefined,
    siteName: 'HedgeDoc'
  };
}
