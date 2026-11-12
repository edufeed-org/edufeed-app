/**
 * Links in Termi's text. A model-written link is clickable only when its target
 * came from a tool result of the same conversation (`allowedLinks`); anything
 * else is reduced to its text (`safeLinks`). Host-free: the origin is passed in.
 */
import { externalLink, linkFor } from '../components/assistant/cards/links.js';
import { Marked } from 'marked';
import { itemsOf, toolNameOf } from './tool-registry.js';
import { IN_APP } from './in-app.js';
import { PART_MARKER } from './lesson-state.js';

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
    // `( ) '` encoded as well: a kept link is written that way (`urlOut`) and must compare equal
    return encodeURI(s)
      .replace(/%25/g, '%')
      .replace(/[()']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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

// ---- html: what may stay a `<` -------------------------------------------------------------
// A `<` survives only in code, as an attribute-free formatting tag, or as a kept comment;
// every other `<` that could open something becomes `&lt;` (the text stays visible and what is
// left cannot reassemble into a tag). `< ` and `<3` open nothing anywhere.
const PLAIN_TAGS = new Set(
  'b i em strong u s sub sup br hr p div span details summary table thead tbody tr td th ul ol li code pre kbd mark small blockquote h1 h2 h3 h4 h5 h6 section'.split(
    ' '
  )
);
const TAG = /<\/?([a-z][a-z0-9]*)\s*\/?>/iy;
const PART = new RegExp(`^${PART_MARKER.source}$`);
// LiaScript header keys that load and run nothing; a value carries no tag, attribute, link or `--`.
const SAFE_LINE =
  /^[ \t]*(?:author|email|version|language|narrator|comment|mode|dark|date|title|tags)[ \t]*:(?:[^\n<>=[\]-]|-(?!-))*$/;
/**
 * A comment as it may stay: Termi's part marker, or a LiaScript header cut to
 * its safe `key: value` lines; '' when nothing of it may stay.
 * @param {string} c a whole `<!-- … -->`
 */
const keepComment = (c) => {
  if (PART.test(c)) return c;
  const lines = c.slice(4, -3).split('\n');
  const safe = lines.filter((l) => SAFE_LINE.test(l));
  if (!safe.length) return '';
  return lines.every((l) => !l.trim() || SAFE_LINE.test(l)) ? c : `<!--\n${safe.join('\n')}\n-->`;
};

/** Every complete comment of `raw` replaced by what `keepComment` leaves of it; one scan. @param {string} raw */
const cutComments = (raw) => {
  let out = '';
  let at = 0;
  for (let i = raw.indexOf('<!--'); i >= 0; i = raw.indexOf('<!--', at)) {
    const close = raw.indexOf('-->', i + 4);
    if (close < 0) break;
    out += raw.slice(at, i) + keepComment(raw.slice(i, close + 3));
    at = close + 3;
  }
  return out + raw.slice(at);
};

/** @param {string} s @param {string} c */
const positions = (s, c) => {
  /** @type {number[]} */
  const at = [];
  for (let i = s.indexOf(c); i >= 0; i = s.indexOf(c, i + 1)) at.push(i);
  return at;
};
/** @param {string | undefined} s @param {string} c */
const count = (s, c) => positions(s ?? '', c).length;

/**
 * One pass over `s`: every `<` that opens something becomes `&lt;`, except in
 * code (`states[k] === 1` for the k-th `<`), allowlisted tags and kept
 * comments. `risky`: an escaped `<` opened html or an autolink (`states[k] === 2`),
 * so the escaping may have changed how the rest lexes.
 * @param {string} s @param {number[]} [states] none: code counts as text (total)
 */
function escapeLt(s, states) {
  let out = '';
  let cut = 0;
  let risky = false;
  let close = -1; // the next `-->` at or after the current comment start
  for (let i = s.indexOf('<'), k = 0; i >= 0; i = s.indexOf('<', i + 1), k++) {
    if (states?.[k] === 1 || /^[\s\d]?$/.test(s[i + 1] ?? '')) continue;
    TAG.lastIndex = i;
    const m = TAG.exec(s);
    if (m && PLAIN_TAGS.has(m[1].toLowerCase())) continue;
    if (s.startsWith('<!--', i)) {
      if (close < i + 4) close = s.indexOf('-->', i + 4);
      if (close < 0) close = Infinity; // none left: no later `<!--` can close either
      const next = s.indexOf('<', i + 1);
      const c = close === Infinity ? '' : s.slice(i, close + 3);
      // a kept comment holds no other `<`, so each char is looked at by one candidate only
      if (c && (next < 0 || next > close) && keepComment(c) === c) continue;
    }
    out += s.slice(cut, i) + '&lt;';
    cut = i + 1;
    if (states?.[k] === 2) risky = true;
  }
  return { out: out + s.slice(cut), risky };
}

/**
 * Last resort: every unescaped bracket and `:` `@` `.` gets a backslash (no
 * link, image, reference, definition, bare url, www., e-mail or autolink can
 * form), every `<` that opens something is escaped, code included. No
 * detection and no lexer, so it holds for any input.
 * @param {string} md
 */
const total = (md) => {
  let out = '';
  let slashes = 0;
  for (const c of md) {
    out += '[]:@.'.includes(c) && slashes % 2 === 0 ? '\\' + c : c;
    slashes = c === '\\' ? slashes + 1 : 0;
  }
  return escapeLt(out).out;
};

// ---- links ---------------------------------------------------------------------------------
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s)]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
/** The host of a url or domain text, without www. @param {string} u */
const hostOf = (u) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
  } catch {
    return '';
  }
};
/** A kept link's target, written so it cannot leave the parentheses or carry markup. @param {string} u */
const urlOut = (u) =>
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is encoded
  u.replace(/[ \t\n\r\f\v<>()"'\\\u0000-\u001f\u007f]/g, (c) => {
    const h = c.charCodeAt(0).toString(16).toUpperCase();
    return `%${h.length < 2 ? '0' + h : h}`;
  });

