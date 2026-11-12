/**
 * Links in Termi's text. A model-written link is clickable only when its target
 * came from a tool result of the same conversation (`allowedLinks`); anything
 * else is reduced to its text (`safeLinks`). Host-free: the origin is passed in.
 */
import { externalLink, linkFor } from '../components/assistant/cards/links.js';
import { itemsOf, toolNameOf } from './tool-registry.js';

/**
 * A link target after the light normalisation, or undefined when it can never
 * be a link: in-app `/path` (an absolute URL on `origin` equals its path) or
 * http(s) only — no whitespace/control characters, no `//host`, no `/\host`.
 * Percent-encoded like marked does, so text and rendered hrefs compare equal.
 * @param {unknown} raw @param {string} [origin]
 */
export function normalizeTarget(raw, origin) {
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim();
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
  if (!s || /[\s\u0000-\u001f\u007f-\u009f\\]/.test(s)) return undefined;
  if (origin && (s === origin || s.startsWith(origin + '/'))) s = s.slice(origin.length) || '/';
  if (!/^\/(?!\/)|^https?:\/\/[^/?#]/i.test(s)) return undefined;
  try {
    return encodeURI(s).replace(/%25/g, '%');
  } catch {
    return undefined;
  }
}

/**
 * Every target the conversation's tool results legitimately link: the items'
 * in-app `href`s, and the external urls the cards link (`cards/links.js`).
 * Stored turns keep `items` (tier 1) or `toolParts` (tier 2); an old record
 * with neither allows nothing.
 * @param {{ items?: any[], toolParts?: any[], [k: string]: any }[]} turns @param {string} [origin]
 * @returns {Set<string>}
 */
export function allowedLinks(turns, origin) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const t of turns ?? []) {
    const items = [
      ...(t.items ?? []),
      ...(t.toolParts ?? []).flatMap((/** @type {any} */ p) => itemsOf(toolNameOf(p), p.output))
    ];
    for (const i of items) {
      for (const l of [
        linkFor(i),
        externalLink(i.href),
        externalLink(i.sourceUrl),
        externalLink(i.licenseUrl)
      ]) {
        const n = normalizeTarget(l?.href, origin);
        if (n) out.add(n);
      }
    }
  }
  return out;
}

/** The renderer's check: is this href one of the allowed targets? @param {Set<string>} allowed @param {string} [origin] */
export const linkPredicate = (allowed, origin) => (/** @type {string} */ href) => {
  const n = normalizeTarget(href, origin);
  return !!n && allowed.has(n);
};

const INLINE =
  /(!?)\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const AUTO = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/gi;
const DEF = /^( {0,3})\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)([^\n]*)$/gm;
const REF = /\[((?:[^[\]\\]|\\.)*)\]\[([^\]\n]*)\]/g;
const SHORT = /\[([^[\]\n]+)\](?![[(:])/g;
const unwrap = (/** @type {string} */ d) => (d.startsWith('<') ? d.slice(1, -1) : d);
const rewrap = (/** @type {string} */ old, /** @type {string} */ d) =>
  old.startsWith('<') ? `<${d}>` : d;
const label = (/** @type {string} */ s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Applies `fn(target, isImage)` to every link target outside code: inline
 * links, images, autolinks and reference definitions. A string replaces the
 * target; null reduces the link to its text (a definition is dropped and its
 * uses become text).
 * @param {string} md @param {(target: string, image: boolean) => string | null} fn
 */
function rewriteLinks(md, fn) {
  /** @type {string[]} */
  const codes = [];
  const masked = md
    .replace(/[]/g, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g, (c) => `${codes.push(c) - 1}`);
  /** @type {Set<string>} */
  const bad = new Set();
  const out = masked
    .replace(INLINE, (all, bang, text, dest, title = '') => {
      const next = fn(unwrap(dest), !!bang);
      return next === null ? text : `${bang}[${text}](${rewrap(dest, next)}${title})`;
    })
    .replace(AUTO, (all, target) => {
      const next = fn(target, false);
      return next === null ? target : `<${next}>`;
    })
    .replace(DEF, (all, indent, name, dest, rest) => {
      if (name.startsWith('^')) return all;
      const next = fn(unwrap(dest), false);
      if (next === null) {
        bad.add(label(name));
        return '';
      }
      return `${indent}[${name}]: ${rewrap(dest, next)}${rest}`;
    });
  const unmask = (/** @type {string} */ s) => s.replace(/(\d+)/g, (_, i) => codes[Number(i)]);
  if (!bad.size) return unmask(out);
  return unmask(
    out
      .replace(REF, (all, text, name) => (bad.has(label(name || text)) ? text : all))
      .replace(SHORT, (all, name) => (bad.has(label(name)) ? name : all))
  );
}

/**
 * The model's links, kept only when their target is allowed; everything else
 * (also images and raw `<a>`/`<img>` tags) is reduced to its text. Runs on the
 * Markdown before it renders or leaves the app.
 * @param {string} md @param {Set<string>} allowed @param {string} [origin]
 */
export function safeLinks(md, allowed, origin) {
  const ok = linkPredicate(allowed, origin);
  // tags first: a stripped <a> must not leave a half link behind (they are escaped as text anyway)
  const noTags = (md ?? '').replace(/<\/?(?:a|img)\b[^>]*>/gi, '');
  return rewriteLinks(noTags, (target, image) => {
    if (image || !ok(target)) return null;
    const t = target.trim();
    // an absolute link to this app is the in-app link (it stays in the tab)
    return origin && t.startsWith(origin + '/') ? t.slice(origin.length) : t;
  });
}

/** Text that leaves the app: in-app `/path` targets become `origin + path`. @param {string} md @param {string} origin */
export const absoluteLinks = (md, origin) =>
  rewriteLinks(md ?? '', (t) => (/^\/(?!\/)/.test(t) ? origin + t : t));

/**
 * One conversation's link rules: `ok` for the renderer, `safe` for text that
 * renders in the window, `exported` (validated, then absolute) for text that leaves.
 * @param {Parameters<typeof allowedLinks>[0]} turns @param {string} [origin]
 */
export function linkKit(turns, origin) {
  const allowed = allowedLinks(turns, origin);
  const safe = (/** @type {string} */ md) => safeLinks(md, allowed, origin);
  return {
    ok: linkPredicate(allowed, origin),
    safe,
    exported: (/** @type {string} */ md) => absoluteLinks(safe(md), origin ?? '')
  };
}

/**
 * Click on rendered Termi text: an in-app link goes to `open` (no page load);
 * external links and modifier/middle clicks keep the browser's default.
 * @param {MouseEvent} e @param {(href: string) => void} open
 */
export function onLinkClick(e, open) {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  const href = a?.getAttribute('href') ?? '';
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  if (!/^\/(?!\/)/.test(href)) return;
  e.preventDefault();
  open(href);
}
