/**
 * Restricted markdown for chat bubbles.
 *
 * Chat is not a document surface: headings and markdown-image syntax do not
 * belong in a bubble, so this ships only bold / italic / strike / inline code /
 * fenced code / blockquote / lists / links and renders everything else as the
 * literal text the author typed.
 *
 * Ordering matters and is the whole reason this helper exists. `renderMarkdown`
 * runs `preprocessNostrMentions` over the raw string *before* marked parses it,
 * so a `nostr:` entity inside a code fence is rewritten to a markdown link and
 * shown to the reader as `[npub1…](/npub1…)`. Here markdown is lexed first and
 * only the non-code inline runs are handed to the nostr parser, so code is
 * opaque by construction rather than by a guard someone can forget.
 *
 * The output is a tree of plain objects, never an HTML string — the renderer
 * turns it into Svelte components and escaped text, so there is no `{@html}`
 * on this path and therefore no DOMPurify to lean on. That is why hrefs are
 * filtered here: nothing downstream will do it.
 */
import { Marked } from 'marked';
import { getParsedContent } from 'applesauce-content/text';

/**
 * gfm autolinking is switched off on purpose. Left on, marked turns a bare
 * `https://…` into a `link` token, so it never reaches applesauce — and
 * applesauce is what turns a bare URL into imeta-sized media, a gallery or a
 * lightbox entry. Markdown here owns `[label](href)` only; bare URLs stay the
 * responsibility of the renderer that already handles them.
 */
const chatMarked = new Marked({ gfm: true, breaks: true }).use({
  tokenizer: {
    url() {
      return undefined;
    }
  }
});

/** Schemes a chat author may link to. Anything else renders as literal text. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'nostr:'];

/**
 * Sentinel origin for resolving in-app relative hrefs. `.invalid` is reserved
 * by RFC 2606 and can never resolve, so a href that lands on this origin is
 * genuinely relative and one that escapes it is genuinely off-origin.
 */
const RELATIVE_BASE = 'https://relative.invalid/';
const RELATIVE_BASE_ORIGIN = 'https://relative.invalid';

/**
 * @param {string} href
 * @returns {string | null} the href to use, or null if it must not be linked
 */
export function safeHref(href) {
  if (typeof href !== 'string' || href === '') return null;

  // In-app relative links, as produced by wikilinks and nostr mentions.
  //
  // `//` is not the only authority-relative form. Chrome normalises `\` to `/`
  // and strips TAB/CR/LF from an href entirely, so `/\evil.com`, `/\\evil.com`
  // and `/<TAB>/evil.com` all leave the origin while reading as in-app paths.
  // Pattern-matching loses this race — a regex closing the backslash pair
  // still lets the TAB through — so resolve it against a sentinel origin and
  // let the URL parser answer. Returning the re-serialised path also drops the
  // stripped characters instead of passing them to the DOM.
  if (href.startsWith('/')) {
    let resolved;
    try {
      resolved = new URL(href, RELATIVE_BASE);
    } catch {
      return null;
    }
    if (resolved.origin !== RELATIVE_BASE_ORIGIN) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  }

  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.includes(url.protocol)) return null;
  // `nostr:npub1…` addresses an app route, matching MarkdownRenderer's link rule.
  if (url.protocol === 'nostr:') return '/' + href.slice('nostr:'.length);
  return href;
}

/**
 * Lex chat content into a restricted markdown block tree whose leaves are
 * applesauce NAST node runs.
 *
 * @param {import('nostr-tools').Event} event
 * @returns {{ blocks: any[], nodes: any[] }} `nodes` is every NAST node in
 *   render order; each `nostr` run carries its `offset` into it so the
 *   renderer can keep one flat lightbox index across nested blocks.
 */
export function parseChatMarkdown(event) {
  const content = event?.content;
  if (!content || typeof content !== 'string') return { blocks: [], nodes: [] };

  /** @type {any[]} */
  const nodes = [];
  /** @param {string} text */
  const nostrRun = (text) => {
    const parsed = getParsedContent(event, text, undefined, null);
    const run = { type: 'nostr', nodes: parsed.children, offset: nodes.length };
    nodes.push(...parsed.children);
    return run;
  };

  let tokens;
  try {
    tokens = chatMarked.lexer(content);
  } catch {
    // A lexer failure must not blank the message — show it verbatim.
    return { blocks: [{ type: 'paragraph', children: [nostrRun(content)] }], nodes };
  }

  return { blocks: blocksFrom(tokens, nostrRun), nodes };
}

/**
 * @param {any[]} tokens
 * @param {(text: string) => any} nostrRun
 */
function blocksFrom(tokens, nostrRun) {
  /** @type {any[]} */
  const out = [];
  for (const token of tokens) {
    const block = blockFrom(token, nostrRun);
    if (block) out.push(block);
  }
  return out;
}