/** @param {any} t */
const childrenOf = (t) =>
  t.type === 'table'
    ? [...t.header, ...t.rows.flat()]
    : t.type === 'list'
      ? t.items
      : (t.tokens ?? []);

/** @typedef {{ ok: (href: string) => boolean, origin?: string, absolute?: boolean }} Rules */

/**
 * Rewrites `src` from marked's lexer (the renderer's own parser). Kept links
 * are re-emitted as `[text](url)` (no title, no angle brackets, reference
 * links resolved); a rejected link, an image and an autolink become their
 * text; every definition goes; html comments are cut to what `keepComment`
 * allows. Everything else stays byte for byte. A token is found by counting:
 * marked keeps every `[` and `<` of the source in its token raws, in source
 * order (the prefixes it strips from quotes and list items hold neither), so
 * the n-th `[`/`<` met while walking is the n-th in `src`. Throws when a token
 * is not where the count says.
 * @param {any[]} tokens @param {string} src @param {Rules} o
 */
function rewriteTokens(tokens, src, o) {
  const brackets = positions(src, '[');
  const lts = positions(src, '<');
  let nb = 0; // `[` and `<` of src met so far
  let nl = 0;
  let out = '';
  let cut = 0;
  /** @param {string} href */
  const retarget = (href) => {
    if (o.origin && (href === o.origin || href.startsWith(o.origin + '/')))
      href = href.slice(o.origin.length) || '/';
    return o.absolute && IN_APP.test(href) ? o.origin + href : href;
  };
  /** The token's replacement, or undefined to leave it (and look inside). @param {any} t @returns {string | undefined} */
  const edit = (t) => {
    if (t.type === 'def') return '';
    if (t.type === 'html') return t.raw.includes('<!--') ? cutComments(t.raw) : undefined;
    if (t.type === 'image') return rewriteTokens(t.tokens ?? [], t.text, o);
    if (t.type !== 'link') return undefined;
    // autolinks: the visible text stays, never a link; bare urls, www. and e-mail stay as written
    if (t.raw.startsWith('<')) return t.text;
    if (!t.raw.startsWith('[')) return undefined;
    const inner = rewriteTokens(t.tokens, t.text, o);
    // escaped brackets in the text: marked's text is not the raw one, keep the text only
    if (!t.raw.startsWith(`[${t.text}]`)) return inner;
    // text naming a host other than the target's: the link would lie about where it goes
    const target = IN_APP.test(t.href) ? '' : hostOf(t.href);
    const deceptive = (inner.match(URL_IN_TEXT) ?? []).some(
      (/** @type {string} */ u) => hostOf(u) !== target
    );
    if (!o.ok(t.href) || deceptive) return inner;
    return `[${inner}](${urlOut(retarget(t.href))})`;
  };
  /** @param {any} t */
  const skip = (t) => {
    nb += count(t.raw, '[');
    nl += count(t.raw, '<');
  };
  /** @param {any} t */
  const visit = (t) => {
    const r = edit(t);
    if (r === undefined) {
      const kids = childrenOf(t);
      if (!kids.length || t.type === 'link') return skip(t);
      if (t.task) nb++; // `[ ]`/`[x]` is in the item's raw, not in its children
      return kids.forEach(visit);
    }
    if (r !== t.raw) {
      const ib = t.raw.indexOf('[');
      const il = t.raw.indexOf('<');
      const at = il >= 0 && (ib < 0 || il < ib) ? lts[nl] - il : brackets[nb] - ib;
      if (!(at >= cut) || !src.startsWith(t.raw, at)) throw new Error('token not found');
      out += src.slice(cut, at) + r;
      cut = at + t.raw.length;
    }
    skip(t);
  };
  tokens.forEach(visit);
  return out + src.slice(cut);
}

