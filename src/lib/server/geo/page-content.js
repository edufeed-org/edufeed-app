/**
 * Crawler-facing content for content pages (GEO): a canonical link, JSON-LD
 * and a plain semantic HTML rendition of the event, served in the initial
 * HTML of routes that otherwise render only in the browser (`ssr = false`).
 *
 * Everyone gets the same HTML (no user-agent switch — that would be
 * cloaking); the root layout removes the block once the app has mounted, and
 * app.html hides it while JavaScript boots. Every value from the event is
 * escaped here, and rendered markdown/djot passes `sanitizeServerHtml`.
 */
import { nip19 } from 'nostr-tools';
import { getArticleTitle, getArticleSummary, getArticleImage } from 'applesauce-common/helpers';
import { eventRoutePath, isAddressableKind } from '$lib/helpers/eventRoutePath.js';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import { renderWikiContent } from '$lib/helpers/wikiContent.js';
import {
  getTagValue,
  getTagValues,
  getLabelsWithFallback,
  getLanguageDisplayName
} from '$lib/helpers/educational/ambTransform.js';
import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
import { buildAMBJsonLd } from '$lib/helpers/educational/ambJsonLd.js';
import { shortNpub } from '$lib/helpers/pubkey.js';
import { sanitizeServerHtml } from './sanitize.js';

/** @param {unknown} s */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** @param {{ tags?: string[][] }} event */
const dTag = (event) => event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';

/** @param {string | undefined} value */
const isHttpUrl = (value) => !!value && /^https?:\/\//i.test(value);

/**
 * Canonical path of an event's page. The naddr carries one deterministic relay
 * hint (the deployment's first app relay for the kind), so the sitemap and the
 * page's canonical link always agree, whatever hints the visited URL carried.
 * @param {any} event
 * @param {{ relayHint?: string }} opts
 * @returns {string | null}
 */
export function canonicalPathFor(event, { relayHint }) {
  if (!event) return null;
  // Wiki entries: /wiki/<topic> even for community wikis — it is the URL the
  // app links to (help links), and one URL per topic keeps them deduplicated.
  if (event.kind === 30818) return `/wiki/${encodeURIComponent(dTag(event))}`;
  const relays = relayHint ? [relayHint] : [];
  try {
    if (isAddressableKind(event.kind)) {
      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag(event),
        relays
      });
      return eventRoutePath(event, { naddr });
    }
    return eventRoutePath(event, { nevent: nip19.neventEncode({ id: event.id, relays }) });
  } catch {
    return null;
  }
}

/**
 * @param {number} seconds
 * @returns {string} DD.MM.YYYY (Europe/Berlin)
 */
function formatDate(seconds) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin'
  }).format(new Date(seconds * 1000));
}

/**
 * @param {string} value - ISO date (YYYY-MM-DD…); returned unchanged when not one
 * @returns {string}
 */
function formatIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/** @param {any} event */
function publishedSeconds(event) {
  const tag = Number.parseInt(getTagValue(event.tags, 'published_at') ?? '', 10);
  return Number.isFinite(tag) ? tag : event.created_at;
}

/**
 * @param {string} title
 * @param {string} byline
 * @param {string} inner - already-safe HTML
 */
const articleShell = (title, byline, inner) =>
  `<article id="geo-content"><h1>${esc(title)}</h1>${byline}${inner}</article>`;

/**
 * @param {any} event
 * @param {string} origin
 * @param {string | undefined} authorName
 */
function byline(event, origin, authorName) {
  const npub = nip19.npubEncode(event.pubkey);
  const name = authorName || shortNpub(event.pubkey);
  return (
    `<p>Von <a href="/p/${npub}">${esc(name)}</a> · ` +
    `<time datetime="${new Date(publishedSeconds(event) * 1000).toISOString()}">` +
    `${formatDate(publishedSeconds(event))}</time></p>`
  );
}

/**
 * @param {any} event
 * @param {string} canonicalUrl
 * @param {string} origin
 * @param {{ title: string, description?: string, image?: string, authorName?: string }} f
 */
function articleJsonLd(event, canonicalUrl, origin, f) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: f.title,
    ...(f.description ? { description: f.description } : {}),
    datePublished: new Date(publishedSeconds(event) * 1000).toISOString(),
    dateModified: new Date(event.created_at * 1000).toISOString(),
    ...(isHttpUrl(f.image) ? { image: f.image } : {}),
    url: canonicalUrl,
    author: {
      '@type': 'Person',
      name: f.authorName || shortNpub(event.pubkey),
      url: `${origin}/p/${nip19.npubEncode(event.pubkey)}`
    }
  };
}

