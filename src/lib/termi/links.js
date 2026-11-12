/**
 * Links in Termi's text. A model-written link is clickable only when its target
 * came from a tool result of the same conversation (`allowedLinks`); anything
 * else is reduced to its text (`safeLinks`). Host-free: the origin is passed in.
 */
import { externalLink, linkFor } from '../components/assistant/cards/links.js';
import { Marked } from 'marked';
import { itemsOf, toolNameOf } from './tool-registry.js';
import { IN_APP } from './in-app.js';

export { IN_APP };

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
  if (!IN_APP.test(s) && !/^https?:\/\/[^/?#]/i.test(s)) return undefined;
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

const markdown = new Marked({ breaks: true, gfm: true }); // the renderer's options (helpers/markdown.js)
const RISKY_TAG = /<\/a\s*>|<a\b[^>]*\bhref\b[^>]*>|<img\b[^>]*\b(?:src|srcset)\b[^>]*>/gi;
const URLISH = /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i;

/** @param {any} t */
const childrenOf = (t) =>
  t.type === 'table'
    ? [...t.header, ...t.rows.flat()]
    : t.type === 'list'
      ? t.items
      : (t.tokens ?? []);

/**
 * Rewrites `src` from marked's lexer (the renderer's own parser): only link,
 * image, reference-definition and html tokens are edited, everything else
 * stays byte for byte. Throws when a target token cannot be located.
 * @param {any[]} tokens @param {string} src
 * @param {{ ok?: (href: string) => boolean, origin?: string, absolute?: boolean }} o
 */
function rewriteTokens(tokens, src, o) {
  const check = !!o.ok;
  /** @param {string} tail starts at a destination */
  const retarget = (tail) => {
    if (check && o.origin && tail.startsWith(o.origin + '/')) tail = tail.slice(o.origin.length);
    return o.absolute && IN_APP.test(tail) ? o.origin + tail : tail;
  };
  let out = '';
  let cut = 0; // src[0..cut) is in `out`
  let pos = 0; // where the next token's raw must be searched from
  /** @param {any} t */
  const leaf = (t) => {
    if (!t.raw) return;
    for (const part of [t.raw, t.raw.split('\n')[0]]) {
      const i = part ? src.indexOf(part, pos) : -1;
      if (i >= 0) return void (pos = i + part.length);
    }
  };
  /** @param {any} t @param {string} text */
  const replace = (t, text) => {
    const i = src.indexOf(t.raw, pos);
    if (i < 0) throw new Error('token not found');
    out += src.slice(cut, i) + text;
    cut = pos = i + t.raw.length;
  };
  /** The token's replacement, or undefined to leave it. @param {any} t @returns {string | undefined} */
  const edit = (t) => {
    if (t.type === 'image') return check ? t.text : undefined;
    if (t.type === 'html') return check ? t.raw.replace(RISKY_TAG, '') : undefined;
    if (t.type === 'def') {
      if (check && !o.ok?.(t.href)) return '';
      const m = t.raw.match(/^\[[^\]]*\]:\s*<?/);
      return m ? m[0] + retarget(t.raw.slice(m[0].length)) : undefined;
    }
    if (t.type !== 'link') return undefined;
    // autolinks and bare urls: the visible text stays, never a link
    if (!t.raw.startsWith('[')) return check && t.raw.startsWith('<') ? t.text : undefined;
    if (!t.raw.startsWith(`[${t.text}]`)) return check ? t.text : undefined;
    const inner = check ? rewriteTokens(t.tokens, t.text, o) : t.text;
    const shown = t.text.replace(/[*_`~]/g, '').trim();
    const deceptive =
      URLISH.test(shown) &&
      !(IN_APP.test(t.href)
        ? false
        : t.href.toLowerCase().includes(shown.replace(/^https?:\/\//i, '').toLowerCase()));
    if (check && (!o.ok?.(t.href) || deceptive)) return inner;
    const rest = t.raw.slice(t.text.length + 2);
    const m = rest.match(/^\(\s*<?/);
    const newRest = m ? m[0] + retarget(rest.slice(m[0].length)) : rest;
    return `[${inner}]${newRest}`;
  };
  /** @param {any} t */
  const visit = (t) => {
    const r = edit(t);
    if (r !== undefined && r !== t.raw) return replace(t, r);
    const kids = childrenOf(t);
    if (r === undefined && kids.length) kids.forEach(visit);
    else leaf(t);
  };
  tokens.forEach(visit);
  return out + src.slice(cut);
}

/**
 * Last resort when a token cannot be located in the source (a link spanning
 * lines inside a quote): every link, image, definition and tag goes.
 * @param {string} md
 */
const flatten = (md) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t>*-]*\[[^\]]+\]:.*$/gm, '')
    .replace(/<\/?(?:a|img)\b[^>]*>/gi, '');

/** @param {string} md @param {Parameters<typeof rewriteTokens>[2]} o */
function rewriteLinks(md, o) {
  try {
    return rewriteTokens(markdown.lexer(md), md, o);
  } catch {
    return o.ok ? flatten(md) : md;
  }
}

/**
 * The model's links, kept only when their target is allowed; everything else
 * becomes its text. Images never survive, a rejected definition is dropped, an
 * absolute link to this app becomes its in-app path. Runs on the Markdown
 * before it renders.
 * @param {string} md @param {Set<string>} allowed @param {string} [origin]
 */
export const safeLinks = (md, allowed, origin) =>
  rewriteLinks(md ?? '', { ok: linkPredicate(allowed, origin), origin });

/** Text that leaves the app: in-app `/path` targets become `origin + path`. @param {string} md @param {string} origin */
export const absoluteLinks = (md, origin) => rewriteLinks(md ?? '', { origin, absolute: true });

/**
 * One conversation's link rules: `ok` for the renderer, `safe` for text that
 * renders in the window, `exported` (validated, then absolute) for text that leaves.
 * @param {Parameters<typeof allowedLinks>[0]} turns @param {string} [origin]
 */
export function linkKit(turns, origin) {
  const allowed = allowedLinks(turns, origin);
  const ok = linkPredicate(allowed, origin);
  return {
    ok,
    safe: (/** @type {string} */ md) => rewriteLinks(md ?? '', { ok, origin }),
    // validated and absolute in one pass
    exported: (/** @type {string} */ md) => rewriteLinks(md ?? '', { ok, origin, absolute: true })
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
  if (!IN_APP.test(href)) return;
  e.preventDefault();
  open(href);
}
