/**
 * Server-side HTML sanitizer for crawler-facing content.
 *
 * `$lib/helpers/htmlSanitize.js` is a no-op outside the browser (DOMPurify
 * needs a DOM), so markdown/djot output rendered on the server is raw,
 * attacker-controlled HTML. This module does not filter that HTML — it parses
 * it and emits a NEW document built only from allowlisted elements and
 * attributes, escaping every text node and attribute value itself. Markup
 * the allowlist doesn't name can therefore never reach the output.
 */
import { parseHTML } from 'linkedom';

/** Elements kept as-is (attributes still filtered). */
const KEEP = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'mark',
  'code',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'figure',
  'figcaption',
  'sub',
  'sup'
]);

/** Elements dropped together with everything inside them. */
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'textarea',
  'select',
  'option',
  'button',
  'form',
  'input',
  'head',
  'title',
  'link',
  'meta',
  'base',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'applet'
]);

const VOID = new Set(['br', 'hr', 'img']);

/** App UI the renderers add to content (e.g. the "#" link beside headings). */
const DROP_CLASSES = ['heading-anchor'];

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Ids of the page's own elements, which content must not shadow. */
const RESERVED_IDS = new Set(['geo-content', 'geo-jsonld', 'app-loader']);

/** Allowed attributes per element, in output order. */
const ATTRS = /** @type {Record<string, string[]>} */ ({
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan']
});

const MAX_DEPTH = 64;

/** @param {string} s */
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {string} s */
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

/**
 * @param {string} value
 * @returns {'external' | 'internal' | null}
 */
function classifyHref(value) {
  const v = value.trim();
  if (/^(https?:|mailto:)/i.test(v)) return 'external';
  // Relative paths and fragments, but not protocol-relative URLs (//host).
  if (/^(\/(?!\/)|#|\?)/.test(v)) return 'internal';
  return null;
}

/** @param {string} value */
const isHttpUrl = (value) => /^https?:\/\//i.test(value.trim());

/**
 * @param {any} el
 * @param {string} tag
 * @returns {string | null} serialized attributes, or null to drop the element
 */
function serializeAttrs(el, tag) {
  /** @type {string[]} */
  const out = [];
  let rel = false;
  // Heading ids keep in-page links (#section) working; slugs only.
  if (HEADINGS.has(tag)) {
    const id = el.getAttribute('id');
    if (id && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u.test(id) && !RESERVED_IDS.has(id))
      out.push(`id="${escapeAttr(id)}"`);
  }
  for (const name of ATTRS[tag] ?? []) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    if (name === 'href') {
      const kind = classifyHref(value);
      if (!kind) continue;
      if (kind === 'external') rel = true;
    } else if (name === 'src') {
      if (!isHttpUrl(value)) return null;
    } else if (['width', 'height', 'colspan', 'rowspan'].includes(name)) {
      if (!/^\d{1,4}$/.test(value)) continue;
    }
    out.push(`${name}="${escapeAttr(value.trim())}"`);
  }
  if (tag === 'img' && !out.some((a) => a.startsWith('src='))) return null;
  // User-authored outbound links: don't pass site reputation on to them, and
  // unsafe hrefs (dropped above) get the same treatment as external ones.
  if (tag === 'a' && (rel || !out.some((a) => a.startsWith('href=')))) {
    out.push('rel="nofollow ugc"');
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * @param {any} node
 * @param {number} depth
 * @returns {string}
 */
function serialize(node, depth) {
  let html = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      html += escapeText(child.textContent ?? '');
      continue;
    }
    if (child.nodeType !== 1) continue; // comments, processing instructions, …
    const tag = String(child.tagName || '').toLowerCase();
    if (DROP.has(tag)) continue;
    if (DROP_CLASSES.some((c) => child.classList?.contains(c))) continue;
    if (depth >= MAX_DEPTH) {
      html += escapeText(child.textContent ?? '');
      continue;
    }
    if (!KEEP.has(tag)) {
      html += serialize(child, depth + 1); // unwrap: keep the text, lose the element
      continue;
    }
    const attrs = serializeAttrs(child, tag);
    if (attrs === null) continue;
    if (VOID.has(tag)) {
      html += `<${tag}${attrs}>`;
      continue;
    }
    html += `<${tag}${attrs}>${serialize(child, depth + 1)}</${tag}>`;
  }
  return html;
}

/**
 * @param {string} rawHtml - untrusted HTML (e.g. rendered Nostr content)
 * @returns {string} HTML containing only allowlisted markup
 */
export function sanitizeServerHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`);
  return serialize(document.body, 0);
}
