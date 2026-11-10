/**
 * nope-mcp results → the typed items Termi's cards render and the model sees.
 * Handles the pre-2a shapes (no `relay`, no `lexical`) and the 2a ones.
 * A result without any usable link is dropped (normaliser returns undefined);
 * an event may keep only its external `sourceUrl`.
 */
import { nip19 } from 'nostr-tools';

/** @typedef {import('$lib/termi/items.d.js').Item} Item */

const MAX_DESCRIPTION = 300;
const MAX_LINE = 200;

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

/** @param {unknown} s @param {number} [max] */
function clip(s, max = MAX_DESCRIPTION) {
  if (typeof s !== 'string' || !s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** @param {unknown} s */
const line = (s) => clip(s, MAX_LINE);

/** The author's key when it is 64 hex (the client drops blocked authors by it). @param {unknown} s */
const hexKey = (s) => (typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : undefined);

/** @param {unknown} s @returns {nip19.AddressPointer | undefined} */
function decodeNaddr(s) {
  try {
    const decoded = nip19.decode(/** @type {string} */ (s));
    return decoded.type === 'naddr' ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}

/** A well-formed npub whose key matches `pubkey` (64 hex), else undefined. @param {any} o */
function validNpub(o) {
  if (typeof o?.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(o.pubkey)) return undefined;
  try {
    const decoded = nip19.decode(/** @type {string} */ (o.npub));
    return decoded.type === 'npub' && decoded.data === o.pubkey ? o.npub : undefined;
  } catch {
    return undefined;
  }
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
  // Without a decodable naddr there is no in-app target; nope-mcp always sends one, so drop the hit.
  const pointer = decodeNaddr(hit?.naddr ?? hit?.nostr?.naddr);
  if (!pointer) return undefined;
  // Only a wss:// URL is a usable hint; anything else falls back to the queried relays.
  const hint = typeof hit.relay === 'string' && /^wss:\/\/\S+$/.test(hit.relay) ? hit.relay : '';
  const relays = hint ? [hint] : queriedRelays;
  return compact({
    type: 'resource',
    id: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
    pubkey: hexKey(pointer.pubkey),
    title: line(hit.title ?? hit.name) ?? '',
    subtitle: line(contentSubtitle(hit)),
    description: clip(hit.description ?? hit.summary ?? hit.excerpt),
    href: `/${nip19.naddrEncode({ ...pointer, relays })}`,
    sourceUrl: safeUrl(hit.sourcePage ?? hit.sourceUrl),
    license: hit.license?.label,
    licenseUrl: safeUrl(hit.license?.id),
    creator: line(names(hit.creator)),
    publisher: line(names(hit.publisher)),
    picture: safeUrl(hit.image),
    relay: hint || undefined,
    score: hit.score,
    // 2a: the relay's NIP-50 search matched it, but no query word did — tier 1 drops these.
    weak: hit.lexical === 0 && hit.score === undefined ? true : undefined
  });
}

/**
 * search_calendar_events event → event item. href = `/<naddr>` from the last
 * path segment of nope-mcp's app URL (or `naddr`), only when it decodes as an
 * naddr — never a raw path (`//host/x` would leave the app).
 * @param {any} ev @returns {Item | undefined}
 */
export function normalizeEvent(ev) {
  if (!ev) return undefined;
  const fromUrl = typeof ev.url === 'string' ? ev.url.split(/[/?#]/).filter(Boolean) : [];
  const naddr = [fromUrl.at(-1), ev.naddr].find((s) => decodeNaddr(s));
  if (!naddr && !safeUrl(ev.sourcePage)) return undefined;
  return compact({
    type: 'event',
    id: `${ev.kind}:${ev.nostr?.pubkey}:${ev.identifier}`,
    pubkey: hexKey(ev.nostr?.pubkey ?? ev.author?.pubkey),
    title: line(ev.title) ?? '',
    description: clip(ev.summary ?? ev.description),
    href: naddr ? `/${naddr}` : undefined,
    sourceUrl: safeUrl(ev.sourcePage),
    creator: line(ev.author?.name),
    bot: ev.author?.bot,
    date: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    location: ev.locations?.[0],
    relay: ev.relay
  });
}

/** resolve_author candidate → person item. @param {any} cand @returns {Item | undefined} */
export function normalizePerson(cand) {
  const npub = validNpub(cand);
  if (!npub) return undefined;
  return compact({
    type: 'person',
    id: cand.pubkey,
    pubkey: cand.pubkey,
    title: line(cand.name) ?? `${npub.slice(0, 12)}…`,
    subtitle: line(cand.nip05),
    description: clip(cand.about),
    href: `/p/${npub}`,
    picture: safeUrl(cand.picture)
  });
}

/** find_community community → community item. @param {any} c @returns {Item | undefined} */
export function normalizeCommunity(c) {
  const npub = validNpub(c);
  if (!npub) return undefined;
  return compact({
    type: 'community',
    id: c.pubkey,
    pubkey: c.pubkey,
    title: line(c.name) ?? `${npub.slice(0, 12)}…`,
    description: clip(c.description),
    href: `/c/${npub}`,
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
    pubkey: hexKey(typeof p.event_coord === 'string' ? p.event_coord.split(':')[1] : undefined),
    title: line(p.amb?.name) ?? '',
    subtitle: line(p.heading),
    description: clip(p.text ?? p.snippet),
    href: sourceUrl,
    sourceUrl,
    license: p.license?.label,
    licenseUrl: safeUrl(p.license?.id),
    creator: line(names(p.creator ?? p.amb?.creator)),
    publisher: line(names(p.publisher ?? p.amb?.publisher)),
    relay: p.relay,
    score: p.score
  });
}
