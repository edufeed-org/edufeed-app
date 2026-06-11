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
  'class',
  'id',
  'aria-label',
  'aria-hidden',
  'tabindex'
];

/**
 * Sanitize raw HTML string using DOMPurify.
 * @param {string} rawHtml
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(rawHtml) {
  if (browser && typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify.sanitize(String(rawHtml), {
      ALLOWED_TAGS,
      ALLOWED_ATTR
    });
  }
  return String(rawHtml);
}
