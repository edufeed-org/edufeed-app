/**
 * Pure function to render markdown content to sanitized HTML.
 * Extracted from MarkdownRenderer for reuse in HighlightOverlay.
 */
import { marked } from 'marked';
import { preprocessNostrMentions } from '$lib/helpers/markdownNostr.js';
import { sanitizeHtml } from '$lib/helpers/htmlSanitize.js';

/** @type {import('marked').RendererObject} */
const renderer = {
  link({ href, title, tokens }) {
    if (href?.startsWith('nostr:')) {
      href = '/' + href.slice(6);
    }
    /** @type {string} */
    const text = tokens ? /** @type {any} */ (this).parser.parseInline(tokens) : '';
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr}>${text}</a>`;
  }
};

marked.use({
  breaks: true,
  gfm: true,
  renderer
});

/**
 * Render markdown content to sanitized HTML string.
 * @param {string | null | undefined} content - Raw markdown content
 * @returns {string} Sanitized HTML
 */
export function renderMarkdown(content) {
  if (!content || typeof content !== 'string') return '';

  try {
    const rawHtml = marked.parse(preprocessNostrMentions(content), { async: false });
    return sanitizeHtml(rawHtml);
  } catch (error) {
    console.error('Markdown parsing error:', error);
    return content.replace(/\n/g, '<br>');
  }
}
