/**
 * Open Graph / Twitter Card meta tag generation for link previews.
 *
 * Decodes naddr/nevent identifiers, fetches events from Nostr relays server-side,
 * extracts metadata, and renders OG/Twitter meta tags for injection into HTML.
 */

import { env } from '$env/dynamic/private';
import { nip19 } from 'nostr-tools';
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
import { normalizePubkey } from '$lib/helpers/pubkey.js';

// ─── Relay fetch ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT = 3000;

/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
function parseRelays(csv) {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Get relays to query for a given kind.
 * Mirrors kindToAppRelayCategory in src/lib/services/app-relay-service.svelte.js,
 * reading env directly (server context — no user 30002 overrides for crawlers).
 * @param {number} kind
 * @param {string[]} hintRelays
 * @returns {string[]}
 */
export function getRelaysForKind(kind, hintRelays) {
  /** @type {string[]} */
  let appRelays = [];

  if (kind >= 31922 && kind <= 31925) {
    appRelays = parseRelays(env.CALENDAR_RELAYS);
  } else if (kind === 30142) {
    appRelays = parseRelays(env.AMB_RELAYS);
  } else if (kind === 30023) {
    appRelays = parseRelays(env.LONGFORM_CONTENT_RELAY);
  } else if (kind === 30168 || kind === 10222 || kind === 11) {
    appRelays = parseRelays(env.COMMUNIKEY_RELAYS);
  } else if (kind === 30301) {
    appRelays = parseRelays(env.KANBAN_RELAYS);
  } else if (kind === 30818) {
    appRelays = [
      ...parseRelays(env.COMMUNIKEY_RELAYS),
      ...parseRelays(env.RELAY_LIST_LOOKUP_RELAYS)
    ];
  } else if (kind === 0) {
    appRelays = [...parseRelays(env.RELAY_LIST_LOOKUP_RELAYS), ...parseRelays(env.INDEXER_RELAYS)];
  }

  const fallback = parseRelays(env.FALLBACK_RELAYS);
  const all = [...new Set([...hintRelays, ...appRelays, ...fallback])];
  return all.length > 0 ? all : ['wss://relay.damus.io', 'wss://nos.lol'];
}

/**
 * Decode a Nostr identifier (naddr or nevent) into its components.
 * @param {string} identifier
 * @returns {{ type: 'naddr', kind: number, pubkey: string, identifier: string, relays: string[] } | { type: 'nevent', id: string, relays: string[], kind?: number } | null}
 */
export function decodeIdentifier(identifier) {
  try {
    const decoded = nip19.decode(identifier);
    if (decoded.type === 'naddr') {
      return {
        type: 'naddr',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays || []
      };
    }
    if (decoded.type === 'nevent') {
      return {
        type: 'nevent',
        id: decoded.data.id,
        relays: decoded.data.relays || [],
        kind: decoded.data.kind
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the first event matching a filter from the given relays.
 * Races all relays; resolves null after FETCH_TIMEOUT.
 * @param {import('nostr-tools').Filter} filter
 * @param {string[]} relays
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export function fetchFirstEvent(filter, relays) {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
      cleanup();
    }, FETCH_TIMEOUT);

    /** @type {import('ws').WebSocket[]} */
    const sockets = [];

    function cleanup() {
      clearTimeout(timeout);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }

    // Dynamic import ws for server-side WebSocket
    import('ws').then(({ default: WebSocket }) => {
      if (resolved) return;

      for (const relay of relays.slice(0, 5)) {
        try {
          const ws = new WebSocket(relay);
          sockets.push(ws);

          ws.on('open', () => {
            ws.send(JSON.stringify(['REQ', 'og', filter]));
          });

          ws.on('message', (/** @type {Buffer} */ data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg[0] === 'EVENT' && msg[1] === 'og' && msg[2]) {
                if (!resolved) {
                  resolved = true;
                  resolve(msg[2]);
                  cleanup();
                }
              }
              if (msg[0] === 'EOSE' && msg[1] === 'og') {
                ws.close();
              }
            } catch {
              // ignore parse errors
            }
          });

          ws.on('error', () => ws.close());
        } catch {
          // skip bad relay URL
        }
      }
    });
  });
}

