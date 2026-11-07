/**
 * nope-mcp results → the typed items Termi's cards render and the model sees.
 * Handles the pre-2a shapes (no `relay`, no `lexical`) and the 2a ones.
 * A result without a usable in-app link is dropped (normaliser returns undefined).
 */
import { nip19 } from 'nostr-tools';

/**
 * @typedef {{
 *   type: 'community'|'event'|'resource'|'person'|'passage',
 *   id: string, title: string, subtitle?: string, description?: string,
 *   href: string, sourceUrl?: string, license?: string, creator?: string,
 *   publisher?: string, picture?: string, date?: string, location?: string,
 *   bot?: boolean, relay?: string, score?: number, weak?: boolean
 * }} Item
 */

const MAX_DESCRIPTION = 300;

/** Only absolute http(s) URLs; anything else (javascript:, data:, relative) → undefined. @param {unknown} u */
export function safeUrl(u) {
  if (typeof u !== 'string') return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** @param {unknown} s */
function clip(s) {
  if (typeof s !== 'string' || !s) return undefined;
  return s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION - 1)}…` : s;
}

/** `[{name}]` (AMB entities) or `['name']` (passage metadata) → "a, b". @param {unknown} list */
function names(list) {
  if (!Array.isArray(list)) return undefined;
  const out = list.map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
  return out.length > 0 ? out.join(', ') : undefined;
}

/** Drop undefined fields so items stay compact in JSON. @param {Record<string, any>} o */
function compact(o) {
  return /** @type {Item} */ (
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  );
}

/** @param {any} hit */
function contentSubtitle(hit) {
  if (hit.type && hit.type !== 'resource') return hit.type;
  return hit.learningResourceType?.[0];
}

/**
 * search_content result or search_resources resource → resource item.
 * The href's naddr is re-encoded with the hit's relay (2a) or the queried
 * relays (old shape: nope-mcp encodes no hints) so the detail route finds it.
 * @param {any} hit
 * @param {string[]} queriedRelays relay URLs
 * @returns {Item | undefined}
 */
export function normalizeContent(hit, queriedRelays) {
  const naddr = hit?.naddr ?? hit?.nostr?.naddr;
  /** @type {nip19.AddressPointer} */
  let pointer;
  try {
    const decoded = nip19.decode(/** @type {string} */ (naddr));
    if (decoded.type !== 'naddr') return undefined;
    pointer = decoded.data;
  } catch {
    return undefined;
  }
  const relays = hit.relay ? [hit.relay] : queriedRelays;
  return compact({
    type: 'resource',
    id: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
    title: hit.title ?? hit.name ?? '',
    subtitle: contentSubtitle(hit),
    description: clip(hit.description ?? hit.summary ?? hit.excerpt),
    href: `/${nip19.naddrEncode({ ...pointer, relays })}`,
    sourceUrl: safeUrl(hit.sourcePage ?? hit.sourceUrl),
    license: hit.license?.label,
    creator: names(hit.creator),
    publisher: names(hit.publisher),
    picture: safeUrl(hit.image),
    relay: hit.relay,
    score: hit.score,
    // 2a: the relay's NIP-50 search matched it, but no query word did — tier 1 drops these.
    weak: hit.lexical === 0 && hit.score === undefined ? true : undefined
  });
}

/** search_calendar_events event → event item (href = path of nope-mcp's app URL). @param {any} ev @returns {Item | undefined} */
export function normalizeEvent(ev) {
  const url = safeUrl(ev?.url);
  const href = url ? new URL(url).pathname : ev?.naddr ? `/${ev.naddr}` : undefined;
  if (!href) return undefined;
  return compact({
    type: 'event',
    id: `${ev.kind}:${ev.nostr?.pubkey}:${ev.identifier}`,
    title: ev.title ?? '',
    description: clip(ev.summary ?? ev.description),
    href,
    sourceUrl: safeUrl(ev.sourcePage),
    creator: ev.author?.name,
    bot: ev.author?.bot,
    date: ev.start,
    location: ev.locations?.[0],
    relay: ev.relay
  });
}

/** resolve_author candidate → person item. @param {any} cand @returns {Item | undefined} */
export function normalizePerson(cand) {
  if (!cand?.npub) return undefined;
  return compact({
    type: 'person',
    id: cand.pubkey,
    title: cand.name ?? `${cand.npub.slice(0, 12)}…`,
    subtitle: cand.nip05,
    description: clip(cand.about),
    href: `/p/${cand.npub}`,
    picture: safeUrl(cand.picture)
  });
}

/** find_community community → community item. @param {any} c @returns {Item | undefined} */
export function normalizeCommunity(c) {
  if (!c?.npub) return undefined;
  return compact({
    type: 'community',
    id: c.pubkey,
    title: c.name ?? '',
    description: clip(c.description),
    href: `/c/${c.npub}`,
    picture: safeUrl(c.picture),
    relay: c.relay
  });
}

/** search_passages passage → passage item; links to its source page. @param {any} p @returns {Item | undefined} */
export function normalizePassage(p) {
  const sourceUrl = safeUrl(p?.source_url);
  if (!sourceUrl) return undefined;
  return compact({
    type: 'passage',
    id: p.chunk_id,
    title: p.amb?.name ?? '',
    subtitle: p.heading,
    description: clip(p.text ?? p.snippet),
    href: sourceUrl,
    sourceUrl,
    license: p.license?.label,
    publisher: names(p.publisher ?? p.amb?.publisher),
    relay: p.relay,
    score: p.score
  });
}
