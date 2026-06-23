/**
 * Pure function to render markdown content to sanitized HTML.
 * Extracted from MarkdownRenderer for reuse in HighlightOverlay.
 */
import { Marked } from 'marked';
import { preprocessNostrMentions } from '$lib/helpers/markdownNostr.js';
import { sanitizeHtml } from '$lib/helpers/htmlSanitize.js';
import { createSlugger, headingAnchorLink } from '$lib/helpers/headingAnchor.js';

/**
 * @param {{ headingAnchors: boolean }} options
 * @returns {import('marked').RendererObject}
 */
function buildRenderer({ headingAnchors }) {
  const slugger = headingAnchors ? createSlugger() : null;
  return {
    link({ href, title, tokens }) {
      if (href?.startsWith('nostr:')) {
        href = '/' + href.slice(6);
      }
      const text = tokens ? /** @type {any} */ (this).parser.parseInline(tokens) : '';
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },
    heading({ tokens, depth }) {
      const parser = /** @type {any} */ (this).parser;
      const html = parser.parseInline(tokens);
      if (!slugger) return `<h${depth}>${html}</h${depth}>`;
      const plain = parser.parseInline(tokens, parser.textRenderer);
      const id = slugger(plain);
      return `<h${depth} id="${id}">${headingAnchorLink(id)}${html}</h${depth}>`;
    }
  };
}

/**
 * Strip markdown syntax down to a plain-text snippet.
 * Used for compact previews (e.g. calendar cards) where rendered markdown
 * would be visually noisy. Links/images collapse to their text/alt, and all
 * structural markers are removed. Not a security boundary — for display of
 * untrusted content as HTML use {@link renderMarkdown} instead.
 *
 * @param {string | null | undefined} content - Raw markdown content
 * @returns {string} Plain text with markdown markers removed
 */
export function stripMarkdown(content) {
  if (!content || typeof content !== 'string') return '';

  return (
    content
      // images ![alt](url) -> alt (before links, since syntax overlaps)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links [text](url) -> text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // inline code `code` -> code
      .replace(/`([^`]*)`/g, '$1')
      // bold/italic/strikethrough markers
      .replace(/(\*\*|__|~~|\*|_)/g, '')
      // leading heading / blockquote / list markers per line
      .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
      // collapse all whitespace (incl. newlines) to single spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Render markdown content to sanitized HTML string.
 * @param {string | null | undefined} content - Raw markdown content
 * @param {{ headingAnchors?: boolean }} [options]
 * @returns {string} Sanitized HTML
 */
export function renderMarkdown(content, options = {}) {
  if (!content || typeof content !== 'string') return '';

  try {
    const m = new Marked({ breaks: true, gfm: true });
    m.use({ renderer: buildRenderer({ headingAnchors: !!options.headingAnchors }) });
    const rawHtml = /** @type {string} */ (
      m.parse(preprocessNostrMentions(content), { async: false })
    );
    return sanitizeHtml(rawHtml);
  } catch (error) {
    console.error('Markdown parsing error:', error);
    return content.replace(/\n/g, '<br>');
  }
}
