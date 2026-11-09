/**
 * GET /api/raw/<naddr>[.md] — an article (30023) or draft (30024) as a
 * LiaScript course, for `https://LiaScript.github.io/course/?<this URL>`.
 */
import { env } from '$env/dynamic/private';
import { decodeIdentifier, fetchEventResultFromRelays } from '$lib/server/relay-fetch.js';
import { liascriptMarkdown, isBlockedPubkey } from '$lib/server/liascript.js';
import { createRateLimiter } from '$lib/server/rate-limit.js';

const MAX_CHARS = 300_000;
const CACHE_TTL = 60_000;
const CACHE_MAX = 200;

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
/** naddr → served markdown. @type {Map<string, { md: string, expiresAt: number }>} */
const cache = new Map();

/** Errors too: the LiaScript player (another origin) can then show the real status. */
const BASE_HEADERS = { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex' };

/** @param {number} status @param {string} text */
const fail = (status, text) =>
  new Response(text, {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' }
  });

/** @param {string} md */
const ok = (md) =>
  new Response(md, {
    headers: {
      ...BASE_HEADERS,
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, getClientAddress }) {
  if (!limiter.take(getClientAddress())) return fail(429, 'Too many requests');
  const naddr = params.naddr.replace(/\.md$/, '');
  const hit = cache.get(naddr);
  if (hit && hit.expiresAt > Date.now()) return ok(hit.md);

  const decoded = decodeIdentifier(naddr);
  if (
    decoded?.type !== 'naddr' ||
    ![30023, 30024].includes(decoded.kind) ||
    isBlockedPubkey(decoded.pubkey, env.BLOCKED_PUBKEYS)
  ) {
    return fail(404, 'Not found');
  }
  const { event, complete } = await fetchEventResultFromRelays(naddr);
  if (!event) return complete ? fail(404, 'Not found') : fail(503, 'Relays did not answer');
  if ((event.content ?? '').length > MAX_CHARS) return fail(413, 'Article too long');
  const md = liascriptMarkdown(event);
  if (md.length > MAX_CHARS) return fail(413, 'Article too long');

  cache.delete(naddr);
  if (cache.size >= CACHE_MAX) cache.delete(/** @type {string} */ (cache.keys().next().value));
  cache.set(naddr, { md, expiresAt: Date.now() + CACHE_TTL });
  return ok(md);
}
