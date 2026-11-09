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

/** @param {string} text @param {Item[]} items @param {string} locale */
export function documentMarkdown(text, items, locale) {
  const body = stripLinks((text ?? '').trim());
  return items?.length ? `${body}\n\n${buildSourcesSection(items, locale)}` : body;
}

/** The first `# ` heading, else the first 60 characters. @param {string} text */
export function documentTitle(text) {
  const heading = (text ?? '').match(/^#[ \t]+(.+)$/m)?.[1];
  return (heading ?? (text ?? '').slice(0, 60)).trim();
}

/**
 * The article editor's prefill: the title goes in its own field, so the
 * content drops a leading `# …` line.
 * @param {string} text @param {Item[]} items @param {string} locale
 */
export function articleDraft(text, items, locale) {
  const body = (text ?? '').trim().replace(/^#[ \t]+.*(\r?\n)*/, '');
  return { title: documentTitle(text), content: documentMarkdown(body, items, locale) };
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

const LIASCRIPT_COURSE = 'https://LiaScript.github.io/course/?';
/**
 * LiaScript loads a course from `?data:text…;base64,<…>` (LiaScript
 * src/elm/Update.elm `download` → `loadFromData`, checked 2026-11-09).
 */
export const LIASCRIPT_DATA_URI_SUPPORTED = true;
/** Longer data URIs make unwieldy URLs (servers and proxies cap them). */
const MAX_DATA_URI = 100_000;

/** @param {string} source a public raw-markdown URL or a data URI */
export const liascriptCourseUrl = (source) => `${LIASCRIPT_COURSE}${source}`;

/** The document as a course link, or null when too long. @param {string} markdown */
export function liascriptDataCourseUrl(markdown) {
  const bytes = new TextEncoder().encode(markdown);
  const uri = `data:text/plain;base64,${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`;
  return uri.length <= MAX_DATA_URI ? liascriptCourseUrl(uri) : null;
}

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
