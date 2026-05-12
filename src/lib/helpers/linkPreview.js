/**
 * Extract HTTP(S) URLs from a parsed Nostr content tree (applesauce NAST)
 * that are eligible for link-preview cards.
 *
 * Excludes URLs already rendered inline by NostrContentRenderer (images,
 * videos) and Nostr URIs (handled by NostrIdentifier). Deduplicates,
 * preserves document order, and caps the result at MAX_URLS.
 */

const MAX_URLS = 3;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogg)$/i;

/**
 * @param {string} href
 * @returns {boolean}
 */
function isPreviewable(href) {
  if (typeof href !== 'string' || href.length === 0) return false;
  if (!/^https?:\/\//i.test(href)) return false;
  let pathname;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return false;
  }
  if (IMAGE_EXT_RE.test(pathname)) return false;
  if (VIDEO_EXT_RE.test(pathname)) return false;
  return true;
}

/**
 * @param {{ children?: Array<any> } | null | undefined} parsedRoot
 * @returns {string[]}
 */
export function extractPreviewableUrls(parsedRoot) {
  if (!parsedRoot || !Array.isArray(parsedRoot.children)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const node of parsedRoot.children) {
    if (out.length >= MAX_URLS) break;
    if (node?.type !== 'link') continue;
    const href = node.href;
    if (!isPreviewable(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}