/**
 * @param {string} label
 * @param {string[]} values
 */
const metaRow = (label, values) =>
  values.length ? `<dt>${esc(label)}</dt><dd>${values.map(esc).join(', ')}</dd>` : '';

/** @param {any} event */
function ambBody(event) {
  const tags = event.tags ?? [];
  const labels = (/** @type {string} */ prefix) =>
    getLabelsWithFallback(tags, prefix, 'de').map((l) => l.label);
  const license = getTagValue(tags, 'license:id');
  const original = dTag(event);
  const rows = [
    metaRow('Lizenz', license ? [formatLicenseUrl(license) || license] : []),
    metaRow(
      'Sprache',
      getTagValues(tags, 'inLanguage').map((c) => getLanguageDisplayName(c, 'de'))
    ),
    metaRow('Thema', labels('about')),
    metaRow('Art', labels('learningResourceType')),
    metaRow('Bildungsstufe', labels('educationalLevel')),
    metaRow('Klassenstufe', labels('ext:ekw:gradeLevel')),
    metaRow('Schulart', labels('ext:ekw:schoolType')),
    metaRow('Schlagwörter', getTagValues(tags, 'keywords')),
    metaRow('Veröffentlicht', getTagValues(tags, 'datePublished').map(formatIsoDate))
  ].join('');
  const description = getTagValue(tags, 'description');
  return (
    (description ? `<p>${esc(description)}</p>` : '') +
    (rows ? `<dl>${rows}</dl>` : '') +
    (isHttpUrl(original)
      ? `<p><a href="${esc(original)}" rel="nofollow ugc">Zur Ressource</a></p>`
      : '')
  );
}

/**
 * @typedef {Object} CrawlableContent
 * @property {string} canonicalUrl
 * @property {Record<string, any> | null} jsonLd
 * @property {string | null} bodyHtml
 */

/**
 * @param {any} event - a verified Nostr event
 * @param {{ origin: string, appName: string, relayHint?: string, authorName?: string, canonicalPath?: string }} opts
 * @returns {Promise<CrawlableContent>}
 */
export async function buildCrawlableContent(event, opts) {
  const path = opts.canonicalPath ?? canonicalPathFor(event, opts) ?? '/';
  const canonicalUrl = `${opts.origin}${path}`;

  if (event.kind === 30023) {
    const title = getArticleTitle(event) || 'Artikel';
    const description = getArticleSummary(event) || undefined;
    const body = sanitizeServerHtml(renderMarkdown(event.content));
    return {
      canonicalUrl,
      jsonLd: articleJsonLd(event, canonicalUrl, opts.origin, {
        title,
        description,
        image: getArticleImage(event),
        authorName: opts.authorName
      }),
      bodyHtml: articleShell(
        title,
        byline(event, opts.origin, opts.authorName),
        (description ? `<p><strong>${esc(description)}</strong></p>` : '') + body
      )
    };
  }

  if (event.kind === 30818) {
    const title = getTagValue(event.tags, 'title') || dTag(event);
    const description = getTagValue(event.tags, 'summary') || undefined;
    const body = sanitizeServerHtml(await renderWikiContent(event.content));
    return {
      canonicalUrl,
      jsonLd: articleJsonLd(event, canonicalUrl, opts.origin, {
        title,
        description,
        authorName: opts.authorName
      }),
      bodyHtml: articleShell(title, byline(event, opts.origin, opts.authorName), body)
    };
  }

  if (event.kind === 30142) {
    const name =
      getTagValue(event.tags, 'name') || getTagValue(event.tags, 'title') || 'Lernressource';
    return {
      canonicalUrl,
      jsonLd: buildAMBJsonLd(event, { identifier: dTag(event), name }, canonicalUrl),
      bodyHtml: articleShell(name, '', ambBody(event))
    };
  }

  return { canonicalUrl, jsonLd: null, bodyHtml: null };
}

/**
 * JSON for an inline <script>: `<` and the JS line separators are escaped so
 * attacker-controlled strings can't close the script element.
 * @param {unknown} value
 */
export function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * @param {{ canonicalUrl: string, jsonLd: Record<string, any> | null }} c
 * @returns {string}
 */
export function renderHeadExtras({ canonicalUrl, jsonLd }) {
  const parts = [`<link rel="canonical" href="${esc(canonicalUrl)}" />`];
  if (jsonLd) {
    parts.push(
      `<script type="application/ld+json" id="geo-jsonld">${serializeJsonLd(jsonLd)}</script>`
    );
  }
  return parts.join('\n');
}