/**
 * Checks `tokens` (the lex of the text about to leave) and returns, for every
 * `<` in source order, 1 in code, 2 in html/an autolink/a link's own part, 0 in
 * text. `bad`: an image, a definition, or a link that is not a kept canonical one.
 * @param {any[]} tokens @param {Rules} o
 */
function inspect(tokens, o) {
  /** @type {number[]} */
  const states = [];
  let bad = false;
  /** @param {number} n @param {number} v */
  const push = (n, v) => {
    for (let i = 0; i < n; i++) states.push(v);
  };
  /** @param {any} t */
  const visit = (t) => {
    if (t.type === 'image' || t.type === 'def') bad = true;
    if (t.type === 'link' && t.raw.startsWith('['))
      bad ||= !o.ok(t.href) || t.raw !== `[${t.text}](${t.href})`;
    const n = count(t.raw, '<');
    if (t.type === 'code' || t.type === 'codespan') return push(n, 1);
    const kids = childrenOf(t);
    if (!kids.length) return push(n, t.type === 'text' || t.type === 'escape' ? 0 : 2);
    const before = states.length;
    kids.forEach(visit);
    // a link's own `<` (destination, label, autolink brackets): containers have none
    if (t.type === 'link') push(n - (states.length - before), 2);
  };
  tokens.forEach(visit);
  return { states, bad };
}

/**
 * The checked text: links rewritten, then the one `<` pass over the result,
 * decided on the result's own lex. When that pass escaped html (which may
 * change how the rest lexes: a backtick in an attribute, an html block before
 * indented code), the result is lexed once more and must hold as it is;
 * whatever does not hold gets `total`.
 * @param {string} md @param {Rules} o
 */
function rewriteLinks(md, o) {
  if (!md.includes('[') && !md.includes('<')) return md;
  let s;
  let tokens;
  try {
    tokens = markdown.lexer(md);
    s = rewriteTokens(tokens, md, o);
    if (s !== md) tokens = markdown.lexer(s);
  } catch {
    return total(md);
  }
  const first = inspect(tokens, o);
  if (first.bad || first.states.length !== count(s, '<')) return total(s);
  const { out, risky } = escapeLt(s, first.states);
  if (!risky) return out;
  try {
    const again = inspect(markdown.lexer(out), o);
    if (
      !again.bad &&
      again.states.length === count(out, '<') &&
      escapeLt(out, again.states).out === out
    )
      return out;
  } catch {
    // fall through
  }
  return total(s);
}

/**
 * The model's links, kept only when their target is allowed; everything else
 * becomes its text. Images never survive, definitions are dropped, an absolute
 * link to this app becomes its in-app path. Runs on the Markdown before it renders.
 * @param {string} md @param {Set<string>} allowed @param {string} [origin]
 */
export const safeLinks = (md, allowed, origin) =>
  rewriteLinks(md ?? '', { ok: linkPredicate(allowed, origin), origin });

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
