/**
 * Which pages of a deployment search engines and AI crawlers should index.
 *
 * Content pages (articles, wiki entries, learning resources) are indexable when
 * they were published through this deployment — NIP-89 client tag equal to
 * CLIENT_NAME, set by default since 04/2026 — or by a curated author, and pass
 * a minimal quality gate. Everything else stays fully usable but carries
 * `noindex`: bulk-imported metadata of pages that live elsewhere (Google's
 * "scraped content"), other people's Nostr content reachable under our domain,
 * social items, app functions. The sitemap uses the same rule.
 *
 * The client tag is self-declared and forgeable; callers additionally require
 * the event to sit on the deployment's own relays (see isOnOwnRelays).
 */

export const INDEXABLE_KINDS = new Set([30023, 30818, 30142]);

/** Minimum body length for articles and wiki entries (filters test posts). */
export const MIN_TEXT_WORDS = 150;

/** @param {{ tags?: string[][] }} event @param {string} name */
const tagValue = (event, name) => (event.tags?.find((t) => t[0] === name)?.[1] ?? '').trim();

/** @param {string} text */
const wordCount = (text) => (text.match(/\S+/g) ?? []).length;

/**
 * @param {{ kind: number, tags?: string[][], content?: string }} event
 * @returns {boolean}
 */
export function meetsQuality(event) {
  if (event.kind === 30142) {
    return (
      !!(tagValue(event, 'name') || tagValue(event, 'title')) && !!tagValue(event, 'description')
    );
  }
  const longEnough = wordCount(event.content ?? '') >= MIN_TEXT_WORDS;
  if (event.kind === 30023) return longEnough && !!tagValue(event, 'title');
  if (event.kind === 30818) return longEnough;
  return false;
}

/**
 * @param {{ kind: number, pubkey: string, tags?: string[][], content?: string }} event
 * @param {{ clientName: string, curatedAuthors: Set<string> | null }} opts
 * @returns {boolean}
 */
export function isIndexableEvent(event, { clientName, curatedAuthors }) {
  if (!INDEXABLE_KINDS.has(event.kind)) return false;
  const viaThisApp =
    !!clientName && tagValue(event, 'client').toLowerCase() === clientName.toLowerCase();
  const byCuratedAuthor = !!curatedAuthors?.has(event.pubkey);
  return (viaThisApp || byCuratedAuthor) && meetsQuality(event);
}

/** App functions and personal areas: never worth indexing. */
const NOINDEX_PREFIXES = [
  '/accounts',
  '/admin',
  '/agents',
  '/bookmarks',
  '/call',
  '/create',
  '/dashboard',
  '/forms',
  '/groups',
  '/inbox',
  '/invite',
  '/private',
  '/relays',
  '/settings',
  // Profiles: tier B (later), most are unrelated Nostr accounts.
  '/p/'
];

/** The /c dashboard routes (src/routes/c/(dashboard)), not community pages. */
const C_DASHBOARD = new Set(['/c', '/c/agents', '/c/groups', '/c/inbox', '/c/messages']);

/**
 * Non-content pages that should carry `noindex`.
 * @param {URL} url
 * @returns {boolean}
 */
export function isNoindexPath(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (C_DASHBOARD.has(path) || path.startsWith('/c/agents/')) return true;
  if (
    NOINDEX_PREFIXES.some(
      (p) => path === p.replace(/\/$/, '') || path.startsWith(p.endsWith('/') ? p : `${p}/`)
    )
  ) {
    return true;
  }
  // Search/filter variants of discover: endless URL space, same shell.
  return path === '/discover' && url.search !== '';
}
