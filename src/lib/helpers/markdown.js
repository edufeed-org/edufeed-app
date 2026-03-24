/**
 * Pure function to render markdown content to sanitized HTML.
 * Extracted from MarkdownRenderer for reuse in HighlightOverlay.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { browser } from '$app/environment';
import { preprocessNostrMentions } from '$lib/helpers/markdownNostr.js';

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

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'del',
  'code',
  'pre',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'figure',
  'figcaption',
  'mark',
  'span',
  'div',
  'section'
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt', 'title', 'class'];

/**
 * Render markdown content to sanitized HTML string.
 * @param {string | null | undefined} content - Raw markdown content
 * @returns {string} Sanitized HTML
 */
export function renderMarkdown(content) {
  if (!content || typeof content !== 'string') return '';

  try {
    const rawHtml = marked.parse(preprocessNostrMentions(content), { async: false });

    if (browser && typeof DOMPurify?.sanitize === 'function') {
      return DOMPurify.sanitize(String(rawHtml), {
        ALLOWED_TAGS,
        ALLOWED_ATTR
      });
    }

    return String(rawHtml);
  } catch (error) {
    console.error('Markdown parsing error:', error);
    return content.replace(/\n/g, '<br>');
  }
}
