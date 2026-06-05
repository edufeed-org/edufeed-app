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
