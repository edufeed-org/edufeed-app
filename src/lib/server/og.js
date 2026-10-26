/**
 * Open Graph / Twitter Card meta tag generation for link previews.
 *
 * Decodes naddr/nevent identifiers, fetches events from Nostr relays server-side,
 * extracts metadata, and renders OG/Twitter meta tags for injection into HTML.
 */

import { env } from '$env/dynamic/private';
import {
  getCalendarEventTitle,
  getCalendarEventSummary,
  getCalendarEventImage,
  getArticleTitle,
  getArticleSummary,
  getArticleImage
} from 'applesauce-common/helpers';
import { getProfileContent } from 'applesauce-core/helpers';
import { getFeedCardData } from '$lib/helpers/feedCardData.js';
import { getTagValue } from '$lib/helpers/educational/ambTransform.js';
import { normalizePubkey, shortNpub as abbreviateNpub } from '$lib/helpers/pubkey.js';
import {
  buildCrawlableContent,
  canonicalPathFor,
  renderHeadExtras
} from '$lib/server/geo/page-content.js';
import {
  DEFAULT_GEO_SALT,
  geoContentKey,
  geoGroup,
  parseShare
} from '$lib/server/geo/assignment.js';
import {
  INDEXABLE_KINDS,
  isIndexableEvent,
  isNoindexPath,
  isSearchIndexingEnabled
} from '$lib/server/geo/indexability.js';
import {
  createCuratedAuthorsCache,
  resolveCuratedAuthorSet
} from '$lib/server/geo/curated-authors.js';
import { parseArray } from '$lib/server/env-parse.js';

// Relay reads live in relay-fetch.js; re-exported for existing importers.
export {
  getRelaysForKind,
  decodeIdentifier,
  eventMatchesFilter,
  fetchFirstEvent,
  fetchEventFromRelays
} from './relay-fetch.js';
import {
  getRelaysForKind,
  fetchFirstEvent,
  fetchFirstEventResult,
  fetchEventResultFromRelays
} from './relay-fetch.js';

// ─── Metadata extraction ──────────────────────────────────────────────────────

/** @type {RegExp} */
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?\S*)?/i;

/**
 * Map feed-card typeKeys to OG types. Unlisted keys → 'website'.
 * @type {Record<string, 'event' | 'article' | 'website'>}
 */
const TYPE_KEY_TO_OG_TYPE = {
  calendar: 'event',
  article: 'article',
  learning: 'article'
};

/** @type {string} */
const DEFAULT_SITE_DESCRIPTION =
  'Discover educational resources, events and communities on the open Nostr network.';

/**
 * @typedef {Object} OgMetadata
 * @property {string} title
 * @property {string} description
 * @property {string} [image]
 * @property {'article' | 'event' | 'website' | 'profile'} type
 * @property {string} [publishedAt] - ISO 8601 publication timestamp (articles only)
 */

/**
 * Default site-wide metadata for pages without a resolvable content target.
 * @returns {OgMetadata}
 */
export function buildDefaultMeta() {
  return {
    title: env.APP_NAME || 'Edufeed',
    description: env.APP_OG_DESCRIPTION || DEFAULT_SITE_DESCRIPTION,
    type: 'website'
  };
}

/**
 * Extract OG metadata from a Nostr event based on its kind.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {OgMetadata}
 */