/**
 * Fetch a single event from Nostr relays server-side using WebSocket.
 * @param {string} identifier - naddr1... or nevent1... string
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function fetchEventFromRelays(identifier) {
  const decoded = decodeIdentifier(identifier);
  if (!decoded) return null;

  if (decoded.type === 'naddr') {
    return fetchFirstEvent(
      { kinds: [decoded.kind], authors: [decoded.pubkey], '#d': [decoded.identifier], limit: 1 },
      getRelaysForKind(decoded.kind, decoded.relays)
    );
  }
  return fetchFirstEvent(
    { ids: [decoded.id], limit: 1 },
    getRelaysForKind(decoded.kind || 1, decoded.relays)
  );
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

/** @type {RegExp} */
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?\S*)?/i;

/** Map feed-card typeKeys to OG types. Unlisted keys → 'website'. */
const TYPE_KEY_TO_OG_TYPE = {
  calendar: 'event',
  article: 'article',
  learning: 'article'
};

/**
 * @typedef {Object} OgMetadata
 * @property {string} title
 * @property {string} description
 * @property {string} [image]
 * @property {'article' | 'event' | 'website' | 'profile'} type
 * @property {string} [publishedAt] - ISO 8601 publication timestamp (articles only)
 */

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

  // Long-form articles (NIP-23)
  if (kind === 30023) {
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
      title: profile?.display_name || profile?.name || 'Profile',
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
 * Render OG + Twitter meta tags as an HTML string.
 * @param {OgMetadata} meta
 * @param {string} url - The canonical page URL
 * @returns {string}
 */
export function renderOgTags(meta, url) {
  const appName = env.APP_NAME || 'ComCal';
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const hasImage = !!meta.image;

  /** @type {string[]} */
  const tags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${escapeHtml(appName)}" />`
  ];

  if (hasImage) {
    const proxied = escapeHtml(proxyImageUrl(/** @type {string} */ (meta.image), url));
    tags.push(`<meta property="og:image" content="${proxied}" />`);
    tags.push(`<meta property="og:image:secure_url" content="${proxied}" />`);
    tags.push(`<meta property="og:image:type" content="image/jpeg" />`);
    tags.push(`<meta property="og:image:width" content="1200" />`);
    tags.push(`<meta property="og:image:height" content="630" />`);
    tags.push(`<meta property="og:image:alt" content="${title}" />`);
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
    tags.push(`<meta name="twitter:image" content="${proxied}" />`);
  } else {
    tags.push(`<meta name="twitter:card" content="summary" />`);
  }

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
 * @typedef {Object} CacheEntry
 * @property {string} value
 * @property {number} expiresAt
 */

class OgCache {
  /** @type {Map<string, CacheEntry>} */
  #entries = new Map();

  /**
   * @param {string} key
   * @returns {string | null}
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
   * @param {string} value
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
 * SvelteKit handle hook for injecting OG meta tags.
 * @type {import('@sveltejs/kit').Handle}
 */
export async function ogMetaHandle({ event, resolve }) {
  const identifier = extractIdentifier(event.url.pathname);

  if (!identifier) {
    return resolve(event);
  }

  // Check cache
  let ogHtml = ogCache.get(identifier);

  if (ogHtml === null) {
    // Cache miss — fetch and render
    try {
      const nostrEvent = await fetchEventFromRelays(identifier);
      if (nostrEvent) {
        const meta = extractMetadata(nostrEvent);
        ogHtml = renderOgTags(meta, event.url.href);
        ogCache.set(identifier, ogHtml, POSITIVE_TTL);
      } else {
        // Negative cache — prevent repeated relay fetches for missing events
        ogHtml = '';
        ogCache.set(identifier, ogHtml, NEGATIVE_TTL);
      }
    } catch {
      ogHtml = '';
      ogCache.set(identifier, ogHtml, NEGATIVE_TTL);
    }
  }

  if (!ogHtml) {
    return resolve(event);
  }

  const finalOgHtml = ogHtml;
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('</head>', `${finalOgHtml}\n</head>`)
  });
}
