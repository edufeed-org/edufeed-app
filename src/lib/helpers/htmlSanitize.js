/**
 * Shared HTML sanitization configuration and utility.
 * Used by markdown.js and wikiContent.js.
 */
import DOMPurify from 'dompurify';
import { browser } from '$app/environment';

export const ALLOWED_TAGS = [
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

export const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'class',
  'id',
  'aria-label',
  'aria-hidden',
  'tabindex'
];

// Classes the app's own renderers emit (headingAnchorLink; asciidoctor's
// sectanchors). Any other class would let content reuse app CSS — e.g.
// `fixed inset-0 z-50 modal modal-open` — to overlay fake UI.
const ALLOWED_CLASSES = new Set(['heading-anchor', 'anchor']);

/** @type {import('dompurify').DOMPurify | undefined} */
let purifier;

// A dedicated instance so these hooks never reach other DOMPurify users.
// Ids stay as they are: heading anchors link to them, and DOMPurify's default
// SANITIZE_DOM already drops ids that clobber document/form properties
// (`cookie`, `location`, …). SANITIZE_NAMED_PROPS would prefix every id with
// `user-content-` and break shared `#section` links.
function getPurifier() {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'class') return;
    data.attrValue = data.attrValue
      .split(/\s+/)
      .filter((name) => ALLOWED_CLASSES.has(name))
      .join(' ');
    if (!data.attrValue) data.keepAttr = false;
  });
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('target')) node.setAttribute('rel', 'noopener noreferrer');
  });
  return purifier;
}

/**
 * Sanitize raw HTML string using DOMPurify.
 * @param {string} rawHtml
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(rawHtml) {
  if (browser && typeof DOMPurify?.sanitize === 'function') {
    return getPurifier().sanitize(String(rawHtml), {
      ALLOWED_TAGS,
      ALLOWED_ATTR
    });
  }
  return String(rawHtml);
}
