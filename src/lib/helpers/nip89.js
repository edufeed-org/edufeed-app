/**
 * NIP-89 — recommended application handlers, plus the bits of NIP-31 the
 * generic "unknown kind" view needs.
 *
 * Pure parsing only; no relay access (see loaders/app-handlers.js).
 *
 * - kind 31990 "handler information": an app announces which kinds it can
 *   open (`k` tags) and URL templates per platform (`web`, `ios`, …) with a
 *   `<bech32>` placeholder for the NIP-19 entity.
 * - kind 31989 "recommendation": a user vouches for 31990 handlers of one
 *   kind (`d` = the kind) via `a` tags.
 */

export const HANDLER_KIND = 31990;
export const RECOMMENDATION_KIND = 31989;

const HEX64 = /^[0-9a-f]{64}$/i;
const PLACEHOLDER = '<bech32>';

/**
 * @typedef {{ template: string, type: string | null }} HandlerWebTemplate
 * @typedef {{
 *   address: string,
 *   pubkey: string,
 *   identifier: string,
 *   createdAt: number,
 *   kinds: number[],
 *   name: string | null,
 *   picture: string | null,
 *   about: string | null,
 *   web: HandlerWebTemplate[]
 * }} AppHandler
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Parse a kind 31990 handler event. Returns null unless it has a `d` tag and
 * at least one usable https `web` template (the only platform this web app
 * can hand off to).
 *
 * `content` may carry kind-0-style metadata; when it is empty or invalid the
 * caller should fall back to the handler pubkey's kind 0.
 *
 * @param {any} event
 * @returns {AppHandler | null}
 */
export function parseHandlerEvent(event) {
  if (!event || event.kind !== HANDLER_KIND || !Array.isArray(event.tags)) return null;
  const identifier = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (typeof identifier !== 'string') return null;

  /** @type {HandlerWebTemplate[]} */
  const web = [];
  /** @type {Set<number>} */
  const kinds = new Set();
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) continue;
    if (tag[0] === 'k') {
      const kind = Number.parseInt(tag[1], 10);
      if (Number.isInteger(kind) && kind >= 0 && String(kind) === String(tag[1]).trim()) {
        kinds.add(kind);
      }
    } else if (tag[0] === 'web') {
      const template = nonEmptyString(tag[1]);
      if (!template || !template.startsWith('https://') || !template.includes(PLACEHOLDER))
        continue;
      web.push({ template, type: nonEmptyString(tag[2]) });
    }
  }
  if (web.length === 0) return null;

  let meta = /** @type {any} */ (null);
  if (typeof event.content === 'string' && event.content.trim()) {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    } catch {
      meta = null;
    }
  }

  return {
    address: `${HANDLER_KIND}:${event.pubkey}:${identifier}`,
    pubkey: event.pubkey,
    identifier,
    createdAt: event.created_at,
    kinds: [...kinds],
    name: nonEmptyString(meta?.display_name) ?? nonEmptyString(meta?.name),
    picture: nonEmptyString(meta?.picture),
    about: nonEmptyString(meta?.about),
    web
  };
}

/**
 * @typedef {{ address: string, pubkey: string, identifier: string, relay: string | null, platform: string | null }} HandlerAddress
 */

/**
 * The kind 31990 coordinates a kind 31989 recommendation points at.
 * @param {any} event
 * @returns {HandlerAddress[]}
 */
export function parseRecommendationAddresses(event) {
  if (!event || event.kind !== RECOMMENDATION_KIND || !Array.isArray(event.tags)) return [];
  /** @type {HandlerAddress[]} */
  const out = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'a' || typeof tag[1] !== 'string') continue;
    const [kind, pubkey, ...rest] = tag[1].split(':');
    if (kind !== String(HANDLER_KIND) || !HEX64.test(pubkey ?? '')) continue;
    const identifier = rest.join(':');
    out.push({
      address: tag[1],
      pubkey,
      identifier,
      relay: nonEmptyString(tag[2]),
      platform: nonEmptyString(tag[3])
    });
  }
  return out;
}

/** NIP-19 types a template may be labelled with that can stand in for another. */
const TYPE_FALLBACKS = /** @type {Record<string, string[]>} */ ({
  nevent: ['note'],
  naddr: []
});

/**
 * Resolve the URL a handler opens for one entity: a template typed for the
 * entity wins, then a compatible type (`note` for `nevent`), then an untyped
 * template ("generic handler for any NIP-19 entity"). Null when the handler
 * has no template for that entity.
 *
 * @param {AppHandler | null | undefined} handler
 * @param {{ type: 'nevent' | 'naddr', bech32: string }} entity
 * @returns {string | null}
 */
export function resolveHandlerUrl(handler, entity) {
  if (!handler || !entity?.bech32) return null;
  const wanted = [entity.type, ...(TYPE_FALLBACKS[entity.type] ?? []), null];
  for (const type of wanted) {
    const match = handler.web.find((w) => w.type === type);
    if (match) return match.template.split(PLACEHOLDER).join(entity.bech32);
  }
  return null;
}

/**
 * Best-effort title for an event the app has no dedicated parser for:
 * `title`, `name`, `subject`, then the NIP-31 `alt` summary.
 * @param {any} event
 * @returns {string | null}
 */
export function getGenericEventTitle(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  for (const name of ['title', 'name', 'subject', 'alt']) {
    const value = nonEmptyString(
      event.tags.find((/** @type {string[]} */ t) => t[0] === name)?.[1]
    );
    if (value) return value;
  }
  return null;
}

/**
 * Structured content (object or array) when `content` is JSON, else null —
 * kinds that store JSON (profiles, relay sets, wallets, …) read better as a
 * code block than as prose.
 * @param {unknown} content
 * @returns {Record<string, unknown> | unknown[] | null}
 */
export function parseJsonContent(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
