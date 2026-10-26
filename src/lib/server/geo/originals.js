/**
 * Mirrors: content whose original lives on another site (partners publish to
 * Nostr and edufeed shows it). Google's advice for syndicated content is that
 * the syndicating site blocks indexing of its copy — "The most effective
 * solution is for partners to block indexing of your content"
 * (developers.google.com/search/docs/crawling-indexing/canonicalization-troubleshooting).
 * So a mirror stays fully usable in the app but is noindex and never in the
 * sitemap; the partner's original keeps the search visibility.
 *
 * - Learning resources (30142) whose d-tag is an external URL describe that
 *   page: always a mirror.
 * - Any event may name its original with ["source", "<url>"] (the Ursprungsort
 *   of article-attribution.js; wiki article "Original sources of mirrored
 *   content" in edufeed/wikis) — preferred.
 * - Otherwise events fall back to per-author URL
 *   templates (GEO_ORIGINAL_URLS="<npub|hex>=https://oer.community/{d}/,…")
 *   name where an author's posts originate. The page must exist there (a 404
 *   means the post is edufeed-original); sites that never answer 404 make
 *   the template apply unconditionally.
 */
import { normalizePubkey } from '$lib/helpers/pubkey.js';

/**
 * @param {string | undefined} value
 * @returns {Map<string, string>} pubkey hex → URL template containing {d}
 */
export function parseOriginalTemplates(value) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const entry of String(value ?? '').split(',')) {
    const i = entry.indexOf('=');
    if (i < 0) continue;
    const pubkey = normalizePubkey(entry.slice(0, i).trim());
    const template = entry.slice(i + 1).trim();
    if (!pubkey || !/^https:\/\/[^/\s]+\/\S*\{d\}/.test(template)) continue;
    map.set(pubkey, template);
  }
  return map;
}

/** @param {{ tags?: string[][] }} event */
const dTag = (event) => (event.tags?.find((t) => t[0] === 'd')?.[1] ?? '').trim();

/** @param {string} d */
const isRelativePath = (d) =>
  d !== '' &&
  !/[\\?#\s:]/.test(d) &&
  d.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

/**
 * Where the event's original would be, without any network access.
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @param {Map<string, string>} templates
 * @returns {{ url: string, verify: boolean } | null} verify = existence still to check
 */
export function originalCandidate(event, templates) {
  // 1. The publisher names the original: ["source", <url>] — the Ursprungsort
  //    the blog form writes (article-attribution.js), as on kind-1063 license
  //    attestations. No check needed.
  const source = (event.tags?.find((t) => t[0] === 'source')?.[1] ?? '').trim();
  if (/^https?:\/\/\S+$/i.test(source)) return { url: source, verify: false };

  const d = dTag(event);
  // 2. A learning resource's d-tag URL is the resource it describes.
  if (event.kind === 30142 && /^https?:\/\//i.test(d)) return { url: d, verify: false };

  // 3. Per-author template. d must be a relative path (slug or a/b, as in
  //    FOERBICO's "en/our-team"): no dot-segments, empty segments, query or
  //    fragment, so the template's host and path prefix stay what it points to.
  const template = templates.get(event.pubkey);
  if (!template || !isRelativePath(d)) return null;
  return { url: template.replace('{d}', d), verify: true };
}

/**
 * @param {{ head: (url: string) => Promise<number>, ttlMs: number, now?: () => number }} opts
 *   head resolves to the HTTP status (redirects followed)
 */
export function createOriginalChecker({ head, ttlMs, now = Date.now }) {
  /** @type {Map<string, { exists: boolean, at: number }>} */
  const cache = new Map();
  return {
    /**
     * @param {string} url
     * @returns {Promise<boolean | null>} null = no clear answer (5xx, timeout)
     */
    async exists(url) {
      const hit = cache.get(url);
      if (hit && now() - hit.at < ttlMs) return hit.exists;
      let status;
      try {
        status = await head(url);
      } catch {
        return null;
      }
      /** @type {boolean | null} */
      const exists =
        status >= 200 && status < 400 ? true : status === 404 || status === 410 ? false : null;
      if (exists !== null) {
        if (cache.size > 5000) cache.delete(cache.keys().next().value ?? '');
        cache.set(url, { exists, at: now() });
      }
      return exists;
    }
  };
}

/**
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @param {Map<string, string>} templates
 * @param {{ exists: (url: string) => Promise<boolean | null> }} checker
 * @returns {Promise<string | null | undefined>} original URL (mirror), null (edufeed
 *   original), undefined (couldn't tell — treat as provisional)
 */
export async function resolveMirror(event, templates, checker) {
  const candidate = originalCandidate(event, templates);
  if (!candidate) return null;
  if (!candidate.verify) return candidate.url;
  const exists = await checker.exists(candidate.url);
  if (exists === null) return undefined;
  return exists ? candidate.url : null;
}
