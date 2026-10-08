// Links in the call chat. Pure.
//
// Call chat messages are LiveKit data messages, not Nostr events, so the
// event renderers (NostrContentRenderer, chatMarkdown's parseChatMarkdown)
// do not fit: they want an event, pull in applesauce's content parser and
// would render media and markdown the call chat never had. What the call
// chat needs is narrower — make URLs and Nostr ids clickable and say which
// of them stay inside the app — so this splits the text into plain-text and
// link segments, and the panel renders both as escaped text (no {@html}).
//
// "Internal" matters for the call: following an app link in the same tab
// is a client-side navigation the call survives (the call store owns the
// Room), so the panel pops the call out first and then navigates, exactly
// like clicking a sender's name. External links open in a new tab.
import { extractPreviewableUrls } from '$lib/helpers/linkPreview.js';

/** @typedef {{ text: string }} TextSegment */
/** @typedef {{ href: string, label: string, internal: boolean }} LinkSegment */
/** @typedef {{ emoji: string, url: string }} EmojiSegment NIP-30 custom emoji: `:emoji:` → image */
/** @typedef {TextSegment | LinkSegment | EmojiSegment} CallChatSegment */

// An http(s) URL, or a NIP-19 id (optionally `nostr:`-prefixed) standing on
// its own. Only these two shapes are ever linked, so `javascript:` and
// friends stay text by construction.
const TOKEN_RE =
  /(https?:\/\/[^\s<>"'`]+)|(?<![\w/])((?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]{20,})/gi;

const TRAILING_PUNCT = '.,;:!?*';

/**
 * Drop sentence punctuation a URL was typed next to: `see https://x.org.`
 * and `(https://x.org)`, while `…/Test_(Begriff)` keeps its parenthesis.
 * @param {string} url
 */
function trimUrl(url) {
  let out = url;
  for (;;) {
    const last = out.at(-1);
    if (!last) return out;
    if (TRAILING_PUNCT.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const pairs = /** @type {Record<string, string>} */ ({ ')': '(', ']': '[', '}': '{' });
    const open = pairs[last];
    if (open && out.split(open).length < out.split(last).length) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

/**
 * @param {string} raw an http(s) URL as typed
 * @param {string} origin the app's own origin
 * @returns {LinkSegment | null}
 */
function urlSegment(raw, origin) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (origin && url.origin === origin) {
    // `https://app//evil.example` has the path `//evil.example`, which as an
    // href is protocol-relative and leaves the app: one leading slash only.
    const path = '/' + url.pathname.replace(/^\/+/, '');
    return { href: path + url.search + url.hash, label: raw, internal: true };
  }
  return { href: url.href, label: raw, internal: false };
}

/**
 * Split call chat text into text and link segments.
 * @param {string} text
 * @param {string} [origin] the app's origin (`window.location.origin`); a URL
 *   on it becomes an internal path
 * @returns {CallChatSegment[]}
 */
export function linkifyCallChat(text, origin = '') {
  if (typeof text !== 'string' || text === '') return [{ text: text ?? '' }];
  /** @type {CallChatSegment[]} */
  const out = [];
  let last = 0;
  /** @param {number} end */
  const pushText = (end) => {
    if (end > last) out.push({ text: text.slice(last, end) });
  };
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    /** @type {LinkSegment | null} */
    let seg = null;
    let raw = match[0];
    if (match[1]) {
      raw = trimUrl(match[1]);
      seg = urlSegment(raw, origin);
    } else if (match[2]) {
      seg = { href: '/' + raw.replace(/^nostr:/i, ''), label: raw, internal: true };
    }
    if (!seg) continue;
    pushText(match.index);
    out.push(seg);
    last = match.index + raw.length;
    TOKEN_RE.lastIndex = last;
  }
  pushText(text.length);
  return out.length ? out : [{ text }];
}

/**
 * The external pages worth a preview card under the message (no app links —
 * those are the app itself — and no images/videos), deduped, at most three.
 * @param {CallChatSegment[]} segments
 * @returns {string[]}
 */
export function callChatPreviewUrls(segments) {
  return extractPreviewableUrls({
    children: segments
      .filter((s) => 'href' in s && !s.internal)
      .map((s) => ({ type: 'link', href: /** @type {LinkSegment} */ (s).href }))
  });
}

/**
 * Split the custom emojis a sender declared (payload `emoji` pairs) out of
 * the text segments: `:party:` becomes an {@link EmojiSegment} when `party`
 * was declared, any other `:code:` stays text. Link segments are left as
 * they are. Returns the same array when there is nothing to do.
 * @param {CallChatSegment[]} segments
 * @param {Array<[string, string]> | undefined} emoji declared [shortcode, url] pairs
 * @returns {CallChatSegment[]}
 */
export function withCustomEmojis(segments, emoji) {
  if (!emoji?.length) return segments;
  const urls = new Map(emoji);
  const codes = [...urls.keys()].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`:(${codes.join('|')}):`, 'g');
  /** @type {CallChatSegment[]} */
  const out = [];
  for (const seg of segments) {
    if (!('text' in seg)) {
      out.push(seg);
      continue;
    }
    let last = 0;
    for (const match of seg.text.matchAll(re)) {
      const at = /** @type {number} */ (match.index);
      if (at > last) out.push({ text: seg.text.slice(last, at) });
      out.push({ emoji: match[1], url: /** @type {string} */ (urls.get(match[1])) });
      last = at + match[0].length;
    }
    if (last < seg.text.length) out.push({ text: seg.text.slice(last) });
  }
  return out;
}