/**
 * @param {any} token
 * @param {(text: string) => any} nostrRun
 */
function blockFrom(token, nostrRun) {
  switch (token.type) {
    case 'space':
      return null;

    case 'code':
      return { type: 'code', lang: token.lang || null, text: token.text };

    case 'blockquote':
      return { type: 'blockquote', children: blocksFrom(token.tokens ?? [], nostrRun) };

    case 'list':
      return {
        type: 'list',
        ordered: !!token.ordered,
        start: token.ordered && token.start !== 1 ? token.start : null,
        items: (token.items ?? []).map((/** @type {any} */ item) => ({
          children: blocksFrom(item.tokens ?? [], nostrRun)
        }))
      };

    case 'table':
      // laoc, 2026-08-11: pipe tables get pasted into channels as design
      // docs and must render — overriding the original "no tables in a
      // bubble" cut. Cells hold inline runs, so nostr entities and inline
      // markdown inside a cell keep working.
      return {
        type: 'table',
        align: token.align ?? [],
        header: (token.header ?? []).map((/** @type {any} */ cell) =>
          inlinesFrom(cell.tokens ?? [], nostrRun, cell.text)
        ),
        rows: (token.rows ?? []).map((/** @type {any[]} */ row) =>
          row.map((cell) => inlinesFrom(cell.tokens ?? [], nostrRun, cell.text))
        )
      };

    case 'paragraph':
    // A tight list item's content arrives as a bare `text` token holding
    // inline tokens; treat it as a paragraph so lists get marked up too.
    // eslint-disable-next-line no-fallthrough
    case 'text':
      return { type: 'paragraph', children: inlinesFrom(token.tokens ?? [], nostrRun, token.raw) };

    // Deliberately out of the chat subset — headings, rules and raw
    // HTML render as the characters the author typed.
    default:
      return { type: 'paragraph', children: [nostrRun(token.raw ?? '')] };
  }
}

/**
 * @param {any[]} tokens
 * @param {(text: string) => any} nostrRun
 * @param {string} [fallbackRaw] source text to use when a token carries no inline children
 */
function inlinesFrom(tokens, nostrRun, fallbackRaw) {
  if (tokens.length === 0) return fallbackRaw ? [nostrRun(fallbackRaw)] : [];

  /** @type {any[]} */
  const out = [];

  /**
   * Contiguous plain text, escapes and line breaks are handed to applesauce as
   * ONE string rather than one run each. `breaks: true` splits `a.png\nb.png`
   * into text/br/text, and applesauce only groups images into a gallery when
   * it sees them consecutively — run-per-token silently loses every gallery.
   * Newlines stay in the string; the renderer turns them back into <br>.
   * @type {string[]}
   */
  let pending = [];
  const flush = () => {
    if (pending.length === 0) return;
    const text = pending.join('');
    pending = [];
    if (text !== '') out.push(nostrRun(text));
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'br':
        pending.push('\n');
        continue;

      case 'escape':
        pending.push(token.text ?? '');
        continue;

      case 'text':
        // gfm can nest tokens inside a text token; only leaves reach the parser.
        if (token.tokens?.length) {
          flush();
          out.push(...inlinesFrom(token.tokens, nostrRun));
        } else {
          pending.push(token.text ?? '');
        }
        continue;
    }

    flush();
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        out.push({ type: token.type, children: inlinesFrom(token.tokens ?? [], nostrRun) });
        break;

      case 'codespan':
        out.push({ type: 'codespan', text: token.text });
        break;

      case 'link': {
        const href = safeHref(token.href);
        if (href === null) {
          // Not a scheme we will link to — show what was typed instead.
          out.push(nostrRun(token.raw ?? ''));
          break;
        }
        out.push({ type: 'link', href, children: inlinesFrom(token.tokens ?? [], nostrRun) });
        break;
      }

      // A markdown image degrades to its bare URL rather than to literal text:
      // applesauce would linkify the URL inside `![alt](url)` regardless, so
      // "literal" renders `![alt](` + the image + `)`. Handing over just the
      // URL gives the reader what pasting that URL gives them, and still never
      // emits an <img> from markdown.
      case 'image': {
        const run = nostrRun(token.href ?? '');
        // The image degrades to its URL, but the alt the author typed is
        // theirs — dropping it would be an accessibility regression against
        // nothing, since the subset excludes markdown images from *rendering*,
        // not authored alt text. imeta still wins; this is the fallback.
        // Safe to tag in place: these nodes were parsed with a null cache key,
        // so they belong to this run and to nothing else.
        const alt = token.text ?? '';
        if (alt) {
          for (const node of run.nodes) {
            if (node.type === 'link') node.mdAlt = alt;
          }
        }
        out.push(run);
        break;
      }

      // inline `html` and anything else new in marked: literal.
      default:
        out.push(nostrRun(token.raw ?? ''));
        break;
    }
  }
  flush();
  return out;
}
