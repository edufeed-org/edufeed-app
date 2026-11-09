/**
 * Termi "document mode": a long tier-2 answer becomes a Markdown document the
 * user can copy, download or open as an article draft, with a generated
 * sources-and-licenses section. Pure (no Svelte): the article editor imports
 * the prefill handoff from here without pulling in the Termi window.
 */
import { slugifyHeading } from '$lib/helpers/headingAnchor.js';

const PREFILL_KEY = 'termi.article-prefill';
const DOC_WORDS = 250;

/** @typedef {import('$lib/server/termi/items.js').Item} Item */

/** HTML comments (a LiaScript header) never show in a bubble; exports keep them. @param {string} text */
export const withoutHtmlComments = (text) => (text ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();

/** A heading first line (after a leading comment block) or ≥ 250 words. @param {string} text */
export function isDocumentAnswer(text) {
  const t = (text ?? '').trim().replace(/^<!--[\s\S]*?-->\s*/, '');
  return t.startsWith('# ') || t.split(/\s+/).filter(Boolean).length >= DOC_WORDS;
}

/** @param {string | undefined} href */
function absolute(href) {
  if (!href) return undefined;
  try {
    return new URL(href, globalThis.location?.origin).href;
  } catch {
    return undefined;
  }
}

/**
 * One entry per source (by URL, else id), in card order; a later duplicate
 * (another passage of the same page) fills attribution the first one lacks.
 * @param {Item[]} items
 */
function mergeSources(items) {
  /** @type {Map<string, Item>} */
  const byKey = new Map();
  for (const i of items) {
    const key = i.sourceUrl ?? i.href ?? i.id;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { ...i });
    else {
      seen.creator ??= i.creator;
      seen.publisher ??= i.publisher;
      if (!seen.license && !seen.licenseUrl) {
        seen.license = i.license;
        seen.licenseUrl = i.licenseUrl;
      }
    }
  }
  return [...byKey.values()];
}

/**
 * "## Quellen und Lizenzen" with one line per source, in card order.
 * @param {Item[]} items @param {string} locale
 */
export function buildSourcesSection(items, locale) {
  const en = locale === 'en';
  const lines = mergeSources(items).map((i) => {
    const who =
      i.creator && i.publisher ? `${i.creator} (${i.publisher})` : i.creator || i.publisher;
    const url = i.sourceUrl ?? absolute(i.href);
    const license = i.license
      ? `${i.license}${i.licenseUrl ? ` (${i.licenseUrl})` : ''}`
      : (i.licenseUrl ?? (en ? 'license not stated' : 'Lizenz nicht angegeben'));
    return [`- ${i.title || url || ''}${who ? ` — ${who}` : ''}`, license, url]
      .filter(Boolean)
      .join(', ');
  });
  return `${en ? '## Sources and licenses' : '## Quellen und Lizenzen'}\n\n${lines.join('\n')}`;
}

/**
 * The model's links and images as their text, raw <a>/<img> tags dropped —
 * the export holds what the bubble showed (renderMarkdown allowLinks:false).
 * @param {string} text
 */
function stripLinks(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<\/?(?:a|img)\b[^>]*>/gi, '');
}

/**
 * The prompt leaves a LiaScript header's `author:` empty: the user's name goes
 * there (one line, no `-->`), or the line goes.
 * @param {string} text @param {string} [author]
 */
function fillAuthor(text, author) {
  const name = (author ?? '').replace(/\s+/g, ' ').replace(/--+>?/g, '-').trim();
  return text.replace(/^<!--[\s\S]*?-->/, (header) =>
    header.replace(/^author:[ \t]*(\r?\n|$)/m, name ? `author: ${name}$1` : '')
  );
}

/**
 * The model's working notes before the document ("Gern – dafür hole ich mir
 * zuerst …") go: the export starts at the first `# ` heading or a LiaScript
 * `<!--` header; without either the whole text stays.
 * @param {string} text
 */
const fromDocumentStart = (text) => {
  const t = (text ?? '').trim();
  const start = t.search(/^(?:<!--|#[ \t])/m);
  // only a short opening note, never a `# ` line inside a code block
  const note = start > 0 && start <= 400 && !t.slice(0, start).includes('```');
  return note ? t.slice(start) : t;
};

/** @param {string} s */
const norm = (s) => s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Attribution covers what the text used: passages (the evidence), items
 * without a title (nothing to judge), an item whose title (first 40
 * characters) appears in the text, or whose title or description holds a
 * phrase the text quotes („…“ "…" »…«). Nothing kept: all of them, so
 * sources never vanish.
 * @param {string} text @param {Item[]} items
 */
export function citedItems(text, items) {
  const body = norm(text ?? '');
  const quotes = [...(text ?? '').matchAll(/[„"“»«]([^„"“”»«]{8,}?)[“”"«»]/g)].map((q) =>
    norm(q[1])
  );
  const cited = items.filter((i) => {
    const title = norm(i.title ?? '');
    const description = norm(i.description ?? '');
    return (
      i.type === 'passage' ||
      !title ||
      body.includes(title.slice(0, 40)) ||
      quotes.some((q) => title.includes(q) || description.includes(q))
    );
  });
  return cited.length ? cited : items;
}

/** @param {string} body @param {Item[]} items @param {string} locale @param {string} [author] */
function withSources(body, items, locale, author) {
  const text = fillAuthor(stripLinks(body.trim()), author);
  return items?.length
    ? `${text}\n\n${buildSourcesSection(citedItems(text, items), locale)}`
    : text;
}

/** @param {string} text @param {Item[]} items @param {string} locale @param {string} [author] */
export function documentMarkdown(text, items, locale, author) {
  return withSources(fromDocumentStart(text), items, locale, author);
}

/** The first `# ` heading, else the first 60 characters. @param {string} text */
export function documentTitle(text) {
  const doc = fromDocumentStart(text);
  return (doc.match(/^#[ \t]+(.+)$/m)?.[1] ?? doc.slice(0, 60)).trim();
}

/**
 * The article editor's prefill: the title goes in its own field, so the
 * content drops a leading `# …` line.
 * @param {string} text @param {Item[]} items @param {string} locale @param {string} [author]
 */
export function articleDraft(text, items, locale, author) {
  const body = fromDocumentStart(text).replace(/^#[ \t]+.*(\r?\n)*/, '');
  return { title: documentTitle(text), content: withSources(body, items, locale, author) };
}

/** A draft's summary: its first prose paragraph, ≤ 200 characters. @param {string} content */
export function draftSummary(content) {
  const para = withoutHtmlComments(content)
    .split(/\n\s*\n/)
    .find((p) => p.trim() && !p.trim().startsWith('#'));
  return (para ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** @param {string} text */
export function documentFilename(text) {
  const german = documentTitle(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  const slug = slugifyHeading(german).slice(0, 60).replace(/-+$/, '');
  return `termi-${slug || 'dokument'}.md`;
}

/**
 * The official LiaScript player loads `?nostr:<naddr>` from the naddr's relay
 * hints and renders the event content as a course (checked live 2026-11-09).
 * @param {string} naddr
 */
export const liascriptCourseUrl = (naddr) => `https://liascript.github.io/course/?nostr:${naddr}`;

/** @param {{ title: string, content: string }} prefill */
export function stashArticlePrefill(prefill) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* quota — the editor just opens empty */
  }
}

/** One-shot: read and remove. @returns {{ title: string, content: string } | null} */
export function takeArticlePrefill() {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.title === 'string' && typeof parsed?.content === 'string'
      ? { title: parsed.title, content: parsed.content }
      : null;
  } catch {
    return null;
  }
}