export function extractMetadata(event) {
  const kind = event.kind;

  // Calendar events (NIP-52)
  if (kind === 31922 || kind === 31923) {
    const title = getCalendarEventTitle(event) || 'Calendar Event';
    const summary = getCalendarEventSummary(event);
    const description = summary || truncate(event.content, 200);
    const image = getCalendarEventImage(event);
    return { title, description, image, type: 'event' };
  }

  // Long-form articles (NIP-23) and their drafts
  if (kind === 30023 || kind === 30024) {
    const title = getArticleTitle(event) || 'Article';
    const summary = getArticleSummary(event);
    const description = summary || truncate(event.content, 200);
    const image = getArticleImage(event);
    const publishedAtTag = getTagValue(event.tags, 'published_at');
    const publishedAtSeconds = publishedAtTag ? parseInt(publishedAtTag, 10) : NaN;
    const publishedAt = Number.isFinite(publishedAtSeconds)
      ? new Date(publishedAtSeconds * 1000).toISOString()
      : undefined;
    return { title, description, image, type: 'article', publishedAt };
  }

  // Educational resources (AMB - kind 30142)
  if (kind === 30142) {
    const title =
      getTagValue(event.tags, 'title') || getTagValue(event.tags, 'name') || 'Educational Resource';
    const desc = getTagValue(event.tags, 'description');
    const description = desc || truncate(event.content, 200);
    const image = getTagValue(event.tags, 'image') || undefined;
    return { title, description, image, type: 'article' };
  }

  // Calendar collections (NIP-52 kind 31924)
  if (kind === 31924) {
    const title = getTagValue(event.tags, 'title') || getTagValue(event.tags, 'name') || 'Calendar';
    const description =
      getTagValue(event.tags, 'description') || getTagValue(event.tags, 'summary') || '';
    const image = getTagValue(event.tags, 'image') || undefined;
    return { title, description, image, type: 'website' };
  }

  // Profiles (kind 0) — also used for community pages (communities are npubs)
  if (kind === 0) {
    const profile = getProfileContent(event);
    return {
      title: profile?.display_name || profile?.name || shortNpub(event.pubkey),
      description: truncate(profile?.about || '', 200),
      image: profile?.picture || undefined,
      type: 'profile'
    };
  }

  // Everything else: delegate to the shared feed-card extractor
  const card = getFeedCardData(event);
  const isJsonContent = /^\s*[[{]/.test(event.content || '');
  const imageMatch = !isJsonContent && event.content ? event.content.match(IMAGE_URL_RE) : null;
  return {
    title: card.title,
    description:
      card.description || card.subtitle || (isJsonContent ? '' : truncate(event.content, 200)),
    image: imageMatch ? imageMatch[0] : undefined,
    type: TYPE_KEY_TO_OG_TYPE[card.typeKey] || 'website'
  };
}

/**
 * Short display form of a pubkey's npub, used as the profile title fallback
 * when no display_name/name is set (per spec: npub short form, not "Profile").
 * @param {string} pubkey - hex pubkey
 * @returns {string}
 */
function shortNpub(pubkey) {
  return abbreviateNpub(pubkey) || 'Profile';
}

/**
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// ─── HTML rendering ───────────────────────────────────────────────────────────

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a proxied image URL for OG tags.
 * @param {string} imageUrl
 * @param {string} requestUrl - Full request URL for building absolute proxy URL
 * @returns {string}
 */
function proxyImageUrl(imageUrl, requestUrl) {
  const base = new URL(requestUrl);
  const encoded = encodeURIComponent(imageUrl);
  // Cover-crop to an exact 1200x630 JPEG: webp link previews fail on several
  // platforms (WhatsApp, some Matrix/Synapse setups), and declaring truthful
  // dimensions requires a fixed size rather than the proxy's default aspect-fit.
  return `${base.origin}/api/image?url=${encoded}&w=1200&h=630&fit=cover&fmt=jpeg`;
}

/**
 * Infer the MIME type of the default OG image from its URL extension.
 * Returns null when unknown (the og:image:type tag is then omitted).
 * @param {string} url
 * @returns {string | null}
 */
function imageMimeFromUrl(url) {
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  return null;
}

/**
 * Absolute URL of the default brand OG image (1200x630, not proxied).
 * @param {string} requestUrl
 * @returns {string}
 */
function defaultOgImageUrl(requestUrl) {
  const configured = env.OG_DEFAULT_IMAGE || '/og-default.png';
  if (/^https?:\/\//.test(configured)) return configured;
  return new URL(configured, new URL(requestUrl).origin).href;
}

/**
 * Render OG + Twitter meta tags as an HTML string.
 * @param {OgMetadata} meta
 * @param {string} url - The canonical page URL
 * @returns {string}
 */
export function renderOgTags(meta, url) {
  const appName = env.APP_NAME || 'Edufeed';
  const title = escapeHtml(meta.title);
  const description = escapeHtml(
    meta.description || env.APP_OG_DESCRIPTION || DEFAULT_SITE_DESCRIPTION
  );

  // Content images go through the resizing proxy; the static brand image
  // is already 1200x630 and served from our origin.
  const image = meta.image ? proxyImageUrl(meta.image, url) : defaultOgImageUrl(url);
  const imageEsc = escapeHtml(image);
  // The proxy guarantees JPEG output; for the default image infer the type
  // from its extension and omit the tag when unknown.
  const imageMime = meta.image ? 'image/jpeg' : imageMimeFromUrl(image);

  /** @type {string[]} */
  const tags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${escapeHtml(appName)}" />`,
    `<meta property="og:image" content="${imageEsc}" />`,
    `<meta property="og:image:secure_url" content="${imageEsc}" />`,
    ...(imageMime ? [`<meta property="og:image:type" content="${imageMime}" />`] : []),
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${imageEsc}" />`
  ];

  if (meta.type === 'article' && meta.publishedAt) {
    tags.push(
      `<meta property="article:published_time" content="${escapeHtml(meta.publishedAt)}" />`
    );
  }

  tags.push(`<meta name="twitter:title" content="${title}" />`);
  tags.push(`<meta name="twitter:description" content="${description}" />`);

  return tags.join('\n');
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 500;

/**
 * What the handle injects for one page target. `head` empty = negative entry;
 * `provisional` entries are cached briefly (verdict may change).
 * @typedef {{ head: string, body: string, noindex?: boolean, provisional?: boolean }} PageEntry
 */

/**
 * @typedef {Object} CacheEntry
 * @property {PageEntry} value
 * @property {number} expiresAt
 */

class OgCache {
  /** @type {Map<string, CacheEntry>} */
  #entries = new Map();

  /**
   * @param {string} key
   * @returns {PageEntry | null}
   */
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {PageEntry} value
   * @param {number} ttlMs
   */
  set(key, value, ttlMs) {
    // Evict oldest entries if at capacity
    if (this.#entries.size >= MAX_CACHE_ENTRIES) {
      const firstKey = this.#entries.keys().next().value;
      if (firstKey !== undefined) this.#entries.delete(firstKey);
    }
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.#entries.clear();
  }
}

export const ogCache = new OgCache();

// ─── Main handler logic ───────────────────────────────────────────────────────

const POSITIVE_TTL = 60 * 60 * 1000; // 1 hour
const NEGATIVE_TTL = 5 * 60 * 1000; // 5 minutes
const TRANSIENT_TTL = 30 * 1000; // relay timeouts / unreached verdicts

const NADDR_RE = /\/(naddr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,})/;
const NEVENT_RE = /\/(nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,})/;

/**
 * Extract a Nostr identifier from a URL path.
 * @param {string} pathname
 * @returns {string | null}
 */
export function extractIdentifier(pathname) {
  const naddrMatch = pathname.match(NADDR_RE);
  if (naddrMatch) return naddrMatch[1];
  const neventMatch = pathname.match(NEVENT_RE);
  if (neventMatch) return neventMatch[1];
  return null;
}

/**
 * decodeURIComponent that never throws — returns the raw value on malformed input.
 * @param {string} value
 * @returns {string}
 */
function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @typedef {{ type: 'event', identifier: string }
 *   | { type: 'community', pubkey: string }
 *   | { type: 'profile', pubkey: string }
 *   | { type: 'wiki-topic', topic: string }
 *   | { type: 'default' }} PageTarget
 */

/**
 * Classify a pathname into a previewable page target.
 * naddr/nevent take precedence so community-scoped content URLs
 * (/c/<npub>/article/<naddr>) preview the content, not the community.
 * @param {string} pathname
 * @returns {PageTarget}
 */
export function resolvePageTarget(pathname) {
  const identifier = extractIdentifier(pathname);
  if (identifier) return { type: 'event', identifier };

  const cMatch = pathname.match(/^\/c\/([^/]+)/);
  if (cMatch) {
    const pubkey = normalizePubkey(safeDecodeURIComponent(cMatch[1]));
    if (pubkey) return { type: 'community', pubkey };
  }

  const pMatch = pathname.match(/^\/p\/([^/]+)/);
  if (pMatch) {
    const pubkey = normalizePubkey(safeDecodeURIComponent(pMatch[1]));
    if (pubkey) return { type: 'profile', pubkey };
  }

  const authorMatch = pathname.match(/^\/calendar\/author\/([^/]+)/);
  if (authorMatch) {
    const pubkey = normalizePubkey(safeDecodeURIComponent(authorMatch[1]));
    if (pubkey) return { type: 'profile', pubkey };
  }

  const wikiMatch = pathname.match(/^\/wiki\/([^/]+)$/);
  if (wikiMatch) return { type: 'wiki-topic', topic: safeDecodeURIComponent(wikiMatch[1]) };

  return { type: 'default' };
}

/**
 * Cache key for a resolved page target.
 * @param {PageTarget} target
 * @returns {string}
 */
function targetCacheKey(target) {
  switch (target.type) {
    case 'event':
      return target.identifier;
    case 'profile':
      return `profile:${target.pubkey}`;
    case 'community':
      return `community:${target.pubkey}`;
    case 'wiki-topic':
      return `wiki:${target.topic}`;
    default:
      return 'default';
  }
}

/**
 * Fetch the Nostr event backing a page target.
 * @param {PageTarget} target
 * @returns {Promise<import('./relay-fetch.js').FetchResult>}
 */
async function fetchTarget(target) {
  switch (target.type) {
    case 'event':
      return fetchEventResultFromRelays(target.identifier);
    case 'profile':
    case 'community':
      return fetchFirstEventResult(
        { kinds: [0], authors: [target.pubkey], limit: 1 },
        getRelaysForKind(0, [])
      );
    case 'wiki-topic':
      return fetchFirstEventResult(
        { kinds: [30818], '#d': [target.topic], limit: 1 },
        getRelaysForKind(30818, [])
      );
    default:
      return { event: null, complete: true };
  }
}

const AUTHOR_NAME_TIMEOUT = 1500;

/**
 * Display name of an author for the crawler byline. Short timeout: this runs
 * before the HTML is sent, also for humans on an uncached page.
 * @param {string} pubkey
 * @returns {Promise<string | undefined>}
 */
async function fetchAuthorName(pubkey) {
  const profileEvent = await fetchFirstEvent(
    { kinds: [0], authors: [pubkey], limit: 1 },
    getRelaysForKind(0, []),
    AUTHOR_NAME_TIMEOUT
  );
  if (!profileEvent) return undefined;
  const profile = getProfileContent(profileEvent);
  return profile?.display_name || profile?.name || undefined;
}

const OWN_RELAY_TIMEOUT = 2000;
const CURATED_MAX_WAIT = 2000;
const NOINDEX_META = '<meta name="robots" content="noindex" />';

/** Curated authors for the indexability rule (stale-while-revalidate, 1 h). */
export const curatedAuthors = createCuratedAuthorsCache({
  resolve: () => resolveCuratedAuthorSet(env, fetchFirstEvent),
  ttlMs: 60 * 60 * 1000
});

/**
 * The deployment's own relays for an indexable kind.
 * @param {number} kind
 * @returns {string[]}
 */
export function ownRelaysForKind(kind) {
  if (kind === 30023) return parseArray(env.LONGFORM_CONTENT_RELAY);
  if (kind === 30818) return parseArray(env.COMMUNIKEY_RELAYS);
  if (kind === 30142) return parseArray(env.AMB_RELAYS);
  return [];
}

/**
 * Whether the event's address resolves on the deployment's own relays. The
 * client tag is self-declared; this keeps content that only lives on foreign
 * relays from being indexed under our domain.
 * @param {import('nostr-tools').NostrEvent} nostrEvent
 * @returns {Promise<boolean | null>} null = the relays didn't answer in time
 */
async function isOnOwnRelays(nostrEvent) {
  const relays = ownRelaysForKind(nostrEvent.kind);
  if (relays.length === 0) return false;
  const d = nostrEvent.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const { event, complete } = await fetchFirstEventResult(
    { kinds: [nostrEvent.kind], authors: [nostrEvent.pubkey], '#d': [d], limit: 1 },
    relays,
    OWN_RELAY_TIMEOUT
  );
  if (event) return true;
  return complete ? false : null;
}

/**
 * Build what gets injected for a resolved target: OG tags for every target.
 * Content that passes the indexability rule ($lib/server/geo/indexability.js)
 * also gets a canonical link and — for pages in the GEO treatment group —
 * JSON-LD plus a server-rendered body (GEO_SERVER_CONTENT_SHARE). Everything
 * else is marked noindex.
 * @param {import('nostr-tools').NostrEvent} nostrEvent
 * @param {PageTarget} target
 * @param {URL} url
 * @param {{ getCurated?: () => Promise<Set<string> | null>, onOwnRelays?: (e: import('nostr-tools').NostrEvent) => Promise<boolean | null> }} [deps]
 * @returns {Promise<PageEntry>}
 */
export async function buildPageEntry(nostrEvent, target, url, deps = {}) {
  const {
    getCurated = () => curatedAuthors.get(CURATED_MAX_WAIT),
    onOwnRelays: checkOwnRelays = isOnOwnRelays
  } = deps;
  const og = renderOgTags(extractMetadata(nostrEvent), url.href);
  if (target.type === 'community') return { head: og, body: '', noindex: false };
  if (target.type === 'profile') return { head: og, body: '', noindex: true };
  if (!INDEXABLE_KINDS.has(nostrEvent.kind) || !isSearchIndexingEnabled(env))
    return { head: og, body: '', noindex: true };

  const curated = await getCurated();
  const byRule = isIndexableEvent(nostrEvent, {
    clientName: env.CLIENT_NAME || env.APP_NAME || 'Edufeed',
    curatedAuthors: curated
  });
  const ownRelays = byRule ? await checkOwnRelays(nostrEvent) : false;
  // A verdict we couldn't reach (curation not resolved yet, own relays silent)
  // is provisional: no body, but no noindex either — a crawler must never be
  // told "don't index" because a relay was slow. Cached briefly.
  if ((!byRule && curated === null) || (byRule && ownRelays === null)) {
    return { head: og, body: '', noindex: false, provisional: true };
  }
  if (!byRule || !ownRelays) return { head: og, body: '', noindex: true };

  const relayHint = getRelaysForKind(nostrEvent.kind, [])[0];
  const canonicalPath =
    target.type === 'wiki-topic'
      ? `/wiki/${encodeURIComponent(target.topic)}`
      : (canonicalPathFor(nostrEvent, { relayHint }) ?? undefined);
  const group = geoGroup(
    geoContentKey(nostrEvent),
    parseShare(env.GEO_SERVER_CONTENT_SHARE),
    env.GEO_ASSIGNMENT_SALT || DEFAULT_GEO_SALT
  );

  if (group === 'V') {
    const canonicalUrl = `${url.origin}${canonicalPath ?? url.pathname}`;
    return {
      head: `${og}\n${renderHeadExtras({ canonicalUrl, jsonLd: null })}`,
      body: '',
      noindex: false
    };
  }

  const content = await buildCrawlableContent(nostrEvent, {
    origin: url.origin,
    appName: env.APP_NAME || 'Edufeed',
    relayHint,
    canonicalPath,
    authorName: nostrEvent.kind === 30142 ? undefined : await fetchAuthorName(nostrEvent.pubkey)
  });
  return {
    head: `${og}\n${renderHeadExtras(content)}`,
    body: content.bodyHtml ?? '',
    noindex: false
  };
}

/** @type {PageEntry} */
const NEGATIVE_ENTRY = { head: '', body: '', noindex: true };

/** Relay timeout: default tags, no noindex, retried soon. @type {PageEntry} */
const TRANSIENT_ENTRY = { head: '', body: '', noindex: false, provisional: true };

/**
 * SvelteKit handle hook for injecting OG meta tags (and, for content pages,
 * the GEO canonical/JSON-LD/body or a noindex — see buildPageEntry).
 * Always injects exactly one tag set: content tags when a target resolves,
 * default site tags otherwise (no page ships a bare head).
 * @type {import('@sveltejs/kit').Handle}
 */
export async function ogMetaHandle({ event, resolve }) {
  // API endpoints never render HTML — resolving a target here would run
  // relay fetches (up to FETCH_TIMEOUT) for a result that's discarded, e.g.
  // /api/calendar/<naddr>/ics matches NADDR_RE.
  if (event.url.pathname.startsWith('/api/')) return resolve(event);

  const target = resolvePageTarget(event.url.pathname);

  /** @type {PageEntry | null} */
  let entry = null;

  if (target.type !== 'default') {
    const key = targetCacheKey(target);
    entry = ogCache.get(key);

    if (entry === null) {
      try {
        const { event: nostrEvent, complete } = await fetchTarget(target);
        if (nostrEvent) {
          entry = await buildPageEntry(nostrEvent, target, event.url);
          ogCache.set(key, entry, entry.provisional ? TRANSIENT_TTL : POSITIVE_TTL);
        } else if (complete) {
          // Every relay answered: the content really isn't there.
          entry = NEGATIVE_ENTRY;
          ogCache.set(key, entry, NEGATIVE_TTL);
        } else {
          // Relays didn't answer in time — not a verdict on the page.
          entry = TRANSIENT_ENTRY;
          ogCache.set(key, entry, TRANSIENT_TTL);
        }
      } catch {
        entry = TRANSIENT_ENTRY;
        ogCache.set(key, entry, TRANSIENT_TTL);
      }
    }
  }

  // Default tags are cheap to render (string ops) and embed the per-request URL.
  // Confirmed-missing content is noindex (an empty shell with 200 is a soft 404);
  // relay timeouts and unreached verdicts are not (provisional entries).
  const noindex =
    !isSearchIndexingEnabled(env) || (entry ? !!entry.noindex : isNoindexPath(event.url));
  const head =
    (entry?.head || renderOgTags(buildDefaultMeta(), event.url.href)) +
    (noindex ? `\n${NOINDEX_META}` : '');
  const body = entry?.head ? entry.body : '';

  return resolve(event, {
    // Use a replacer function, not a replacement string: String.replace
    // interprets `$&`/`` $` ``/`$'`/`$$` patterns in string replacements, and
    // attacker-controlled Nostr content (e.g. a profile title containing
    // `$'`) can corrupt the injected/surrounding HTML — output that then
    // gets cached for POSITIVE_TTL.
    transformPageChunk: ({ html }) => {
      const withHead = html.replace('</head>', () => `${head}\n</head>`);
      return body ? withHead.replace('</body>', () => `${body}\n</body>`) : withHead;
    }
  });
}
