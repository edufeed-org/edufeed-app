/**
 * Termi "document mode": a long tier-2 answer becomes a Markdown document the
 * user can copy, download or open as an article draft, with a generated
 * sources-and-licences section. Pure (no Svelte): the article editor imports
 * the prefill handoff from here without pulling in the Termi window.
 */
import { uniqueBy, unique } from '$lib/helpers/unique.js';
import { slugifyHeading } from '$lib/helpers/headingAnchor.js';

const PREFILL_KEY = 'termi.article-prefill';
const DOC_WORDS = 250;

/** @typedef {import('$lib/server/termi/items.js').Item} Item */

/** A heading first line or ≥ 250 words. @param {string} text */
export function isDocumentAnswer(text) {
  const t = (text ?? '').trim();
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
 * "## Quellen und Lizenzen" with one line per source, in card order.
 * @param {Item[]} items @param {string} locale
 */
export function buildSourcesSection(items, locale) {
  const en = locale === 'en';
  const lines = uniqueBy(items, (i) => i.id).map((i) => {
    const who =
      i.creator && i.publisher ? `${i.creator} (${i.publisher})` : i.creator || i.publisher;
    const url = i.sourceUrl ?? absolute(i.href);
    return [
      `- ${i.title || url || ''}${who ? ` — ${who}` : ''}`,
      i.license ?? (en ? 'licence not stated' : 'Lizenz nicht angegeben'),
      url
    ]
      .filter(Boolean)
      .join(', ');
  });
  // Several passages of one resource are one source.
  return `${en ? '## Sources and licences' : '## Quellen und Lizenzen'}\n\n${unique(lines).join('\n')}`;
}

/** @param {string} text @param {Item[]} items @param {string} locale */
export function documentMarkdown(text, items, locale) {
  const body = (text ?? '').trim();
  return items?.length ? `${body}\n\n${buildSourcesSection(items, locale)}` : body;
}

/** The first `# ` heading, else the first 60 characters. @param {string} text */
export function documentTitle(text) {
  const heading = (text ?? '').match(/^#[ \t]+(.+)$/m)?.[1];
  return (heading ?? (text ?? '').slice(0, 60)).trim();
}

/** @param {string} text */
export function documentFilename(text) {
  return `termi-${slugifyHeading(documentTitle(text)) || 'dokument'}.md`;
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
