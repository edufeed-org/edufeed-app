/**
 * Wiki content renderer supporting Djot (NIP-54 default) and AsciiDoc detection.
 */
import { parse, renderHTML } from '@djot/djot';
import { preprocessWikilinks } from '$lib/helpers/markdownNostr.js';
import { preprocessNostrMentions } from '$lib/helpers/markdownNostr.js';
import { sanitizeHtml } from '$lib/helpers/htmlSanitize.js';
import { createSlugger, headingAnchorLink } from '$lib/helpers/headingAnchor.js';

/**
 * Detect if content is AsciiDoc based on distinctive syntax patterns.
 * @param {string} content
 * @returns {boolean}
 */
export function isAsciidoc(content) {
  if (!content) return false;

  // Check first ~30 lines for distinctive AsciiDoc patterns
  const lines = content.split('\n').slice(0, 30);

  for (const line of lines) {
    const trimmed = line.trim();
    // Single = heading (AsciiDoc-only; Djot/Markdown use #)
    if (/^={1,5}\s+\S/.test(trimmed)) return true;
    // [source,lang] code block annotations
    if (/^\[source[,\]]/.test(trimmed)) return true;
    // :attribute: document attributes
    if (/^:[a-zA-Z][a-zA-Z0-9_-]*:/.test(trimmed)) return true;
    // include:: directives
    if (/^include::/.test(trimmed)) return true;
  }
  return false;
}

/**
 * Rewrite nostr: link hrefs to app-internal paths.
 * @param {string} href
 * @returns {string}
 */
function rewriteNostrHref(href) {
  if (href?.startsWith('nostr:')) {
    return '/' + href.slice(6);
  }
  return href;
}

/**
 * Render wiki content (Djot or AsciiDoc) to sanitized HTML.
 * @param {string | null | undefined} content
 * @returns {Promise<string>}
 */
export async function renderWikiContent(content) {
  if (!content || typeof content !== 'string') return '';

  try {
    // Preprocess wikilinks and nostr mentions
    const processed = preprocessNostrMentions(preprocessWikilinks(content));

    if (isAsciidoc(processed)) {
      return await renderAsciidoc(processed);
    }
    return renderDjot(processed);
  } catch (error) {
    console.error('Wiki content rendering error:', error);
    return content.replace(/\n/g, '<br>');
  }
}

/**
 * Walk a djot inline AST and return its plain-text content.
 * @param {any} node
 * @returns {string}
 */
function djotPlainText(node) {
  if (!node) return '';
  if (typeof node.text === 'string' && !Array.isArray(node.children)) return node.text;
  if (Array.isArray(node.children)) return node.children.map(djotPlainText).join('');
  return '';
}

/**
 * Render Djot content to sanitized HTML.
 * @param {string} content
 * @returns {string}
 */
function renderDjot(content) {
  const doc = parse(content);
  const slugger = createSlugger();
  const html = renderHTML(doc, {
    overrides: {
      heading: (node, renderer) => {
        const id = slugger(djotPlainText(node));
        const children = renderer.renderChildren(node);
        return `<h${node.level} id="${id}">${headingAnchorLink(id)}${children}</h${node.level}>`;
      },
      link: (node, renderer) => {
        const href = rewriteNostrHref(node.destination || '');
        const children = renderer.renderChildren(node);
        return `<a href="${href}">${children}</a>`;
      },
      url: (node, renderer) => {
        const href = rewriteNostrHref(node.text || '');
        return `<a href="${href}">${renderer.renderChildren(/** @type {any} */ (node))}</a>`;
      }
    }
  });
  return sanitizeHtml(html);
}

/**
 * Render AsciiDoc content to sanitized HTML (dynamic import).
 * @param {string} content
 * @returns {Promise<string>}
 */
async function renderAsciidoc(content) {
  const Asciidoctor = (await import('asciidoctor')).default;
  const asciidoctor = Asciidoctor();
  const html = asciidoctor.convert(content, {
    safe: 'secure',
    standalone: false,
    // sectids is on by default; sectanchors injects an inline link.anchor inside
    // each section heading. Combined with allowing `id` through DOMPurify, this
    // gives wiki readers deep-linkable section anchors.
    attributes: { showtitle: true, sectanchors: '' }
  });
  return sanitizeHtml(/** @type {string} */ (html));
}
